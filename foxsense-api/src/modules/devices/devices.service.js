import prisma from '../../config/db.js';
import { AppError } from '../../middleware/errorHandler.js';
import { computeParentIdHash, hashToHex } from '../../utils/deviceHash.js';

// Parent Devices
export const getParentDevices = async (userId) => {
  const devices = await prisma.parentDevice.findMany({
    where: { userId },
    include: {
      childDevices: true,
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
    latestData: device.sensorData[0] || null,
    sensorData: undefined,
  }));
};

export const getParentDevice = async (id, userId) => {
  const device = await prisma.parentDevice.findFirst({
    where: { id, userId },
    include: {
      childDevices: true,
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
    latestData: device.sensorData[0] || null,
    sensorData: undefined,
  };
};

export const createParentDevice = async (userId, data) => {
  const device = await prisma.parentDevice.create({
    data: {
      userId,
      deviceId: data.deviceId,
      name: data.name,
      location: data.location,
      soracomSimId: data.soracomSimId,
      alertSettings: {
        create: {}, // Create with defaults
      },
    },
    include: {
      alertSettings: true,
    },
  });

  return device;
};

export const updateParentDevice = async (id, userId, data) => {
  const device = await prisma.parentDevice.findFirst({
    where: { id, userId },
  });

  if (!device) {
    throw new AppError('Parent device not found', 404);
  }

  return prisma.parentDevice.update({
    where: { id },
    data: {
      name: data.name,
      location: data.location,
    },
  });
};

export const deleteParentDevice = async (id, userId) => {
  const device = await prisma.parentDevice.findFirst({
    where: { id, userId },
  });

  if (!device) {
    throw new AppError('Parent device not found', 404);
  }

  await prisma.parentDevice.delete({ where: { id } });
};

// Child Devices
export const getChildDevices = async (parentId, userId) => {
  const parent = await prisma.parentDevice.findFirst({
    where: { id: parentId, userId },
  });

  if (!parent) {
    throw new AppError('Parent device not found', 404);
  }

  const children = await prisma.childDevice.findMany({
    where: { parentId },
    include: {
      sensorData: {
        orderBy: { timestamp: 'desc' },
        take: 1,
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return children.map(child => ({
    ...child,
    latestData: child.sensorData[0] || null,
    sensorData: undefined,
  }));
};

export const createChildDevice = async (parentId, userId, data) => {
  const parent = await prisma.parentDevice.findFirst({
    where: { id: parentId, userId },
  });

  if (!parent) {
    throw new AppError('Parent device not found', 404);
  }

  return prisma.childDevice.create({
    data: {
      parentId,
      deviceId: data.deviceId,
      name: data.name,
      location: data.location,
    },
  });
};

export const updateChildDevice = async (id, userId, data) => {
  const child = await prisma.childDevice.findFirst({
    where: { id },
    include: { parent: true },
  });

  if (!child || child.parent.userId !== userId) {
    throw new AppError('Child device not found', 404);
  }

  return prisma.childDevice.update({
    where: { id },
    data: {
      name: data.name,
      location: data.location,
    },
  });
};

export const deleteChildDevice = async (id, userId) => {
  const child = await prisma.childDevice.findFirst({
    where: { id },
    include: { parent: true },
  });

  if (!child || child.parent.userId !== userId) {
    throw new AppError('Child device not found', 404);
  }

  await prisma.childDevice.delete({ where: { id } });
};

// Alert Settings
export const getAlertSettings = async (parentId, userId) => {
  const device = await prisma.parentDevice.findFirst({
    where: { id: parentId, userId },
    include: { alertSettings: true },
  });

  if (!device) {
    throw new AppError('Parent device not found', 404);
  }

  return device.alertSettings;
};

export const updateAlertSettings = async (parentId, userId, data) => {
  const device = await prisma.parentDevice.findFirst({
    where: { id: parentId, userId },
  });

  if (!device) {
    throw new AppError('Parent device not found', 404);
  }

  return prisma.alertSettings.upsert({
    where: { parentId },
    update: data,
    create: {
      parentId,
      ...data,
    },
  });
};

// Device Config (デバイス認証: secret使用)
export const getDeviceConfig = async (deviceId, secret) => {
  const device = await prisma.parentDevice.findUnique({
    where: { deviceId },
    include: {
      childDevices: {
        select: {
          id: true,
          deviceId: true,
          logicalId: true,
          pairingStatus: true,
          name: true,
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!device) {
    throw new AppError('Device not found', 404);
  }

  if (device.deviceSecret !== secret) {
    throw new AppError('Invalid device secret', 401);
  }

  const parentIdHash = computeParentIdHash(deviceId);

  return {
    deviceId: device.deviceId,
    parentIdHash,
    parentIdHashHex: hashToHex(parentIdHash),
    children: device.childDevices.map((child, index) => ({
      id: child.id,
      deviceId: child.deviceId,
      deviceIdNum: parseInt(child.deviceId, 16),
      logicalId: child.logicalId ?? index,
      pairingStatus: child.pairingStatus,
      name: child.name,
    })),
  };
};

export const reportPairingResult = async (deviceId, childDeviceId, status, secret) => {
  const device = await prisma.parentDevice.findUnique({
    where: { deviceId },
  });

  if (!device) {
    throw new AppError('Device not found', 404);
  }

  if (device.deviceSecret !== secret) {
    throw new AppError('Invalid device secret', 401);
  }

  const child = await prisma.childDevice.findFirst({
    where: { deviceId: childDeviceId, parentId: device.id },
  });

  if (!child) {
    throw new AppError('Child device not found', 404);
  }

  return prisma.childDevice.update({
    where: { id: child.id },
    data: { pairingStatus: status },
  });
};
