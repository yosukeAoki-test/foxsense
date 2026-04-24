import * as authService from './auth.service.js';
import { asyncHandler } from '../../middleware/errorHandler.js';
import config from '../../config/index.js';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

export const register = asyncHandler(async (req, res) => {
  const { email, password, name } = req.body;
  const result = await authService.register({ email, password, name });

  res.cookie('refreshToken', result.refreshToken, COOKIE_OPTIONS);

  res.status(201).json({
    success: true,
    data: {
      user: result.user,
      accessToken: result.accessToken,
    },
  });
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const result = await authService.login({ email, password });

  res.cookie('refreshToken', result.refreshToken, COOKIE_OPTIONS);

  res.json({
    success: true,
    data: {
      user: result.user,
      accessToken: result.accessToken,
    },
  });
});

export const logout = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  await authService.logout(refreshToken);

  res.clearCookie('refreshToken');

  res.json({
    success: true,
    message: 'Logged out successfully',
  });
});

export const refresh = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies.refreshToken || req.body.refreshToken;
  const result = await authService.refreshAccessToken(refreshToken);

  res.cookie('refreshToken', result.refreshToken, COOKIE_OPTIONS);

  res.json({
    success: true,
    data: {
      user: result.user,
      accessToken: result.accessToken,
    },
  });
});

export const me = asyncHandler(async (req, res) => {
  const user = await authService.getCurrentUser(req.user.id);

  res.json({
    success: true,
    data: { user },
  });
});

export const verifyTwoFactor = asyncHandler(async (req, res) => {
  const result = await authService.verifyTwoFactorLogin(req.body);
  res.cookie('refreshToken', result.refreshToken, COOKIE_OPTIONS);
  res.json({
    success: true,
    data: { user: result.user, accessToken: result.accessToken },
  });
});

export const setup2fa = asyncHandler(async (req, res) => {
  const data = await authService.setupTwoFactor(req.user.id);
  res.json({ success: true, data });
});

export const enable2fa = asyncHandler(async (req, res) => {
  await authService.enableTwoFactor(req.user.id, req.body.code);
  res.json({ success: true, message: '2FAを有効にしました' });
});

export const disable2fa = asyncHandler(async (req, res) => {
  await authService.disableTwoFactor(req.user.id, req.body.code);
  res.json({ success: true, message: '2FAを無効にしました' });
});

export const getLineUrl = asyncHandler(async (req, res) => {
  const redirectUri = `${req.query.origin || ''}/auth/line/callback`;
  const url = authService.getLineAuthUrl(redirectUri);
  res.json({ success: true, data: { url } });
});

export const lineCallback = asyncHandler(async (req, res) => {
  const { code, redirectUri } = req.body;
  if (!code) return res.status(400).json({ success: false, message: 'code is required' });
  const result = await authService.lineCallback(code, redirectUri);
  res.cookie('refreshToken', result.refreshToken, COOKIE_OPTIONS);
  res.json({ success: true, data: { user: result.user, accessToken: result.accessToken } });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  await authService.requestPasswordReset(email);

  // メールの存在有無を明かさないため常に成功を返す
  res.json({
    success: true,
    message: 'メールアドレスが登録されている場合、リセットメールを送信しました',
  });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  await authService.resetPassword(token, password);

  res.json({
    success: true,
    message: 'パスワードを変更しました。新しいパスワードでログインしてください',
  });
});
