import prisma from '../../config/db.js';
import { AppError } from '../../middleware/errorHandler.js';
import { computeParentIdHash, hashToHex } from '../../utils/deviceHash.js';
import { getSimByImsi, setSimName } from '../soracom/soracom.service.js';

// ===== Parent Devices =====

export const getParentDevices = async (userId) => {
  const devices = await prisma.parentDevice.findMany({
    where: { userId },
    include: {
      assignments: {
        where: { unassignedAt: null },
        include: { child: true },
      },
      alertSettings: true,
      sensorData: {
        orderBy: { timestamp: 'desc' },
        take: 1,
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return devices.map(device => ({
    ...device,
    activeChildren: device.assignments.map(a => ({
      ...a.child,
      assignmentId: a.id,
      logicalId: a.logicalId,
      pairingStatus: a.pairingStatus,
      assignedAt: a.assignedAt,
    })),
    assignments: undefined,
    latestData: device.sensorData[0] || null,
    sensorData: undefined,
  }));
};

export const getParentDevice = async (id, userId) => {
  const device = await prisma.parentDevice.findFirst({
    where: { id, userId },
    include: {
      assignments: {
        where: { unassignedAt: null },
        include: { child: true },
      },
      alertSettings: true,
      sensorData: {
        orderBy: { timestamp: 'desc' },
        take: 1,
      },
    },
  });

  if (!device) {
    throw new AppError('Parent device not found', 404);
  }

  return {
    ...device,
    activeChildren: device.assignments.map(a => ({
      ...a.child,
      assignmentId: a.id,
      logicalId: a.logicalId,
      pairingStatus: a.pairingStatus,
      assignedAt: a.assignedAt,
    })),
    assignments: undefined,
    latestData: device.sensorData[0] || null,
    sensorData: undefined,
  };
};

export const createParentDevice = async (userId, data) => {
  const deviceId = data.deviceId.toUpperCase();
  const existing = await prisma.parentDevice.findUnique({
    where: { deviceId },
  });
  if (existing) {
    throw new AppError('このデバイスIDはすでに登録されています', 409);
  }

  // 在庫照合: DeviceInventoryにあれば claimed に更新、なければエラー
  let resolvedSimId = data.soracomSimId ?? null;

  // soracomSimId の重複チェック（直接指定された場合）
  if (resolvedSimId) {
    const simConflict = await prisma.parentDevice.findUnique({ where: { soracomSimId: resolvedSimId } });
    if (simConflict) {
      throw new AppError('このSIM IDはすでに別のデバイスに登録されています', 409);
    }
  }

  const inventoryCount = await prisma.deviceInventory.count({ where: { type: 'PARENT' } });
  if (inventoryCount > 0) {
    const invItem = await prisma.deviceInventory.findUnique({ where: { deviceId } });
    if (!invItem || invItem.type !== 'PARENT') {
      throw new AppError('このデバイスIDは登録されていません。ラベルのIDをご確認ください。', 400);
    }
    if (invItem.claimed) {
      throw new AppError('このデバイスIDはすでに別のユーザーに登録されています', 409);
    }
    await prisma.deviceInventory.update({
      where: { id: invItem.id },
      data: { claimed: true, claimedAt: new Date() },
    });
    if (invItem.imsi) {
      // IMSI の重複チェック
      const imsiConflict = await prisma.deviceInventory.findFirst({
        where: { imsi: invItem.imsi, claimed: true, deviceId: { not: deviceId } },
      });
      if (imsiConflict) {
        throw new AppError('このSIM（IMSI）はすでに別のデバイスに登録されています', 409);
      }
      try {
        const sim = await getSimByImsi(invItem.imsi);
        resolvedSimId = sim.simId;
        // 解決した SIM ID の重複チェック
        const simConflict = await prisma.parentDevice.findUnique({ where: { soracomSimId: resolvedSimId } });
        if (simConflict) {
          throw new AppError('このSIM IDはすでに別のデバイスに登録されています', 409);
        }
      } catch (e) {
        if (e instanceof AppError) throw e;
        console.warn('SORACOM SIM lookup failed:', e.message);
      }
    }
  }

  const created = await prisma.parentDevice.create({
    data: {
      userId,
      deviceId,
      name: data.name,
      location: data.location,
      soracomSimId: resolvedSimId,
      alertSettings: { create: {} },
    },
    include: { alertSettings: true },
  });

  // SIMが紐付いていればSORAACOM上の名前もユーザー名に設定
  if (resolvedSimId) {
    setSimName(resolvedSimId, data.name);
  }

  return created;
};

export const updateParentDevice = async (id, userId, data) => {
  const device = await prisma.parentDevice.findFirst({ where: { id, userId } });
  if (!device) throw new AppError('Parent device not found', 404);

  const updated = await prisma.parentDevice.update({
    where: { id },
    data: { name: data.name, location: data.location },
  });

  // 名前変更時もSORAACOM上の名前を同期
  if (data.name && device.soracomSimId) {
    setSimName(device.soracomSimId, data.name);
  }

  return updated;
};

export const deleteParentDevice = async (id, userId) => {
  const device = await prisma.parentDevice.findFirst({ where: { id, userId } });
  if (!device) throw new AppError('Parent device not found', 404);

  await prisma.parentDevice.delete({ where: { id } });
};

// ===== Child Devices (ユーザー所有) =====

export const getAllChildDevices = async (userId) => {
  const children = await prisma.childDevice.findMany({
    where: { userId },
    include: {
      assignments: {
        where: { unassignedAt: null },
        include: { parent: true },
      },
      sensorData: {
        orderBy: { timestamp: 'desc' },
        take: 1,
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return children.map(child => ({
    ...child,
    currentAssignment: child.assignments[0]
      ? {
          assignmentId: child.assignments[0].id,
          parentId: child.assignments[0].parentId,
          parentName: child.assignments[0].parent.name,
          logicalId: child.assignments[0].logicalId,
          pairingStatus: child.assignments[0].pairingStatus,
          assignedAt: child.assignments[0].assignedAt,
        }
      : null,
    assignments: undefined,
    latestData: child.sensorData[0] || null,
    sensorData: undefined,
  }));
};

export const createChildDevice = async (userId, data) => {
  const deviceId = data.deviceId.toUpperCase();
  const existing = await prisma.childDevice.findUnique({
    where: { deviceId },
  });
  if (existing) {
    throw new AppError('このデバイスIDはすでに登録されています', 409);
  }

  // 在庫照合: DeviceInventoryにあれば claimed に更新、なければエラー
  const inventoryCount = await prisma.deviceInventory.count({ where: { type: 'CHILD' } });
  if (inventoryCount > 0) {
    const invItem = await prisma.deviceInventory.findUnique({ where: { deviceId } });
    if (!invItem || invItem.type !== 'CHILD') {
      throw new AppError('このデバイスIDは登録されていません。ラベルのIDをご確認ください。', 400);
    }
    if (invItem.claimed) {
      throw new AppError('このデバイスIDはすでに別のユーザーに登録されています', 409);
    }
    await prisma.deviceInventory.update({
      where: { id: invItem.id },
      data: { claimed: true, claimedAt: new Date() },
    });
  }

  return prisma.childDevice.create({
    data: {
      userId,
      deviceId,
      name: data.name,
      location: data.location,
    },
  });
};

export const updateChildDevice = async (id, userId, data) => {
  const child = await prisma.childDevice.findFirst({ where: { id, userId } });
  if (!child) throw new AppError('Child device not found', 404);

  return prisma.childDevice.update({
    where: { id },
    data: { name: data.name, location: data.location },
  });
};

export const deleteChildDevice = async (id, userId) => {
  const child = await prisma.childDevice.findFirst({ where: { id, userId } });
  if (!child) throw new AppError('Child device not found', 404);

  await prisma.childDevice.delete({ where: { id } });
};

// ===== Assignments (紐付け管理) =====

export const assignChildToParent = async (parentId, childId, userId) => {
  // 親機の所有確認
  const parent = await prisma.parentDevice.findFirst({ where: { id: parentId, userId } });
  if (!parent) throw new AppError('Parent device not found', 404);

  // 子機の所有確認
  const child = await prisma.childDevice.findFirst({ where: { id: childId, userId } });
  if (!child) throw new AppError('Child device not found', 404);

  // この子機が既に別の親機にアクティブで紐付いていないか確認
  const activeAssignment = await prisma.deviceAssignment.findFirst({
    where: { childId, unassignedAt: null },
    include: { parent: true },
  });
  if (activeAssignment) {
    throw new AppError(
      `Child device is already assigned to "${activeAssignment.parent.name}". Please unassign first.`,
      409
    );
  }

  return prisma.deviceAssignment.create({
    data: { parentId, childId },
    include: { parent: true, child: true },
  });
};

export const unassignChild = async (assignmentId, userId) => {
  const assignment = await prisma.deviceAssignment.findFirst({
    where: { id: assignmentId },
    include: { parent: true },
  });

  if (!assignment) throw new AppError('Assignment not found', 404);
  if (assignment.parent.userId !== userId) throw new AppError('Unauthorized', 403);
  if (assignment.unassignedAt) throw new AppError('Already unassigned', 400);

  return prisma.deviceAssignment.update({
    where: { id: assignmentId },
    data: { unassignedAt: new Date() },
    include: { parent: true, child: true },
  });
};

export const getAssignmentHistory = async (childId, userId) => {
  const child = await prisma.childDevice.findFirst({ where: { id: childId, userId } });
  if (!child) throw new AppError('Child device not found', 404);

  return prisma.deviceAssignment.findMany({
    where: { childId },
    include: { parent: true },
    orderBy: { assignedAt: 'desc' },
  });
};

// ===== Device Config (ファームウェア認証) =====

export const getDeviceConfig = async (deviceId, secret) => {
  const device = await prisma.parentDevice.findUnique({
    where: { deviceId },
    include: {
      assignments: {
        where: { unassignedAt: null },
        include: { child: true },
        orderBy: { assignedAt: 'asc' },
      },
    },
  });

  if (!device) throw new AppError('Device not found', 404);
  if (device.deviceSecret !== secret) throw new AppError('Invalid device secret', 401);

  const parentIdHash = computeParentIdHash(deviceId);

  return {
    deviceId: device.deviceId,
    parentIdHash,
    parentIdHashHex: hashToHex(parentIdHash),
    children: device.assignments.map((a, index) => ({
      id: a.child.id,
      assignmentId: a.id,
      deviceId: a.child.deviceId,
      deviceIdNum: parseInt(a.child.deviceId, 16),
      logicalId: a.logicalId ?? index,
      pairingStatus: a.pairingStatus,
      name: a.child.name,
    })),
  };
};

export const reportPairingResult = async (deviceId, childDeviceId, status, secret) => {
  const device = await prisma.parentDevice.findUnique({ where: { deviceId } });
  if (!device) throw new AppError('Device not found', 404);
  if (device.deviceSecret !== secret) throw new AppError('Invalid device secret', 401);

  const child = await prisma.childDevice.findUnique({ where: { deviceId: childDeviceId } });
  if (!child) throw new AppError('Child device not found', 404);

  const assignment = await prisma.deviceAssignment.findFirst({
    where: { parentId: device.id, childId: child.id, unassignedAt: null },
  });
  if (!assignment) throw new AppError('No active assignment found', 404);

  return prisma.deviceAssignment.update({
    where: { id: assignment.id },
    data: { pairingStatus: status },
  });
};

// ===== Alert Settings =====

export const getAlertSettings = async (parentId, userId) => {
  const device = await prisma.parentDevice.findFirst({
    where: { id: parentId, userId },
    include: { alertSettings: true },
  });
  if (!device) throw new AppError('Parent device not found', 404);
  return device.alertSettings;
};

export const updateAlertSettings = async (parentId, userId, data) => {
  const device = await prisma.parentDevice.findFirst({ where: { id: parentId, userId } });
  if (!device) throw new AppError('Parent device not found', 404);

  return prisma.alertSettings.upsert({
    where: { parentId },
    update: data,
    create: { parentId, ...data },
  });
};
