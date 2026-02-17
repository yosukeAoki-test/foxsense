import * as soracomService from './soracom.service.js';
import { asyncHandler } from '../../middleware/errorHandler.js';

export const getSims = asyncHandler(async (req, res) => {
  const sims = await soracomService.getSims(req.user.id);
  res.json({ success: true, data: sims });
});

export const getSimDetails = asyncHandler(async (req, res) => {
  const sim = await soracomService.getSimDetails(req.params.simId, req.user.id);
  res.json({ success: true, data: sim });
});

export const activateSim = asyncHandler(async (req, res) => {
  const result = await soracomService.activateSim(req.params.simId, req.user.id);
  res.json({ success: true, data: result });
});

export const suspendSim = asyncHandler(async (req, res) => {
  const result = await soracomService.suspendSim(req.params.simId, req.user.id);
  res.json({ success: true, data: result });
});

export const terminateSim = asyncHandler(async (req, res) => {
  const result = await soracomService.terminateSim(req.params.simId, req.user.id);
  res.json({ success: true, data: result });
});

export const getSimUsage = asyncHandler(async (req, res) => {
  const usage = await soracomService.getSimUsage(req.params.simId, req.user.id);
  res.json({ success: true, data: usage });
});
