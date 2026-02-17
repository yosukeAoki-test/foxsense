import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1, 'Name is required').max(100),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

export const parentDeviceSchema = z.object({
  deviceId: z.string().min(1, 'Device ID is required'),
  name: z.string().min(1, 'Name is required').max(100),
  location: z.string().max(200).optional(),
  soracomSimId: z.string().optional(),
});

export const childDeviceSchema = z.object({
  deviceId: z.string().min(1, 'Device ID is required').regex(/^[0-9A-Fa-f]{8}$/, 'Device ID must be 8 hex characters'),
  name: z.string().min(1, 'Name is required').max(100),
  location: z.string().max(200).optional(),
});

export const alertSettingsSchema = z.object({
  tempMin: z.number().min(-50).max(50),
  tempMax: z.number().min(-50).max(80),
  humidityMin: z.number().min(0).max(100),
  humidityMax: z.number().min(0).max(100),
  frostWarning: z.number().min(-20).max(20),
  frostCritical: z.number().min(-30).max(10),
  emailEnabled: z.boolean(),
  lineEnabled: z.boolean(),
});

export const checkoutSchema = z.object({
  plan: z.enum(['MONTHLY', 'QUARTERLY', 'BIANNUAL', 'YEARLY', 'TWO_YEAR', 'THREE_YEAR']),
});

export const validate = (schema) => (req, res, next) => {
  try {
    schema.parse(req.body);
    next();
  } catch (error) {
    next(error);
  }
};
