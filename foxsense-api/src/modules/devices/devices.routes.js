import { Router } from 'express';
import * as devicesController from './devices.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { validate, parentDeviceSchema, childDeviceSchema, alertSettingsSchema } from '../../utils/validation.js';

const router = Router();

// Device Config (デバイス認証: secret使用、JWT不要)
router.get('/config/:deviceId', devicesController.getDeviceConfig);
router.post('/config/:deviceId/pairing-result', devicesController.reportPairingResult);

// All routes below require authentication
router.use(authenticate);

// Parent Devices
router.get('/parents', devicesController.getParentDevices);
router.get('/parents/:id', devicesController.getParentDevice);
router.post('/parents', validate(parentDeviceSchema), devicesController.createParentDevice);
router.put('/parents/:id', devicesController.updateParentDevice);
router.delete('/parents/:id', devicesController.deleteParentDevice);

// Child Devices
router.get('/parents/:parentId/children', devicesController.getChildDevices);
router.post('/parents/:parentId/children', validate(childDeviceSchema), devicesController.createChildDevice);
router.put('/children/:id', devicesController.updateChildDevice);
router.delete('/children/:id', devicesController.deleteChildDevice);

// Alert Settings
router.get('/parents/:parentId/alerts', devicesController.getAlertSettings);
router.put('/parents/:parentId/alerts', validate(alertSettingsSchema), devicesController.updateAlertSettings);

export default router;
