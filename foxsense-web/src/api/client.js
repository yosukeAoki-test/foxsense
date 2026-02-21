import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

const client = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

// Request interceptor - add auth token
client.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('foxsense_access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor - handle token refresh
client.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const refreshResponse = await axios.post(
          `${API_BASE_URL}/auth/refresh`,
          {},
          { withCredentials: true }
        );

        const { accessToken } = refreshResponse.data.data;
        localStorage.setItem('foxsense_access_token', accessToken);
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;

        return client(originalRequest);
      } catch (refreshError) {
        localStorage.removeItem('foxsense_access_token');
        localStorage.removeItem('foxsense_user');
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

// ===== 認証API =====

export const authApi = {
  register: async (data) => {
    const response = await client.post('/auth/register', data);
    if (response.data.data.accessToken) {
      localStorage.setItem('foxsense_access_token', response.data.data.accessToken);
    }
    return response.data;
  },

  login: async (email, password) => {
    const response = await client.post('/auth/login', { email, password });
    if (response.data.data.accessToken) {
      localStorage.setItem('foxsense_access_token', response.data.data.accessToken);
    }
    return response.data;
  },

  logout: async () => {
    const response = await client.post('/auth/logout');
    localStorage.removeItem('foxsense_access_token');
    return response.data;
  },

  refresh: async () => {
    const response = await client.post('/auth/refresh');
    if (response.data.data.accessToken) {
      localStorage.setItem('foxsense_access_token', response.data.data.accessToken);
    }
    return response.data;
  },

  me: async () => {
    const response = await client.get('/auth/me');
    return response.data;
  },
};

// ===== 親機API =====

export const getParentDevices = async () => {
  const response = await client.get('/devices/parents');
  return response.data.data;
};

export const getParentDevice = async (parentId) => {
  const response = await client.get(`/devices/parents/${parentId}`);
  return response.data.data;
};

export const createParentDevice = async (data) => {
  const response = await client.post('/devices/parents', data);
  return response.data.data;
};

export const updateParentDevice = async (parentId, data) => {
  const response = await client.put(`/devices/parents/${parentId}`, data);
  return response.data.data;
};

export const deleteParentDevice = async (parentId) => {
  const response = await client.delete(`/devices/parents/${parentId}`);
  return response.data;
};

// ===== 子機API (ユーザー所有) =====

export const getAllChildDevices = async () => {
  const response = await client.get('/devices/children');
  return response.data.data;
};

export const registerChildDevice = async (childData) => {
  const response = await client.post('/devices/children', childData);
  return response.data.data;
};

export const updateChildDevice = async (childId, data) => {
  const response = await client.put(`/devices/children/${childId}`, data);
  return response.data.data;
};

export const deleteChildDevice = async (childId) => {
  const response = await client.delete(`/devices/children/${childId}`);
  return response.data;
};

// ===== 紐付けAPI =====

export const assignChildToParent = async (parentId, childId) => {
  const response = await client.post(`/devices/parents/${parentId}/assign`, { childId });
  return response.data.data;
};

export const unassignChild = async (assignmentId) => {
  const response = await client.delete(`/devices/assignments/${assignmentId}`);
  return response.data.data;
};

export const getAssignmentHistory = async (childId) => {
  const response = await client.get(`/devices/children/${childId}/history`);
  return response.data.data;
};

// ===== センサーデータAPI =====

export const getLatestData = async (parentId) => {
  const response = await client.get(`/sensors/parents/${parentId}/latest`);
  return response.data.data;
};

export const getHistoryData = async (deviceId, period = '24h', type = 'parent') => {
  const response = await client.get(`/sensors/devices/${deviceId}/history`, {
    params: { period, type },
  });
  return response.data.data;
};

export const getDeviceStats = async (deviceId, type = 'parent', startDate, endDate) => {
  const response = await client.get(`/sensors/devices/${deviceId}/stats`, {
    params: { type, startDate, endDate },
  });
  return response.data.data;
};

// ===== アラートAPI =====

export const getAlertSettings = async (parentId) => {
  const response = await client.get(`/devices/parents/${parentId}/alerts`);
  return response.data.data;
};

export const updateAlertSettings = async (parentId, settings) => {
  const response = await client.put(`/devices/parents/${parentId}/alerts`, settings);
  return response.data.data;
};

// ===== SORACOM API =====

export const soracomApi = {
  getSims: async () => {
    const response = await client.get('/soracom/sims');
    return response.data.data;
  },

  getSimDetails: async (simId) => {
    const response = await client.get(`/soracom/sims/${simId}`);
    return response.data.data;
  },

  activateSim: async (simId) => {
    const response = await client.post(`/soracom/sims/${simId}/activate`);
    return response.data.data;
  },

  suspendSim: async (simId) => {
    const response = await client.post(`/soracom/sims/${simId}/suspend`);
    return response.data.data;
  },

  terminateSim: async (simId) => {
    const response = await client.post(`/soracom/sims/${simId}/terminate`);
    return response.data.data;
  },

  getSimUsage: async (simId) => {
    const response = await client.get(`/soracom/sims/${simId}/usage`);
    return response.data.data;
  },
};

// ===== FoxCoin API =====

export const foxCoinApi = {
  getBalance: async () => {
    const response = await client.get('/foxcoins/balance');
    return response.data.data;
  },
  getPackages: async () => {
    const response = await client.get('/foxcoins/packages');
    return response.data.data;
  },
  getHistory: async () => {
    const response = await client.get('/foxcoins/history');
    return response.data.data;
  },
  createCheckout: async (packageId) => {
    const response = await client.post('/foxcoins/checkout', { packageId });
    return response.data.data;
  },
};

// client インスタンスをデフォルトエクスポート（AdminPage用）
export default client;

// ===== ローカルストレージ（デモ用） =====

const STORAGE_KEY = 'foxsense_data';

const loadFromStorage = () => {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
};

const saveToStorage = (data) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    console.error('Failed to save to localStorage');
  }
};

const initializeDemoData = () => {
  const existing = loadFromStorage();

  const now = new Date();
  const testPollination = [
    {
      id: 1001,
      date: new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      cropType: 'watermelon',
      note: 'スイカハウス 1列目',
      createdAt: new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 1002,
      date: new Date(now.getTime() - 38 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      cropType: 'cherry',
      note: 'さくらんぼハウス A区画（収穫間近）',
      createdAt: new Date(now.getTime() - 38 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 1003,
      date: new Date(now.getTime() - 42 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      cropType: 'cherry',
      note: 'さくらんぼハウス B区画（収穫適期）',
      createdAt: new Date(now.getTime() - 42 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ];
  localStorage.setItem('foxsense_pollination', JSON.stringify(testPollination));

  if (existing && existing.initialized) return;

  const sampleChildren = [
    {
      deviceId: '1A2B3C01',
      name: 'スイカハウス 北側',
      location: '入口から10m',
      registeredAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      deviceId: '1A2B3C02',
      name: 'スイカハウス 南側',
      location: '換気扇付近',
      registeredAt: new Date(now.getTime() - 25 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      deviceId: '1A2B3C03',
      name: 'さくらんぼハウス',
      location: '中央通路',
      registeredAt: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ];

  const demoData = {
    initialized: true,
    registeredChildren: sampleChildren,
    alerts: {
      tempMin: 10,
      tempMax: 35,
      humidityMin: 40,
      humidityMax: 85,
      frostWarning: 3,
      frostCritical: 0,
      emailEnabled: true,
      lineEnabled: false,
    },
  };

  saveToStorage(demoData);

  return demoData;
};

// ===== デモ用モックデータ =====

export const getMockData = () => {
  const now = new Date();

  initializeDemoData();

  const stored = loadFromStorage();

  const generateHistory = (baseTemp, baseHumid, enableFrostAlert = true) => {
    const history = [];
    const daysOfData = 30;
    const intervalMinutes = 10;
    const totalPoints = daysOfData * 24 * (60 / intervalMinutes);

    for (let i = totalPoints; i >= 0; i--) {
      const time = new Date(now.getTime() - i * intervalMinutes * 60 * 1000);
      const hour = time.getHours();
      const dayOfYear = Math.floor((time - new Date(time.getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24));

      const hourlyVariation = Math.sin((hour - 6) * Math.PI / 12) * 8;
      const dailyVariation = Math.sin(dayOfYear / 10) * 3;
      const randomVariation = (Math.random() - 0.5) * 2;

      let tempAdjust = 0;
      if (hour >= 2 && hour <= 6) {
        tempAdjust = -5;
      }

      let frostAdjust = 0;
      if (enableFrostAlert && i <= 5) {
        frostAdjust = -(baseTemp - 8) + (5 - i) * -1;
      }

      let temperature = baseTemp + hourlyVariation + dailyVariation + randomVariation + tempAdjust + frostAdjust;
      const humidity = baseHumid - hourlyVariation * 1.5 + Math.random() * 5;

      history.push({
        timestamp: time.toISOString(),
        temperature: Math.max(-5, Math.min(45, temperature)),
        humidity: Math.max(20, Math.min(95, humidity)),
      });
    }
    return history;
  };

  const registeredChildren = stored?.registeredChildren || [];

  const parentId = 'foxsense-001';

  const historyByDevice = {};

  historyByDevice[parentId] = generateHistory(22, 60, true);

  registeredChildren.forEach((child, index) => {
    const baseTemp = 20 + index * 2;
    const baseHumid = 55 + index * 5;
    historyByDevice[child.deviceId] = generateHistory(baseTemp, baseHumid, false);
  });

  const parentHistory = historyByDevice[parentId];
  const latestHistoryData = parentHistory.length > 0 ? parentHistory[parentHistory.length - 1] : null;

  const parent = {
    id: parentId,
    name: '親機（LTE通信ユニット）',
    location: 'スイカハウス 入口',
    isOnline: true,
    lastSeen: now.toISOString(),
    battery: 85,
    signal: 20,
    latestData: latestHistoryData ? {
      temperature: latestHistoryData.temperature,
      humidity: latestHistoryData.humidity,
      timestamp: latestHistoryData.timestamp,
    } : {
      temperature: 24.5,
      humidity: 65.2,
      timestamp: now.toISOString(),
    },
  };

  const children = registeredChildren.map((child, index) => {
    const isOnline = Math.random() > 0.2;
    const lastSeen = isOnline
      ? now.toISOString()
      : new Date(now.getTime() - Math.random() * 2 * 60 * 60 * 1000).toISOString();

    const childHistory = historyByDevice[child.deviceId];
    const childLatestHistory = childHistory && childHistory.length > 0 ? childHistory[childHistory.length - 1] : null;

    return {
      id: child.deviceId,
      name: child.name,
      location: child.location || '',
      isOnline,
      lastSeen,
      battery: Math.floor(50 + Math.random() * 50),
      rssi: -Math.floor(40 + Math.random() * 40),
      latestData: isOnline && childLatestHistory
        ? {
            temperature: childLatestHistory.temperature,
            humidity: childLatestHistory.humidity,
            timestamp: lastSeen,
          }
        : null,
      registeredAt: child.registeredAt,
    };
  });

  const allDevices = [parent, ...children];

  const latest = {};
  allDevices.forEach((device) => {
    if (device.latestData) {
      latest[device.id] = device.latestData;
    }
  });

  const alerts = stored?.alerts || {
    tempMin: 15,
    tempMax: 35,
    humidityMin: 40,
    humidityMax: 85,
    frostWarning: 3,
    frostCritical: 0,
    emailEnabled: true,
    lineEnabled: false,
  };

  return {
    parent,
    children,
    devices: allDevices,
    registeredChildren,
    latest,
    history: historyByDevice[parentId],
    historyByDevice,
    alerts,
  };
};

export const registerChildMock = (childData) => {
  const stored = loadFromStorage() || { registeredChildren: [], alerts: null };
  stored.registeredChildren.push(childData);
  saveToStorage(stored);
  return childData;
};

export const deleteChildMock = (deviceId) => {
  const stored = loadFromStorage() || { registeredChildren: [], alerts: null };
  stored.registeredChildren = stored.registeredChildren.filter(
    (c) => c.deviceId !== deviceId
  );
  saveToStorage(stored);
};

export const saveAlertsMock = (alerts) => {
  const stored = loadFromStorage() || { registeredChildren: [], alerts: null };
  stored.alerts = alerts;
  saveToStorage(stored);
};
