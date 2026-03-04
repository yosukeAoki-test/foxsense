import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import cron from 'node-cron';

import config from './config/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { runHourlyDeduction } from './modules/foxcoins/foxcoins.service.js';
import prisma from './config/db.js';

// Import routes
import authRoutes from './modules/auth/auth.routes.js';
import devicesRoutes from './modules/devices/devices.routes.js';
import sensorsRoutes from './modules/sensors/sensors.routes.js';
import paymentsRoutes from './modules/payments/payments.routes.js';
import soracomRoutes from './modules/soracom/soracom.routes.js';
import foxcoinsRoutes from './modules/foxcoins/foxcoins.routes.js';
import adminRoutes from './modules/admin/admin.routes.js';
import printRoutes from './modules/print/print.routes.js';

const app = express();

// Nginx リバースプロキシ経由のためtrust proxy設定
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());
app.use(cors({
  origin: config.frontendUrl,
  credentials: true,
}));

// Rate limiting（全API共通: 15分500件、bridgeポーリングは除外）
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later' },
  skip: (req) => req.path.startsWith('/print/'),
});
app.use('/api/', limiter);

// 認証系エンドポイント専用のレート制限（1時間20件）
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts, please try again later' },
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);

// Body parsing - Note: webhook route uses raw body, so it's handled in payments.routes.js
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

// Health check（DB疎通確認あり）
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'ok', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'error', db: 'unreachable', timestamp: new Date().toISOString() });
  }
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/devices', devicesRoutes);
app.use('/api/sensors', sensorsRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/soracom', soracomRoutes);
app.use('/api/foxcoins', foxcoinsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/print', printRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Not found' });
});

// Error handler
app.use(errorHandler);

// Start server
const PORT = config.port;
const server = app.listen(PORT, () => {
  console.log(`FoxSense API running on port ${PORT}`);
  console.log(`Environment: ${config.nodeEnv}`);
});

// グレースフルシャットダウン
const gracefulShutdown = async (signal) => {
  console.log(`[Server] ${signal} received, shutting down gracefully`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
};
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// 時間バッチ: 毎時 0 分に実行、24 時間経過したユーザーから 1 FC 消費
cron.schedule('0 * * * *', async () => {
  console.log('[FoxCoin] Hourly deduction started');
  try {
    const result = await runHourlyDeduction();
    console.log('[FoxCoin] Hourly deduction done:', result);
  } catch (err) {
    console.error('[FoxCoin] Hourly deduction error:', err);
  }
});

export default app;
