import { Router } from 'express';
import * as foxcoinsController from './foxcoins.controller.js';
import { authenticate } from '../../middleware/auth.js';

const router = Router();

router.use(authenticate);

router.get('/balance', foxcoinsController.getBalance);
router.get('/packages', foxcoinsController.getPackages);
router.get('/history', foxcoinsController.getPurchaseHistory);
router.get('/purchases', foxcoinsController.getPurchases);
router.get('/purchases/:purchaseId/receipt', foxcoinsController.getReceipt);
router.post('/checkout', foxcoinsController.createCheckout);

export default router;
