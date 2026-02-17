import * as paymentsService from './payments.service.js';
import { asyncHandler } from '../../middleware/errorHandler.js';

export const createCheckout = asyncHandler(async (req, res) => {
  const { plan } = req.body;
  const result = await paymentsService.createCheckoutSession(req.user.id, plan);
  res.json({ success: true, data: result });
});

export const getSubscription = asyncHandler(async (req, res) => {
  const subscription = await paymentsService.getSubscription(req.user.id);
  res.json({ success: true, data: subscription });
});

export const cancelSubscription = asyncHandler(async (req, res) => {
  const result = await paymentsService.cancelSubscription(req.user.id);
  res.json({ success: true, data: result });
});

export const createPortal = asyncHandler(async (req, res) => {
  const result = await paymentsService.createPortalSession(req.user.id);
  res.json({ success: true, data: result });
});

export const handleWebhook = asyncHandler(async (req, res) => {
  const signature = req.headers['stripe-signature'];
  const result = await paymentsService.handleWebhook(req.body, signature);
  res.json(result);
});
