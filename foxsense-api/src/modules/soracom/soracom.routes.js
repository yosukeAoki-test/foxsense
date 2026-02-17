import { Router } from 'express';
import * as soracomController from './soracom.controller.js';
import { authenticate } from '../../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

router.get('/sims', soracomController.getSims);
router.get('/sims/:simId', soracomController.getSimDetails);
router.post('/sims/:simId/activate', soracomController.activateSim);
router.post('/sims/:simId/suspend', soracomController.suspendSim);
router.post('/sims/:simId/terminate', soracomController.terminateSim);
router.get('/sims/:simId/usage', soracomController.getSimUsage);

export default router;
