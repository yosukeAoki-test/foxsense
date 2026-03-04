import { Router } from 'express';
import * as sensorsController from './sensors.controller.js';
import { authenticate } from '../../middleware/auth.js';

const router = Router();

// デバイスデータ受信エンドポイント（デバイスシークレット認証必須）
router.post('/callback', sensorsController.recordSensorData);

// ファームウェアからのバルク受信（親機+子機を1リクエストで送信、デバイスシークレット認証必須）
router.post('/ingest', sensorsController.ingestSensorData);

// Protected endpoints
router.use(authenticate);

router.get('/parents/:parentId/latest', sensorsController.getLatestData);
router.get('/devices/:deviceId/history', sensorsController.getHistoryData);
router.get('/devices/:deviceId/stats', sensorsController.getDeviceStats);

export default router;
