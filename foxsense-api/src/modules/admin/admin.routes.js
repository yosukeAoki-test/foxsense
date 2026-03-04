import { Router } from 'express';
import * as adminController from './admin.controller.js';
import { authenticate, requireAdmin } from '../../middleware/auth.js';

const router = Router();

router.use(authenticate, requireAdmin);

// Users
router.get('/users', adminController.getAllUsers);
router.delete('/users/:userId', adminController.deleteUser);
router.put('/users/:userId/role', adminController.updateUserRole);
router.post('/users/:userId/coins', adminController.adjustUserCoins);

// Devices
router.get('/devices', adminController.getAllDevices);

// Stats
router.get('/stats', adminController.getStats);

// Packages
router.get('/packages', adminController.getPackages);
router.post('/packages', adminController.createPackage);
router.put('/packages/:id', adminController.updatePackage);

// Inventory (デバイス在庫)
router.get('/inventory', adminController.getInventory);
router.post('/inventory', adminController.bulkCreateInventory);
router.delete('/inventory/:id', adminController.deleteInventoryItem);

// SORACOM (管理者向け)
router.get('/soracom/available-sims', adminController.getAvailableSims);

// Profile
router.put('/me/password', adminController.changePassword);

export default router;
