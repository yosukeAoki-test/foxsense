import { Router } from 'express';
import * as authController from './auth.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { validate, registerSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema } from '../../utils/validation.js';

const router = Router();

router.post('/register', validate(registerSchema), authController.register);
router.post('/login', validate(loginSchema), authController.login);
router.post('/logout', authController.logout);
router.post('/refresh', authController.refresh);
router.get('/me', authenticate, authController.me);
router.post('/forgot-password', validate(forgotPasswordSchema), authController.forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema), authController.resetPassword);
router.post('/2fa/verify-login', authController.verifyTwoFactor);
router.get('/line/url', authController.getLineUrl);
router.post('/line/callback', authController.lineCallback);
router.post('/2fa/setup', authenticate, authController.setup2fa);
router.post('/2fa/enable', authenticate, authController.enable2fa);
router.post('/2fa/disable', authenticate, authController.disable2fa);

export default router;
