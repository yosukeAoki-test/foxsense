import { Router } from 'express';
import * as devicesController from './devices.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { validate, parentDeviceSchema, childDeviceSchema, alertSettingsSchema } from '../../utils/validation.js';

const router = Router();

// Device Config (ファームウェア認証: secret使用、JWT不要)
router.get('/config/:deviceId', devicesController.getDeviceConfig);
router.post('/config/:deviceId/pairing-result', devicesController.reportPairingResult);

// 認証必須
router.use(authenticate);

// Parent Devices
router.get('/parents', devicesController.getParentDevices);
router.get('/parents/:id', devicesController.getParentDevice);
router.post('/parents', validate(parentDeviceSchema), devicesController.createParentDevice);
router.put('/parents/:id', devicesController.updateParentDevice);
router.delete('/parents/:id', devicesController.deleteParentDevice);

// Child Devices (ユーザー所有 - 親機に依存しない)
router.get('/children', devicesController.getAllChildDevices);
router.post('/children', validate(childDeviceSchema), devicesController.createChildDevice);
router.put('/children/:id', devicesController.updateChildDevice);
router.delete('/children/:id', devicesController.deleteChildDevice);

// Assignments (紐付け管理)
router.post('/parents/:parentId/assign', devicesController.assignChild);
router.delete('/assignments/:assignmentId', devicesController.unassignChild);
router.get('/children/:childId/history', devicesController.getAssignmentHistory);

// Alert Settings
router.get('/parents/:parentId/alerts', devicesController.getAlertSettings);
router.put('/parents/:parentId/alerts', validate(alertSettingsSchema), devicesController.updateAlertSettings);

export default router;
