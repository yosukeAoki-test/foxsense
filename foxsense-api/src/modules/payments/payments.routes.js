import { Router } from 'express';
import express from 'express';
import * as paymentsController from './payments.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { validate, checkoutSchema } from '../../utils/validation.js';

const router = Router();

// Webhook needs raw body for signature verification
router.post('/webhook', express.raw({ type: 'application/json' }), paymentsController.handleWebhook);

// Protected routes
router.use(authenticate);

router.post('/create-checkout', validate(checkoutSchema), paymentsController.createCheckout);
router.get('/subscription', paymentsController.getSubscription);
router.post('/cancel', paymentsController.cancelSubscription);
router.post('/portal', paymentsController.createPortal);

export default router;
