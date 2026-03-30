import { Router } from 'express';
import { asyncHandler } from '../../middleware/errorHandler.js';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../utils/validation.js';
import { locationSchema } from '../../utils/validation.js';
import * as locationsService from './locations.service.js';

const router = Router();
router.use(authenticate);

router.get('/', asyncHandler(async (req, res) => {
  const locs = await locationsService.getLocations(req.user.id);
  res.json({ success: true, data: locs });
}));

router.post('/', validate(locationSchema), asyncHandler(async (req, res) => {
  const loc = await locationsService.createLocation(req.user.id, req.body);
  res.status(201).json({ success: true, data: loc });
}));

router.put('/:id', validate(locationSchema), asyncHandler(async (req, res) => {
  const loc = await locationsService.updateLocation(req.params.id, req.user.id, req.body);
  res.json({ success: true, data: loc });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await locationsService.deleteLocation(req.params.id, req.user.id);
  res.json({ success: true, message: 'Location deleted' });
}));

export default router;
