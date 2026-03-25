import prisma from '../../config/db.js';
import { AppError } from '../../middleware/errorHandler.js';
import { adminAdjustCoins } from '../foxcoins/foxcoins.service.js';
import { assignSimToGroup } from '../soracom/soracom.service.js';
import bcrypt from 'bcryptjs';

const SORACOM_GROUP_NAME = 'foxsense';

// ===== ユーザー管理 =====

export const getAllUsers = async () => {
  const users = await prisma.user.findMany({
    include: {
      foxCoinBalance: true,
      parentDevices: {
        select: { id: true, deviceId: true, name: true },
      },
      childDevices: {
        select: { id: true, deviceId: true, name: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return users.map(u => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    createdAt: u.createdAt,
    parentCount: u.parentDevices.length,
    childCount: u.childDevices.length,
    foxCoins: u.foxCoinBalance?.balance ?? 0,
    simStatus: u.foxCoinBalance?.simStatus ?? 'INACTIVE',
  }));
};

export const deleteUser = async (userId, adminId) => {
  if (userId === adminId) throw new AppError('Cannot delete yourself', 400);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('User not found', 404);
  await prisma.user.delete({ where: { id: userId } });
};

export const updateUserRole = async (userId, role, adminId) => {
  if (userId === adminId) throw new AppError('Cannot change your own role', 400);
  if (!['USER', 'ADMIN'].includes(role)) throw new AppError('Invalid role', 400);
  return prisma.user.update({ where: { id: userId }, data: { role } });
};

export const adjustUserCoins = async (targetUserId, adminId, coins, note) => {
  const user = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!user) throw new AppError('User not found', 404);
  return adminAdjustCoins(targetUserId, adminId, coins, note);
};

// ===== デバイス一覧 =====

export const getAllDevices = async () => {
  const parents = await prisma.parentDevice.findMany({
    include: {
      user: { select: { id: true, name: true, email: true } },
      assignments: {
        where: { unassignedAt: null },
        include: { child: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const orphanChildren = await prisma.childDevice.findMany({
    where: {
      assignments: { none: { unassignedAt: null } },
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return {
    parents: parents.map(p => ({
      id: p.id,
      deviceId: p.deviceId,
      name: p.name,
      location: p.location,
      owner: p.user,
      activeChildCount: p.assignments.length,
      activeChildren: p.assignments.map(a => ({
        id: a.child.id,
        deviceId: a.child.deviceId,
        name: a.child.name,
        assignedAt: a.assignedAt,
      })),
      createdAt: p.createdAt,
    })),
    orphanChildren: orphanChildren.map(c => ({
      id: c.id,
      deviceId: c.deviceId,
      name: c.name,
      owner: c.user,
      createdAt: c.createdAt,
    })),
  };
};

// ===== 統計 =====

export const getStats = async () => {
  const [
    totalUsers,
    totalParents,
    totalChildren,
    activeSimCount,
    suspendedSimCount,
    totalCoinsIssued,
    recentPurchases,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.parentDevice.count(),
    prisma.childDevice.count(),
    prisma.foxCoinBalance.count({ where: { simStatus: 'ACTIVE' } }),
    prisma.foxCoinBalance.count({ where: { simStatus: 'SUSPENDED' } }),
    prisma.foxCoinLog.aggregate({
      where: { type: { in: ['PURCHASE', 'ADMIN_GRANT'] } },
      _sum: { coins: true },
    }),
    prisma.foxCoinPurchase.findMany({
      orderBy: { purchasedAt: 'desc' },
      take: 10,
      include: { user: { select: { name: true, email: true } } },
    }),
  ]);

  return {
    users: { total: totalUsers },
    devices: { parents: totalParents, children: totalChildren },
    sim: { active: activeSimCount, suspended: suspendedSimCount },
    foxCoins: {
      totalIssued: totalCoinsIssued._sum.coins ?? 0,
      recentPurchases,
    },
  };
};

// ===== パッケージ管理 =====

export const getPackages = async () => {
  return prisma.foxCoinPackage.findMany({ orderBy: { coins: 'asc' } });
};

export const updatePackage = async (id, data) => {
  return prisma.foxCoinPackage.update({
    where: { id },
    data: {
      name: data.name,
      price: data.price,
      isActive: data.isActive,
    },
  });
};

export const createPackage = async (data) => {
  return prisma.foxCoinPackage.create({
    data: {
      name: data.name,
      coins: data.coins,
      price: data.price ?? 0,
    },
  });
};

// ===== デバイス在庫管理 =====

export const getInventory = async ({ type } = {}) => {
  return prisma.deviceInventory.findMany({
    where: type ? { type } : undefined,
    orderBy: { createdAt: 'desc' },
  });
};

export const bulkCreateInventory = async (devices) => {
  // devices: Array<{ deviceId: string, type: 'PARENT' | 'CHILD' }>
  if (!Array.isArray(devices) || devices.length === 0) {
    throw new AppError('デバイスリストが空です', 400);
  }
  if (devices.length > 200) {
    throw new AppError('一度に登録できるのは200件までです', 400);
  }

  const created = [];
  const skipped = [];

  for (const d of devices) {
    const deviceId = d.deviceId.toUpperCase();
    const exists = await prisma.deviceInventory.findUnique({ where: { deviceId } });
    if (exists) { skipped.push(deviceId); continue; }
    const existing = await prisma.parentDevice.findUnique({ where: { deviceId } })
      || await prisma.childDevice.findUnique({ where: { deviceId } });
    if (existing) { skipped.push(deviceId); continue; }
    const item = await prisma.deviceInventory.create({ data: { deviceId, type: d.type, imsi: d.imsi ?? null } });
    created.push(item);
    // 親機でIMSIあり → SORAACOMグループを自動設定（失敗しても登録は続行）
    if (d.type === 'PARENT' && d.imsi) {
      assignSimToGroup(d.imsi, SORACOM_GROUP_NAME);
    }
  }

  return { created: created.length, skipped: skipped.length, items: created };
};

export const deleteInventoryItem = async (id) => {
  const item = await prisma.deviceInventory.findUnique({ where: { id } });
  if (!item) throw new AppError('在庫IDが見つかりません', 404);
  if (item.claimed) throw new AppError('登録済みのデバイスは削除できません', 400);
  await prisma.deviceInventory.delete({ where: { id } });
};

export const unregisterInventoryItem = async (id) => {
  const item = await prisma.deviceInventory.findUnique({ where: { id } });
  if (!item) throw new AppError('在庫IDが見つかりません', 404);
  if (!item.claimed) throw new AppError('このデバイスは未登録です', 400);

  // 対応するデバイスレコードを削除（カスケードでSensorData/Assignment等も削除される）
  if (item.type === 'PARENT') {
    await prisma.parentDevice.deleteMany({ where: { deviceId: item.deviceId } });
  } else {
    await prisma.childDevice.deleteMany({ where: { deviceId: item.deviceId } });
  }

  // 在庫を未使用状態に戻す
  await prisma.deviceInventory.update({
    where: { id },
    data: { claimed: false, claimedAt: null },
  });
};

// ===== パスワード変更 =====

export const changePassword = async (userId, currentPassword, newPassword) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('User not found', 404);

  const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!isValid) throw new AppError('現在のパスワードが正しくありません', 400);

  if (newPassword.length < 8) throw new AppError('新しいパスワードは8文字以上にしてください', 400);

  const newHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: newHash } });
};
