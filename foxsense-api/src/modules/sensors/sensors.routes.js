import { Router } from 'express';
import * as sensorsController from './sensors.controller.js';
import { authenticate } from '../../middleware/auth.js';

const router = Router();

// Public endpoint for device data ingestion (Sigfox callback)
router.post('/callback', sensorsController.recordSensorData);

// Protected endpoints
router.use(authenticate);

router.get('/parents/:parentId/latest', sensorsController.getLatestData);
router.get('/devices/:deviceId/history', sensorsController.getHistoryData);
router.get('/devices/:deviceId/stats', sensorsController.getDeviceStats);

export default router;
