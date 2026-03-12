import axios from 'axios';
import config from '../../config/index.js';
import prisma from '../../config/db.js';
import { AppError } from '../../middleware/errorHandler.js';

// テストモード: SORACOM認証情報が未設定の場合
const isTestMode = !config.soracom.authKeyId || config.soracom.authKeyId.startsWith('keyId-xxx');

if (isTestMode) {
  console.log('⚠️  SORACOM: テストモードで動作中（モックSIM）');
}

let cachedToken = null;
let tokenExpiry = null;

// SORACOM APIはsim.imsiをトップレベルに返さない。profiles[simId].primaryImsiに格納される
const getSimImsi = (sim) =>
  sim.profiles?.[sim.simId]?.primaryImsi
  || sim.sessionStatus?.imsi
  || null;

const getSoracomToken = async () => {
  // Return cached token if still valid (with 5 min buffer)
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry - 5 * 60 * 1000) {
    return cachedToken;
  }

  const response = await axios.post(`${config.soracom.apiUrl}/auth`, {
    authKeyId: config.soracom.authKeyId,
    authKey: config.soracom.authKey,
  });

  cachedToken = {
    apiKey: response.data.apiKey,
    token: response.data.token,
  };
  // Token valid for 24 hours
  tokenExpiry = Date.now() + 24 * 60 * 60 * 1000;

  return cachedToken;
};

const soracomApi = async (method, path, data = null) => {
  const auth = await getSoracomToken();

  const response = await axios({
    method,
    url: `${config.soracom.apiUrl}${path}`,
    headers: {
      'X-Soracom-API-Key': auth.apiKey,
      'X-Soracom-Token': auth.token,
    },
    data,
  });

  return response.data;
};

// 内部呼び出し用: ユーザー認証なしで SIM を操作（自動化処理から使用）
export const activateSimInternal = async (simId) => {
  if (isTestMode) {
    console.log(`[SORACOM TEST] SIM ${simId} → activate`);
    return;
  }
  await soracomApi('POST', `/sims/${simId}/activate`);
};

export const suspendSimInternal = async (simId) => {
  if (isTestMode) {
    console.log(`[SORACOM TEST] SIM ${simId} → suspend`);
    return;
  }
  await soracomApi('POST', `/sims/${simId}/suspend`);
};

// SIMに名前タグを設定
export const setSimName = async (simId, name) => {
  if (isTestMode) {
    console.log(`[SORACOM TEST] SIM ${simId} → name "${name}"`);
    return;
  }
  try {
    await soracomApi('PUT', `/sims/${simId}/tags`, [{ tagName: 'name', tagValue: name }]);
  } catch (e) {
    console.warn(`[SORACOM] setSimName failed: ${e.message}`);
  }
};

// IMSIでSIMを指定したグループに割り当て（グループが存在しなければ作成）
export const assignSimToGroup = async (imsi, groupName) => {
  if (isTestMode) {
    console.log(`[SORACOM TEST] IMSI ${imsi} → group "${groupName}"`);
    return;
  }
  try {
    const sims = await soracomApi('GET', '/sims');
    const sim = sims.find(s => getSimImsi(s) === imsi);
    if (!sim) { console.warn(`[SORACOM] IMSI ${imsi} not found`); return; }

    const groups = await soracomApi('GET', '/groups');
    let group = groups.find(g => g.tags?.name === groupName);
    if (!group) {
      group = await soracomApi('POST', '/groups', { tags: { name: groupName } });
    }

    await soracomApi('PUT', `/sims/${sim.simId}/group`, { groupId: group.groupId });
    console.log(`[SORACOM] IMSI ${imsi} → group "${groupName}" (${group.groupId})`);
  } catch (e) {
    console.warn(`[SORACOM] assignSimToGroup failed: ${e.message}`);
  }
};

// 管理者向け: DeviceInventoryに未登録のSIM一覧をSORAACOM APIから取得
export const getAvailableSimsForAdmin = async () => {
  // 既にDeviceInventoryに登録済みのIMSI
  const assigned = await prisma.deviceInventory.findMany({
    where: { imsi: { not: null } },
    select: { imsi: true },
  });
  const assignedSet = new Set(assigned.map(a => a.imsi));

  if (isTestMode) {
    return [
      { simId: 'mock_sim_001', imsi: '440101234567890', groupName: 'foxsense', status: 'ready' },
      { simId: 'mock_sim_002', imsi: '440101234567891', groupName: 'foxsense', status: 'ready' },
      { simId: 'mock_sim_003', imsi: '440101234567892', groupName: null, status: 'ready' },
    ].filter(s => !assignedSet.has(s.imsi));
  }

  const [sims, groups] = await Promise.all([
    soracomApi('GET', '/sims'),
    soracomApi('GET', '/groups'),
  ]);
  const groupMap = new Map(groups.map(g => [g.groupId, g.tags?.name ?? null]));

  return sims
    .map(sim => ({ ...sim, _imsi: getSimImsi(sim) }))
    .filter(sim => sim.status === 'ready' && !assignedSet.has(sim._imsi))
    .map(sim => ({
      simId: sim.simId,
      imsi: sim._imsi,
      groupName: sim.groupId ? (groupMap.get(sim.groupId) ?? null) : null,
      status: sim.status,
    }));
};

export const getSimByImsi = async (imsi) => {
  if (isTestMode) {
    return { simId: `mock_sim_${imsi}` };
  }
  const sims = await soracomApi('GET', '/sims');
  const found = sims.find(s => getSimImsi(s) === imsi);
  if (!found) throw new AppError('IMSIに一致するSIMが見つかりません', 404);
  return found;
};

export const getSims = async (userId) => {
  // Get user's devices with SIM IDs
  const devices = await prisma.parentDevice.findMany({
    where: { userId },
    select: { id: true, soracomSimId: true, simStatus: true, name: true, deviceId: true },
  });

  // テストモード: モックSIMデータを返す
  if (isTestMode) {
    return devices.map(device => ({
      simId: device.soracomSimId || `mock_sim_${device.deviceId}`,
      deviceId: device.id,
      deviceName: device.name,
      status: device.simStatus?.toLowerCase() || 'active',
      imsi: `44010${Math.random().toString().slice(2, 12)}`,
      msisdn: `8180${Math.random().toString().slice(2, 10)}`,
      ipAddress: `10.128.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
      moduleType: 'plan01s',
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      lastSeen: new Date().toISOString(),
      testMode: true,
    }));
  }

  if (devices.filter(d => d.soracomSimId).length === 0) {
    return [];
  }

  // Fetch SIM details from SORACOM
  try {
    const sims = await soracomApi('GET', '/sims');
    const userSimIds = new Set(devices.map(d => d.soracomSimId));

    return sims
      .filter(sim => userSimIds.has(sim.simId))
      .map(sim => {
        const device = devices.find(d => d.soracomSimId === sim.simId);
        return {
          simId: sim.simId,
          deviceId: device?.id,
          deviceName: device?.name,
          status: sim.status,
          imsi: getSimImsi(sim),
          msisdn: sim.profiles?.[sim.simId]?.subscribers?.[getSimImsi(sim)]?.msisdn ?? null,
          ipAddress: sim.sessionStatus?.ueIpAddress ?? null,
          moduleType: sim.moduleType,
          createdAt: sim.createdTime,
          lastSeen: sim.previousSession?.createdTime ?? null,
        };
      });
  } catch (error) {
    console.error('SORACOM API error:', error.response?.data || error.message);
    throw new AppError('Failed to fetch SIM information', 502);
  }
};

export const getSimDetails = async (simId, userId) => {
  // SIM IDとユーザーの所有関係を確認
  const device = await prisma.parentDevice.findFirst({
    where: { userId, soracomSimId: simId },
  });

  if (!device) {
    throw new AppError('SIM not found', 404);
  }

  // テストモード
  if (isTestMode) {
    return {
      simId: simId,
      status: device.simStatus?.toLowerCase() || 'active',
      imsi: `44010${Math.random().toString().slice(2, 12)}`,
      msisdn: `8180${Math.random().toString().slice(2, 10)}`,
      ipAddress: `10.128.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
      moduleType: 'plan01s',
      subscription: { name: 'plan01s' },
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      lastSeen: new Date().toISOString(),
      testMode: true,
    };
  }

  try {
    const sim = await soracomApi('GET', `/sims/${simId}`);
    const imsi = getSimImsi(sim);
    return {
      simId: sim.simId,
      status: sim.status,
      imsi,
      msisdn: sim.profiles?.[sim.simId]?.subscribers?.[imsi]?.msisdn ?? null,
      ipAddress: sim.sessionStatus?.ueIpAddress ?? null,
      moduleType: sim.moduleType,
      subscription: sim.profiles?.[sim.simId]?.subscribers?.[imsi]?.subscription ?? null,
      createdAt: sim.createdTime,
      lastSeen: sim.previousSession?.createdTime ?? null,
    };
  } catch (error) {
    console.error('SORACOM API error:', error.response?.data || error.message);
    throw new AppError('Failed to fetch SIM details', 502);
  }
};

export const activateSim = async (simId, userId) => {
  const device = await prisma.parentDevice.findFirst({
    where: { userId, soracomSimId: simId },
  });

  if (!device) {
    throw new AppError('SIM not found', 404);
  }

  // コイン残高チェック
  const balance = await prisma.foxCoinBalance.findUnique({ where: { userId } });
  if (!balance || balance.balance <= 0) {
    throw new AppError('FoxCoinが不足しています。コインを購入してからSIMを有効化してください。', 403);
  }

  // テストモード
  if (isTestMode) {
    await prisma.parentDevice.update({
      where: { id: device.id },
      data: { simStatus: 'ACTIVE' },
    });
    return { message: 'SIM activated successfully (test mode)', testMode: true };
  }

  try {
    await soracomApi('POST', `/sims/${simId}/activate`);

    await prisma.parentDevice.update({
      where: { id: device.id },
      data: { simStatus: 'ACTIVE' },
    });

    return { message: 'SIM activated successfully' };
  } catch (error) {
    console.error('SORACOM API error:', error.response?.status, error.message);
    throw new AppError('Failed to activate SIM', 502);
  }
};

export const suspendSim = async (simId, userId) => {
  const device = await prisma.parentDevice.findFirst({
    where: { userId, soracomSimId: simId },
  });

  if (!device) {
    throw new AppError('SIM not found', 404);
  }

  // テストモード
  if (isTestMode) {
    await prisma.parentDevice.update({
      where: { id: device.id },
      data: { simStatus: 'SUSPENDED' },
    });
    return { message: 'SIM suspended successfully (test mode)', testMode: true };
  }

  try {
    await soracomApi('POST', `/sims/${simId}/suspend`);

    await prisma.parentDevice.update({
      where: { id: device.id },
      data: { simStatus: 'SUSPENDED' },
    });

    return { message: 'SIM suspended successfully' };
  } catch (error) {
    console.error('SORACOM API error:', error.response?.status, error.message);
    throw new AppError('Failed to suspend SIM', 502);
  }
};

export const terminateSim = async (simId, userId) => {
  const device = await prisma.parentDevice.findFirst({
    where: { userId, soracomSimId: simId },
  });

  if (!device) {
    throw new AppError('SIM not found', 404);
  }

  // テストモード
  if (isTestMode) {
    await prisma.parentDevice.update({
      where: { id: device.id },
      data: { simStatus: 'TERMINATED' },
    });
    return { message: 'SIM terminated successfully (test mode)', testMode: true };
  }

  try {
    await soracomApi('POST', `/sims/${simId}/terminate`);

    await prisma.parentDevice.update({
      where: { id: device.id },
      data: { simStatus: 'TERMINATED' },
    });

    return { message: 'SIM terminated successfully' };
  } catch (error) {
    console.error('SORACOM API error:', error.response?.status, error.message);
    throw new AppError('Failed to terminate SIM', 502);
  }
};

export const getSimUsage = async (simId, userId) => {
  const device = await prisma.parentDevice.findFirst({
    where: { userId, soracomSimId: simId },
  });

  if (!device) {
    throw new AppError('SIM not found', 404);
  }

  // テストモード: モック通信量データを返す
  if (isTestMode) {
    const mockUsage = [];
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      mockUsage.push({
        date: date.toISOString().split('T')[0],
        uploadByteSizeTotal: Math.floor(Math.random() * 5000) + 1000,
        downloadByteSizeTotal: Math.floor(Math.random() * 10000) + 2000,
      });
    }
    return {
      simId,
      period: '30d',
      dataUsage: mockUsage,
      testMode: true,
    };
  }

  try {
    // Get usage for the last 30 days
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const usage = await soracomApi(
      'GET',
      `/stats/air/sims/${simId}?from=${thirtyDaysAgo.getTime()}&to=${now.getTime()}&period=day`
    );

    return {
      simId,
      period: '30d',
      dataUsage: usage,
    };
  } catch (error) {
    console.error('SORACOM API error:', error.response?.data || error.message);
    throw new AppError('Failed to fetch SIM usage', 502);
  }
};
