import * as sensorsService from './sensors.service.js';
import { asyncHandler } from '../../middleware/errorHandler.js';

export const getLatestData = asyncHandler(async (req, res) => {
  const data = await sensorsService.getLatestData(req.params.parentId, req.user.id);
  res.json({ success: true, data });
});

export const getHistoryData = asyncHandler(async (req, res) => {
  const { deviceId } = req.params;
  const { period = '24h', type = 'parent' } = req.query;

  const data = await sensorsService.getHistoryData(deviceId, type, period, req.user.id);
  res.json({ success: true, data });
});

export const recordSensorData = asyncHandler(async (req, res) => {
  const data = await sensorsService.recordSensorData(req.body);
  res.status(201).json({ success: true, data });
});

export const getDeviceStats = asyncHandler(async (req, res) => {
  const { deviceId } = req.params;
  const { type = 'parent', startDate, endDate } = req.query;

  const stats = await sensorsService.getDeviceStats(deviceId, type, startDate, endDate, req.user.id);
  res.json({ success: true, data: stats });
});
