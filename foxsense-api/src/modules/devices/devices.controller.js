import * as devicesService from './devices.service.js';
import { asyncHandler } from '../../middleware/errorHandler.js';

// Parent Devices
export const getParentDevices = asyncHandler(async (req, res) => {
  const devices = await devicesService.getParentDevices(req.user.id);
  res.json({ success: true, data: devices });
});

export const getParentDevice = asyncHandler(async (req, res) => {
  const device = await devicesService.getParentDevice(req.params.id, req.user.id);
  res.json({ success: true, data: device });
});

export const createParentDevice = asyncHandler(async (req, res) => {
  const device = await devicesService.createParentDevice(req.user.id, req.body);
  res.status(201).json({ success: true, data: device });
});

export const updateParentDevice = asyncHandler(async (req, res) => {
  const device = await devicesService.updateParentDevice(req.params.id, req.user.id, req.body);
  res.json({ success: true, data: device });
});

export const deleteParentDevice = asyncHandler(async (req, res) => {
  await devicesService.deleteParentDevice(req.params.id, req.user.id);
  res.json({ success: true, message: 'Device deleted' });
});

// Child Devices (ユーザー所有)
export const getAllChildDevices = asyncHandler(async (req, res) => {
  const children = await devicesService.getAllChildDevices(req.user.id);
  res.json({ success: true, data: children });
});

export const createChildDevice = asyncHandler(async (req, res) => {
  const child = await devicesService.createChildDevice(req.user.id, req.body);
  res.status(201).json({ success: true, data: child });
});

export const updateChildDevice = asyncHandler(async (req, res) => {
  const child = await devicesService.updateChildDevice(req.params.id, req.user.id, req.body);
  res.json({ success: true, data: child });
});

export const deleteChildDevice = asyncHandler(async (req, res) => {
  await devicesService.deleteChildDevice(req.params.id, req.user.id);
  res.json({ success: true, message: 'Child device deleted' });
});

// Assignments (紐付け管理)
export const assignChild = asyncHandler(async (req, res) => {
  const { childId } = req.body;
  if (!childId) {
    return res.status(400).json({ success: false, message: 'childId is required' });
  }
  const assignment = await devicesService.assignChildToParent(req.params.parentId, childId, req.user.id);
  res.status(201).json({ success: true, data: assignment });
});

export const unassignChild = asyncHandler(async (req, res) => {
  const result = await devicesService.unassignChild(req.params.assignmentId, req.user.id);
  res.json({ success: true, data: result });
});

export const getAssignmentHistory = asyncHandler(async (req, res) => {
  const history = await devicesService.getAssignmentHistory(req.params.childId, req.user.id);
  res.json({ success: true, data: history });
});

// Alert Settings
export const getAlertSettings = asyncHandler(async (req, res) => {
  const settings = await devicesService.getAlertSettings(req.params.parentId, req.user.id);
  res.json({ success: true, data: settings });
});

export const updateAlertSettings = asyncHandler(async (req, res) => {
  const settings = await devicesService.updateAlertSettings(req.params.parentId, req.user.id, req.body);
  res.json({ success: true, data: settings });
});

// Device Config (ファームウェア認証エンドポイント)
export const getDeviceConfig = asyncHandler(async (req, res) => {
  const { deviceId } = req.params;
  const { secret } = req.query;

  if (!secret) {
    return res.status(400).json({ success: false, message: 'Secret is required' });
  }

  const config = await devicesService.getDeviceConfig(deviceId, secret);
  res.json({ success: true, data: config });
});

export const reportPairingResult = asyncHandler(async (req, res) => {
  const { deviceId } = req.params;
  const { childDeviceId, status, secret } = req.body;

  if (!childDeviceId || !status || !secret) {
    return res.status(400).json({ success: false, message: 'childDeviceId, status, and secret are required' });
  }

  const result = await devicesService.reportPairingResult(deviceId, childDeviceId, status, secret);
  res.json({ success: true, data: result });
});
