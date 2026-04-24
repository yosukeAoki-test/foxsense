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

  forgotPassword: async (email) => {
    const response = await client.post('/auth/forgot-password', { email });
    return response.data;
  },

  resetPassword: async (token, password) => {
    const response = await client.post('/auth/reset-password', { token, password });
    return response.data;
  },

  verify2fa: async (tempToken, code) => {
    const response = await client.post('/auth/2fa/verify-login', { tempToken, code });
    if (response.data.data?.accessToken) {
      localStorage.setItem('foxsense_access_token', response.data.data.accessToken);
    }
    return response.data;
  },

  setup2fa: async () => {
    const response = await client.post('/auth/2fa/setup');
    return response.data;
  },

  enable2fa: async (code) => {
    const response = await client.post('/auth/2fa/enable', { code });
    return response.data;
  },

  disable2fa: async (code) => {
    const response = await client.post('/auth/2fa/disable', { code });
    return response.data;
  },

  getLineUrl: async () => {
    const response = await client.get('/auth/line/url', { params: { origin: window.location.origin } });
    return response.data.data;
  },

  lineCallback: async (code, redirectUri) => {
    const response = await client.post('/auth/line/callback', { code, redirectUri });
    if (response.data.data?.accessToken) {
      localStorage.setItem('foxsense_access_token', response.data.data.accessToken);
    }
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
  createCheckout: async (packageId, totpCode) => {
    const response = await client.post('/foxcoins/checkout', { packageId, totpCode });
    return response.data.data;
  },
  getPurchases: async () => {
    const response = await client.get('/foxcoins/purchases');
    return response.data.data;
  },
  getReceipt: async (purchaseId) => {
    const response = await client.get(`/foxcoins/purchases/${purchaseId}/receipt`);
    return response.data.data;
  },
};

// ===== Admin Inventory API =====

export const adminInventoryApi = {
  list: async (type) => {
    const params = type ? { type } : {};
    const response = await client.get('/admin/inventory', { params });
    return response.data.data;
  },
  bulkCreate: async (devices) => {
    const response = await client.post('/admin/inventory', { devices });
    return response.data.data;
  },
  delete: async (id) => {
    const response = await client.delete(`/admin/inventory/${id}`);
    return response.data;
  },
  unregister: async (id) => {
    const response = await client.post(`/admin/inventory/${id}/unregister`);
    return response.data;
  },
  restore: async (id) => {
    const response = await client.post(`/admin/inventory/${id}/restore`);
    return response.data;
  },
  getAvailableSims: async () => {
    const response = await client.get('/admin/soracom/available-sims');
    return response.data.data;
  },
};

// ===== 印刷API =====

export const printApi = {
  createJob: async (text, tapeMm = 12) => {
    const response = await client.post('/print/jobs', { text, tapeMm });
    return response.data.data;
  },
  getJobs: async () => {
    const response = await client.get('/print/jobs');
    return response.data.data;
  },
  getJobById: async (id) => {
    const response = await client.get(`/print/jobs/${id}`);
    return response.data.data;
  },
  getBridgeStatus: async () => {
    const response = await client.get('/print/bridge-status');
    return response.data.data;
  },
};

// ===== 地点API =====

export const locationsApi = {
  getAll: async () => {
    const response = await client.get('/locations');
    return response.data.data;
  },
  create: async (data) => {
    const response = await client.post('/locations', data);
    return response.data.data;
  },
  update: async (id, data) => {
    const response = await client.put(`/locations/${id}`, data);
    return response.data.data;
  },
  delete: async (id) => {
    const response = await client.delete(`/locations/${id}`);
    return response.data;
  },
};

// ===== 親機の地点リンク更新 =====
export const linkParentDeviceLocation = async (parentId, locationId) => {
  const response = await client.put(`/devices/parents/${parentId}`, { locationId });
  return response.data.data;
};

// client インスタンスをデフォルトエクスポート（AdminPage用）
export default client;
