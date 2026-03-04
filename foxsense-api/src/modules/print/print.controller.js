import * as printService from './print.service.js';
import { asyncHandler } from '../../middleware/errorHandler.js';

export const createJob = asyncHandler(async (req, res) => {
  const { text, tapeMm } = req.body;
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({ success: false, message: 'text is required' });
  }
  const job = await printService.createJob({ text: text.trim(), tapeMm, userId: req.user?.id });
  res.status(201).json({ success: true, data: job });
});

export const getJobs = asyncHandler(async (req, res) => {
  const jobs = await printService.getJobs();
  res.json({ success: true, data: jobs });
});

// Bridge endpoints (authenticated via BRIDGE_SECRET query param)
export const getPendingJob = asyncHandler(async (req, res) => {
  const job = await printService.getPendingJob();
  if (!job) return res.json({ success: true, data: null });

  // Atomically claim it
  const claimed = await printService.claimJob(job.id);
  res.json({ success: true, data: claimed });
});

export const getJobById = asyncHandler(async (req, res) => {
  const job = await printService.getJobById(req.params.id);
  if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
  res.json({ success: true, data: job });
});

export const bridgeHeartbeat = asyncHandler(async (req, res) => {
  printService.recordHeartbeat();
  res.json({ success: true });
});

export const getBridgeStatus = asyncHandler(async (req, res) => {
  res.json({ success: true, data: { alive: printService.getBridgeAlive() } });
});

export const updateJob = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, error } = req.body;
  if (!['done', 'failed', 'pending'].includes(status)) {
    return res.status(400).json({ success: false, message: 'invalid status' });
  }
  const job = await printService.updateJobStatus(id, status, error);
  res.json({ success: true, data: job });
});
