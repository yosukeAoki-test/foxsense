import * as adminService from './admin.service.js';
import { asyncHandler } from '../../middleware/errorHandler.js';

// Users
export const getAllUsers = asyncHandler(async (req, res) => {
  const data = await adminService.getAllUsers();
  res.json({ success: true, data });
});

export const deleteUser = asyncHandler(async (req, res) => {
  await adminService.deleteUser(req.params.userId, req.user.id);
  res.json({ success: true, message: 'User deleted' });
});

export const updateUserRole = asyncHandler(async (req, res) => {
  const { role } = req.body;
  const data = await adminService.updateUserRole(req.params.userId, role, req.user.id);
  res.json({ success: true, data });
});

export const adjustUserCoins = asyncHandler(async (req, res) => {
  const { coins, note } = req.body;
  if (typeof coins !== 'number') {
    return res.status(400).json({ success: false, message: 'coins must be a number' });
  }
  const data = await adminService.adjustUserCoins(req.params.userId, req.user.id, coins, note);
  res.json({ success: true, data });
});

// Devices
export const getAllDevices = asyncHandler(async (req, res) => {
  const data = await adminService.getAllDevices();
  res.json({ success: true, data });
});

// Stats
export const getStats = asyncHandler(async (req, res) => {
  const data = await adminService.getStats();
  res.json({ success: true, data });
});

// Packages
export const getPackages = asyncHandler(async (req, res) => {
  const data = await adminService.getPackages();
  res.json({ success: true, data });
});

export const updatePackage = asyncHandler(async (req, res) => {
  const data = await adminService.updatePackage(req.params.id, req.body);
  res.json({ success: true, data });
});

export const createPackage = asyncHandler(async (req, res) => {
  const data = await adminService.createPackage(req.body);
  res.status(201).json({ success: true, data });
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, message: '現在のパスワードと新しいパスワードは必須です' });
  }
  await adminService.changePassword(req.user.id, currentPassword, newPassword);
  res.json({ success: true, message: 'パスワードを変更しました' });
});
