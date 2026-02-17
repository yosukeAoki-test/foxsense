import prisma from '../../config/db.js';
import { AppError } from '../../middleware/errorHandler.js';

export const getLatestData = async (parentId, userId) => {
  const parent = await prisma.parentDevice.findFirst({
    where: { id: parentId, userId },
    include: {
      childDevices: true,
    },
  });

  if (!parent) {
    throw new AppError('Parent device not found', 404);
  }

  // Get latest data for parent
  const parentLatest = await prisma.sensorData.findFirst({
    where: { parentId },
    orderBy: { timestamp: 'desc' },
  });

  // Get latest data for each child
  const childrenLatest = await Promise.all(
    parent.childDevices.map(async (child) => {
      const latest = await prisma.sensorData.findFirst({
        where: { childId: child.id },
        orderBy: { timestamp: 'desc' },
      });
      return { childId: child.id, data: latest };
    })
  );

  return {
    parent: parentLatest,
    children: Object.fromEntries(
      childrenLatest.map(c => [c.childId, c.data])
    ),
  };
};

export const getHistoryData = async (deviceId, deviceType, period, userId) => {
  // Calculate start date based on period
  const now = new Date();
  let startDate;

  switch (period) {
    case '24h':
      startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    case '7d':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case '30d':
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    default:
      startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }

  // Verify device ownership
  if (deviceType === 'parent') {
    const device = await prisma.parentDevice.findFirst({
      where: { id: deviceId, userId },
    });
    if (!device) {
      throw new AppError('Device not found', 404);
    }

    return prisma.sensorData.findMany({
      where: {
        parentId: deviceId,
        timestamp: { gte: startDate },
      },
      orderBy: { timestamp: 'asc' },
    });
  } else {
    const device = await prisma.childDevice.findFirst({
      where: { id: deviceId },
      include: { parent: true },
    });
    if (!device || device.parent.userId !== userId) {
      throw new AppError('Device not found', 404);
    }

    return prisma.sensorData.findMany({
      where: {
        childId: deviceId,
        timestamp: { gte: startDate },
      },
      orderBy: { timestamp: 'asc' },
    });
  }
};

export const recordSensorData = async (data) => {
  // Find device by hardware ID
  let parentDevice = null;
  let childDevice = null;

  parentDevice = await prisma.parentDevice.findUnique({
    where: { deviceId: data.deviceId },
  });

  if (!parentDevice) {
    childDevice = await prisma.childDevice.findUnique({
      where: { deviceId: data.deviceId },
    });
  }

  if (!parentDevice && !childDevice) {
    throw new AppError('Device not registered', 404);
  }

  const sensorData = await prisma.sensorData.create({
    data: {
      parentId: parentDevice?.id,
      childId: childDevice?.id,
      deviceType: parentDevice ? 'PARENT' : 'CHILD',
      temperature: data.temperature,
      humidity: data.humidity,
      battery: data.battery,
      rssi: data.rssi,
    },
  });

  return sensorData;
};

export const getDeviceStats = async (deviceId, deviceType, startDate, endDate, userId) => {
  const where = deviceType === 'parent'
    ? { parentId: deviceId }
    : { childId: deviceId };

  if (startDate || endDate) {
    where.timestamp = {};
    if (startDate) where.timestamp.gte = new Date(startDate);
    if (endDate) where.timestamp.lte = new Date(endDate);
  }

  const data = await prisma.sensorData.findMany({
    where,
    select: { temperature: true, humidity: true },
  });

  if (data.length === 0) {
    return { count: 0, temperature: null, humidity: null };
  }

  const temps = data.map(d => d.temperature);
  const humids = data.map(d => d.humidity);

  return {
    count: data.length,
    temperature: {
      min: Math.min(...temps),
      max: Math.max(...temps),
      avg: temps.reduce((a, b) => a + b, 0) / temps.length,
    },
    humidity: {
      min: Math.min(...humids),
      max: Math.max(...humids),
      avg: humids.reduce((a, b) => a + b, 0) / humids.length,
    },
  };
};
