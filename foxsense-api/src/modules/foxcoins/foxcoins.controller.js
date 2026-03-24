import * as foxcoinsService from './foxcoins.service.js';
import { asyncHandler } from '../../middleware/errorHandler.js';

export const getBalance = asyncHandler(async (req, res) => {
  const data = await foxcoinsService.getBalance(req.user.id);
  res.json({ success: true, data });
});

export const getPackages = asyncHandler(async (req, res) => {
  const data = await foxcoinsService.getPackages();
  res.json({ success: true, data });
});

export const getPurchaseHistory = asyncHandler(async (req, res) => {
  const data = await foxcoinsService.getPurchaseHistory(req.user.id);
  res.json({ success: true, data });
});

export const getPurchases = asyncHandler(async (req, res) => {
  const data = await foxcoinsService.getPurchases(req.user.id);
  res.json({ success: true, data });
});

export const createCheckout = asyncHandler(async (req, res) => {
  const { packageId } = req.body;
  if (!packageId) return res.status(400).json({ success: false, message: 'packageId is required' });
  const data = await foxcoinsService.createCheckoutSession(req.user.id, packageId);
  res.json({ success: true, data });
});

export const getReceipt = asyncHandler(async (req, res) => {
  const data = await foxcoinsService.getReceipt(req.user.id, req.params.purchaseId);
  res.json({ success: true, data });
});
