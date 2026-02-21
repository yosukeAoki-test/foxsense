import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import cron from 'node-cron';

import config from './config/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { runDailyDeduction } from './modules/foxcoins/foxcoins.service.js';

// Import routes
import authRoutes from './modules/auth/auth.routes.js';
import devicesRoutes from './modules/devices/devices.routes.js';
import sensorsRoutes from './modules/sensors/sensors.routes.js';
import paymentsRoutes from './modules/payments/payments.routes.js';
import soracomRoutes from './modules/soracom/soracom.routes.js';
import foxcoinsRoutes from './modules/foxcoins/foxcoins.routes.js';
import adminRoutes from './modules/admin/admin.routes.js';

const app = express();

// Nginx リバースプロキシ経由のためtrust proxy設定
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());
app.use(cors({
  origin: config.frontendUrl,
  credentials: true,
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: { success: false, message: 'Too many requests, please try again later' },
});
app.use('/api/', limiter);

// Body parsing - Note: webhook route uses raw body, so it's handled in payments.routes.js
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/devices', devicesRoutes);
app.use('/api/sensors', sensorsRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/soracom', soracomRoutes);
app.use('/api/foxcoins', foxcoinsRoutes);
app.use('/api/admin', adminRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Not found' });
});

// Error handler
app.use(errorHandler);

// Start server
const PORT = config.port;
app.listen(PORT, () => {
  console.log(`FoxSense API running on port ${PORT}`);
  console.log(`Environment: ${config.nodeEnv}`);
});

// 日次 FoxCoin 消費バッチ（毎日 00:05 JST = UTC 15:05）
cron.schedule('5 15 * * *', async () => {
  console.log('[FoxCoin] Daily deduction started');
  try {
    const result = await runDailyDeduction();
    console.log('[FoxCoin] Daily deduction done:', result);
  } catch (err) {
    console.error('[FoxCoin] Daily deduction error:', err);
  }
});

export default app;
