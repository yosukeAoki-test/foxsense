import { Router } from 'express';
import * as printController from './print.controller.js';
import { authenticate, requireAdmin } from '../../middleware/auth.js';
import config from '../../config/index.js';

const router = Router();

// Bridge secret middleware
const bridgeAuth = (req, res, next) => {
  const secret = req.query.secret || req.headers['x-bridge-secret'];
  if (secret !== config.bridgeSecret) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  next();
};

// Bridge endpoints（/jobs/pending を :id より先に定義）
router.post('/heartbeat', bridgeAuth, printController.bridgeHeartbeat);
router.get('/jobs/pending', bridgeAuth, printController.getPendingJob);
router.patch('/jobs/:id', bridgeAuth, printController.updateJob);

// Web (JWT) endpoints
router.post('/jobs', authenticate, requireAdmin, printController.createJob);
router.get('/jobs', authenticate, requireAdmin, printController.getJobs);
router.get('/jobs/:id', authenticate, requireAdmin, printController.getJobById);
router.get('/bridge-status', authenticate, requireAdmin, printController.getBridgeStatus);

export default router;
