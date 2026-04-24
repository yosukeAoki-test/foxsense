import Stripe from 'stripe';
import { verifySync as otpVerifySync } from 'otplib';
import prisma from '../../config/db.js';
import config from '../../config/index.js';
import { AppError } from '../../middleware/errorHandler.js';
import { activateSimInternal, suspendSimInternal } from '../soracom/soracom.service.js';

const isStripeEnabled = config.stripe.secretKey && !config.stripe.secretKey.startsWith('sk_test_xxx');
const stripe = isStripeEnabled ? new Stripe(config.stripe.secretKey) : null;

// ユーザーの残高を取得（なければ作成）
export const getOrCreateBalance = async (userId) => {
  return prisma.foxCoinBalance.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
};

export const getBalance = async (userId) => {
  const balance = await getOrCreateBalance(userId);
  const packages = await prisma.foxCoinPackage.findMany({
    where: { isActive: true },
    orderBy: { coins: 'asc' },
  });
  return { ...balance, packages };
};

export const getPackages = async () => {
  return prisma.foxCoinPackage.findMany({
    where: { isActive: true },
    orderBy: { coins: 'asc' },
  });
};

export const getPurchaseHistory = async (userId) => {
  return prisma.foxCoinLog.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
};

export const getPurchases = async (userId) => {
  return prisma.foxCoinPurchase.findMany({
    where: { userId },
    include: { package: true },
    orderBy: { purchasedAt: 'desc' },
    take: 50,
  });
};

export const getReceipt = async (userId, purchaseId) => {
  const purchase = await prisma.foxCoinPurchase.findFirst({
    where: { id: purchaseId, userId },
    include: { package: true, user: { select: { name: true, email: true } } },
  });
  if (!purchase) throw new AppError('領収書が見つかりません', 404);

  // 内税10%計算
  const priceIncTax = purchase.price;
  const priceExTax  = Math.round(priceIncTax * 100 / 110);
  const taxAmount   = priceIncTax - priceExTax;

  return {
    receiptNo:    `RC-${purchase.id.slice(0, 8).toUpperCase()}`,
    issuedAt:     purchase.purchasedAt,
    buyerName:    purchase.user.name,
    buyerEmail:   purchase.user.email,
    itemName:     purchase.package?.name ?? `FoxCoin ${purchase.coins}枚`,
    coins:        purchase.coins,
    priceIncTax,
    priceExTax,
    taxAmount,
    taxRate:      10,
    // 適格請求書発行事業者情報
    issuer: {
      name:           'geoAlpine合同会社',
      registrationNo: 'T5390003002074',
      address:        '山形県東根市温泉町1-20-1',
      email:          'info@geoalpine.net',
    },
  };
};

// 管理者がユーザーにコインを付与（または手動購入処理）
export const grantCoins = async (userId, coins, packageId, price, note, stripeSessionId = null) => {
  // Stripe セッション ID による冪等性チェック（重複 webhook 対策）
  if (stripeSessionId) {
    const existing = await prisma.foxCoinPurchase.findUnique({ where: { stripeSessionId } });
    if (existing) {
      console.log(`[FoxCoin] 重複webhook スキップ: session=${stripeSessionId}`);
      return prisma.foxCoinBalance.findUnique({ where: { userId } });
    }
  }
  const balance = await getOrCreateBalance(userId);
  const balanceBefore = balance.balance;
  const balanceAfter = balanceBefore + coins;

  // TERMINATED は維持、それ以外は残高に応じて ACTIVE/据え置き
  const newSimStatus =
    balance.simStatus === 'TERMINATED'
      ? 'TERMINATED'
      : balanceAfter > 0
        ? 'ACTIVE'
        : balance.simStatus;

  // SUSPENDED → ACTIVE になる場合は ParentDevice も復活
  const wasActivated = balance.simStatus === 'SUSPENDED' && newSimStatus === 'ACTIVE';

  const activatedAt = new Date(); // 当日から有効

  const txOps = [
    prisma.foxCoinBalance.update({
      where: { userId },
      data: { balance: balanceAfter, simStatus: newSimStatus },
    }),
    prisma.foxCoinPurchase.create({
      data: {
        userId,
        packageId: packageId || null,
        coins,
        price: price || 0,
        note,
        stripeSessionId: stripeSessionId || null,
        activatedAt,
      },
    }),
    prisma.foxCoinLog.create({
      data: {
        userId,
        type: packageId ? 'PURCHASE' : 'ADMIN_GRANT',
        coins,
        balanceBefore,
        balanceAfter,
        note,
      },
    }),
  ];

  // SORACOM 操作のために事前に対象デバイスを取得
  let devicesToActivate = [];
  if (wasActivated) {
    devicesToActivate = await prisma.parentDevice.findMany({
      where: { userId, simStatus: 'SUSPENDED', soracomSimId: { not: null } },
      select: { soracomSimId: true },
    });
    txOps.push(
      prisma.parentDevice.updateMany({
        where: { userId, simStatus: 'SUSPENDED' },
        data: { simStatus: 'ACTIVE' },
      })
    );
  }

  const [updatedBalance] = await prisma.$transaction(txOps);

  // DB更新後に SORACOM SIM を有効化（失敗しても処理継続）
  for (const d of devicesToActivate) {
    try {
      await activateSimInternal(d.soracomSimId);
    } catch (e) {
      console.warn(`[SORACOM] activate ${d.soracomSimId} failed:`, e.message);
    }
  }

  return updatedBalance;
};

// Stripe Checkout セッション作成（FoxCoin 購入）
export const createCheckoutSession = async (userId, packageId, totpCode) => {
  const pkg = await prisma.foxCoinPackage.findUnique({ where: { id: packageId } });
  if (!pkg || !pkg.isActive) throw new AppError('パッケージが見つかりません', 404);

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('User not found', 404);

  if (!user.twoFactorEnabled || !user.twoFactorSecret) {
    throw new AppError('2段階認証を設定してから購入できます', 403);
  }
  const { valid } = otpVerifySync({ token: totpCode ?? '', secret: user.twoFactorSecret });
  if (!valid) throw new AppError('認証コードが正しくありません', 401);

  // Stripe 未設定時はエラー
  if (!isStripeEnabled || !stripe) throw new AppError('決済が設定されていません', 503);
  if (!pkg.stripePriceId) throw new AppError('このパッケージはまだ購入できません', 503);

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    customer_email: user.email,
    line_items: [{ price: pkg.stripePriceId, quantity: 1 }],
    success_url: `${config.frontendUrl}/foxcoins/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.frontendUrl}/`,
    metadata: {
      type: 'foxcoin',
      userId,
      packageId,
      coins: String(pkg.coins),
      price: String(pkg.price),
    },
  });

  return { url: session.url, sessionId: session.id };
};

// 管理者がコインを手動で増減
export const adminAdjustCoins = async (targetUserId, adminUserId, coins, note) => {
  const balance = await getOrCreateBalance(targetUserId);
  const balanceBefore = balance.balance;
  const balanceAfter = Math.max(0, balanceBefore + coins);

  // TERMINATED は維持、残高に応じて ACTIVE/SUSPENDED
  const newSimStatus = (() => {
    if (balance.simStatus === 'TERMINATED') return 'TERMINATED';
    if (balanceAfter > 0) return 'ACTIVE';
    if (balance.simStatus === 'ACTIVE') return 'SUSPENDED';
    return balance.simStatus;
  })();

  const wasActivated = balance.simStatus === 'SUSPENDED' && newSimStatus === 'ACTIVE';
  const wasSuspended = balance.simStatus === 'ACTIVE' && newSimStatus === 'SUSPENDED';

  // SORACOM 操作のために事前に対象デバイスを取得
  let simDevices = [];
  if (wasActivated) {
    simDevices = await prisma.parentDevice.findMany({
      where: { userId: targetUserId, simStatus: 'SUSPENDED', soracomSimId: { not: null } },
      select: { soracomSimId: true },
    });
  } else if (wasSuspended) {
    simDevices = await prisma.parentDevice.findMany({
      where: { userId: targetUserId, simStatus: 'ACTIVE', soracomSimId: { not: null } },
      select: { soracomSimId: true },
    });
  }

  const txOps = [
    prisma.foxCoinBalance.update({
      where: { userId: targetUserId },
      data: { balance: balanceAfter, simStatus: newSimStatus },
    }),
    prisma.foxCoinLog.create({
      data: {
        userId: targetUserId,
        type: coins >= 0 ? 'ADMIN_GRANT' : 'ADMIN_DEDUCT',
        coins,
        balanceBefore,
        balanceAfter,
        note: note || `管理者 ${adminUserId} による操作`,
      },
    }),
  ];

  if (wasActivated) {
    txOps.push(
      prisma.parentDevice.updateMany({
        where: { userId: targetUserId, simStatus: 'SUSPENDED' },
        data: { simStatus: 'ACTIVE' },
      })
    );
  } else if (wasSuspended) {
    txOps.push(
      prisma.parentDevice.updateMany({
        where: { userId: targetUserId, simStatus: 'ACTIVE' },
        data: { simStatus: 'SUSPENDED' },
      })
    );
  }

  const [updated] = await prisma.$transaction(txOps);

  // DB更新後に SORACOM SIM を操作（失敗しても処理継続）
  for (const d of simDevices) {
    try {
      if (wasActivated) await activateSimInternal(d.soracomSimId);
      else await suspendSimInternal(d.soracomSimId);
    } catch (e) {
      console.warn(`[SORACOM] ${wasActivated ? 'activate' : 'suspend'} ${d.soracomSimId} failed:`, e.message);
    }
  }

  return updated;
};

// 時間バッチ: 全アクティブユーザーから 24 時間ごとに 1 FoxCoin 消費
export const runHourlyDeduction = async () => {
  const now = new Date();
  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24時間前

  // ACTIVE で前回消費から 24 時間以上経過したユーザーを対象
  const activeBalances = await prisma.foxCoinBalance.findMany({
    where: {
      simStatus: 'ACTIVE',
      OR: [
        { lastDeductedAt: null },
        { lastDeductedAt: { lte: windowStart } },
      ],
    },
  });

  const results = { deducted: 0, suspended: 0, errors: 0 };

  for (const bal of activeBalances) {
    try {
      // ACTIVE な親機の台数だけ消費（1台ごとに1FC / 24h）
      const activeParentCount = await prisma.parentDevice.count({
        where: { userId: bal.userId, simStatus: 'ACTIVE' },
      });
      // アクティブな親機が0台なら消費しない
      if (activeParentCount === 0) continue;
      const deductAmount = activeParentCount;

      const balanceBefore = bal.balance;
      const balanceAfter = Math.max(0, balanceBefore - deductAmount);
      const newStatus = balanceAfter === 0 ? 'SUSPENDED' : 'ACTIVE';

      // SORACOM 操作のために事前に対象デバイスを取得
      let devicesToSuspend = [];
      if (newStatus === 'SUSPENDED') {
        devicesToSuspend = await prisma.parentDevice.findMany({
          where: { userId: bal.userId, simStatus: 'ACTIVE', soracomSimId: { not: null } },
          select: { soracomSimId: true },
        });
      }

      const deductOps = [
        prisma.foxCoinBalance.update({
          where: { id: bal.id },
          data: {
            balance: balanceAfter,
            simStatus: newStatus,
            lastDeductedAt: now,
          },
        }),
        prisma.foxCoinLog.create({
          data: {
            userId: bal.userId,
            type: 'HOURLY_DEDUCT',
            coins: -deductAmount,
            balanceBefore,
            balanceAfter,
            note: `自動消費（親機${activeParentCount}台 × 1FC）`,
          },
        }),
      ];

      // 残高 0 で SUSPENDED になる場合は ParentDevice も停止
      if (newStatus === 'SUSPENDED') {
        deductOps.push(
          prisma.parentDevice.updateMany({
            where: { userId: bal.userId, simStatus: 'ACTIVE' },
            data: { simStatus: 'SUSPENDED' },
          })
        );
      }

      await prisma.$transaction(deductOps);

      // DB更新後に SORACOM SIM を停止（失敗しても処理継続）
      for (const d of devicesToSuspend) {
        try {
          await suspendSimInternal(d.soracomSimId);
        } catch (e) {
          console.warn(`[SORACOM] suspend ${d.soracomSimId} failed:`, e.message);
        }
      }

      results.deducted += deductAmount;
      if (newStatus === 'SUSPENDED') results.suspended++;
    } catch {
      results.errors++;
    }
  }

  return results;
};
