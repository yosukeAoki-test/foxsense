import prisma from '../../config/db.js';
import { AppError } from '../../middleware/errorHandler.js';

export const getLatestData = async (parentId, userId) => {
  const parent = await prisma.parentDevice.findFirst({
    where: { id: parentId, userId },
    include: {
      assignments: {
        where: { pairingStatus: 'PAIRED' },
        include: { child: true },
      },
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
    parent.assignments.map(async (assignment) => {
      const child = assignment.child;
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
      where: { id: deviceId, userId },
    });
    if (!device) {
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
  // デバイス検索
  let parentDevice = null;
  let childDevice = null;

  const normalizedDeviceId = data.deviceId?.toUpperCase?.() ?? data.deviceId;

  parentDevice = await prisma.parentDevice.findUnique({
    where: { deviceId: normalizedDeviceId },
  });

  if (!parentDevice) {
    childDevice = await prisma.childDevice.findUnique({
      where: { deviceId: normalizedDeviceId },
      include: {
        assignments: {
          where: { unassignedAt: null },
          include: { parent: true },
          take: 1,
        },
      },
    });
  }

  if (!parentDevice && !childDevice) {
    throw new AppError('Device not registered', 404);
  }

  // デバイスシークレット認証
  // 親機: 自身のシークレットで検証
  // 子機: 紐付き親機のシークレットで検証（子機データも親機が送信するため）
  if (parentDevice) {
    if (!data.secret || data.secret !== parentDevice.deviceSecret) {
      throw new AppError('Invalid device secret', 401);
    }
  } else if (childDevice) {
    const parentAssignment = childDevice.assignments[0];
    if (!parentAssignment) {
      throw new AppError('Child device has no assigned parent', 400);
    }
    if (!data.secret || data.secret !== parentAssignment.parent.deviceSecret) {
      throw new AppError('Invalid device secret', 401);
    }
  }

  // センサー値の範囲バリデーション
  if (typeof data.temperature !== 'number' || data.temperature < -50 || data.temperature > 80) {
    throw new AppError('Invalid temperature value', 400);
  }
  if (typeof data.humidity !== 'number' || data.humidity < 0 || data.humidity > 100) {
    throw new AppError('Invalid humidity value', 400);
  }

  const sensorData = await prisma.sensorData.create({
    data: {
      parentId: parentDevice?.id,
      childId: childDevice?.id,
      deviceType: parentDevice ? 'PARENT' : 'CHILD',
      temperature: data.temperature,
      humidity: data.humidity,
      battery: data.battery ?? null,
      rssi: data.rssi ?? null,
    },
  });

  return sensorData;
};

/**
 * デバイスからのバルクセンサーデータ受信
 * ファームウェアが1回のHTTPリクエストで親機+子機データを一括送信するためのエンドポイント
 * {
 *   parent_id: "A1B2C3D4",   // 親機のdeviceId
 *   secret: "xxxx",           // 親機のdeviceSecret
 *   parent: { temperature, humidity, battery, signal },
 *   children: [{ device_id, temperature, humidity, rssi, battery, received }, ...]
 * }
 */
export const recordBulkSensorData = async (data) => {
  // 親機検索・シークレット認証
  const parentDevice = await prisma.parentDevice.findUnique({
    where: { deviceId: data.parent_id },
  });
  if (!parentDevice) throw new AppError('Parent device not registered', 404);
  if (!data.secret || data.secret !== parentDevice.deviceSecret) {
    throw new AppError('Invalid device secret', 401);
  }

  const results = { parent: null, children: [] };

  // 親機センサーデータを記録
  if (data.parent) {
    const p = data.parent;
    if (typeof p.temperature !== 'number' || p.temperature < -50 || p.temperature > 80) {
      throw new AppError('Invalid parent temperature value', 400);
    }
    if (typeof p.humidity !== 'number' || p.humidity < 0 || p.humidity > 100) {
      throw new AppError('Invalid parent humidity value', 400);
    }
    const parentRecord = await prisma.sensorData.create({
      data: {
        parentId: parentDevice.id,
        deviceType: 'PARENT',
        temperature: p.temperature,
        humidity: p.humidity,
        pressure: (typeof p.pressure === 'number' && p.pressure > 0) ? p.pressure : null,
        battery: p.battery ?? null,
        rssi: p.signal ?? null,
      },
    });
    results.parent = parentRecord.id;
  }

  // 子機センサーデータを記録（received=true のもののみ）
  if (Array.isArray(data.children)) {
    for (const c of data.children) {
      if (!c.received) continue;
      if (typeof c.temperature !== 'number' || c.temperature < -50 || c.temperature > 80) continue;
      if (typeof c.humidity !== 'number' || c.humidity < 0 || c.humidity > 100) continue;

      const childDevice = await prisma.childDevice.findUnique({
        where: { deviceId: c.device_id.toUpperCase() },
      });
      if (!childDevice) continue; // 未登録子機はスキップ

      const childRecord = await prisma.sensorData.create({
        data: {
          childId: childDevice.id,
          deviceType: 'CHILD',
          temperature: c.temperature,
          humidity: c.humidity,
          pressure: (typeof c.pressure === 'number' && c.pressure > 0) ? c.pressure : null,
          battery: c.battery ?? null,
          voltage: (typeof c.voltage === 'number' && c.voltage > 0) ? c.voltage : null,
          rssi: c.rssi ?? null,
        },
      });
      results.children.push({ deviceId: c.device_id, id: childRecord.id });
    }
  }

  return results;
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
