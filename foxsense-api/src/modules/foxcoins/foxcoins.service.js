import Stripe from 'stripe';
import prisma from '../../config/db.js';
import config from '../../config/index.js';
import { AppError } from '../../middleware/errorHandler.js';

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

// 管理者がユーザーにコインを付与（または手動購入処理）
export const grantCoins = async (userId, coins, packageId, price, note) => {
  const balance = await getOrCreateBalance(userId);
  const balanceBefore = balance.balance;
  const balanceAfter = balanceBefore + coins;

  const activatedAt = new Date();
  activatedAt.setDate(activatedAt.getDate() + 1); // 翌日から有効

  const [updatedBalance] = await prisma.$transaction([
    prisma.foxCoinBalance.update({
      where: { userId },
      data: {
        balance: balanceAfter,
        simStatus: balanceAfter > 0 ? 'ACTIVE' : balance.simStatus,
      },
    }),
    prisma.foxCoinPurchase.create({
      data: {
        userId,
        packageId: packageId || null,
        coins,
        price: price || 0,
        note,
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
  ]);

  return updatedBalance;
};

// Stripe Checkout セッション作成（FoxCoin 購入）
export const createCheckoutSession = async (userId, packageId) => {
  const pkg = await prisma.foxCoinPackage.findUnique({ where: { id: packageId } });
  if (!pkg || !pkg.isActive) throw new AppError('パッケージが見つかりません', 404);

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('User not found', 404);

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

  const [updated] = await prisma.$transaction([
    prisma.foxCoinBalance.update({
      where: { userId: targetUserId },
      data: { balance: balanceAfter },
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
  ]);
  return updated;
};

// 日次バッチ: 全アクティブユーザーから1 FoxCoin消費
export const runDailyDeduction = async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // ACTIVE ステータスで今日まだ消費していないユーザーを対象
  const activeBalances = await prisma.foxCoinBalance.findMany({
    where: {
      simStatus: 'ACTIVE',
      OR: [
        { lastDeductedAt: null },
        { lastDeductedAt: { lt: today } },
      ],
    },
  });

  const results = { deducted: 0, suspended: 0, errors: 0 };

  for (const bal of activeBalances) {
    try {
      const balanceBefore = bal.balance;
      const balanceAfter = Math.max(0, balanceBefore - 1);
      const newStatus = balanceAfter === 0 ? 'SUSPENDED' : 'ACTIVE';

      await prisma.$transaction([
        prisma.foxCoinBalance.update({
          where: { id: bal.id },
          data: {
            balance: balanceAfter,
            simStatus: newStatus,
            lastDeductedAt: new Date(),
          },
        }),
        prisma.foxCoinLog.create({
          data: {
            userId: bal.userId,
            type: 'DAILY_DEDUCT',
            coins: -1,
            balanceBefore,
            balanceAfter,
            note: '日次自動消費',
          },
        }),
      ]);

      results.deducted++;
      if (newStatus === 'SUSPENDED') results.suspended++;
    } catch {
      results.errors++;
    }
  }

  return results;
};
