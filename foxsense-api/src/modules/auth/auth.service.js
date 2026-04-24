import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { generateSecret as otpGenerateSecret, generateSync as otpGenerateSync, verifySync as otpVerifySync, generateURI as otpGenerateURI } from 'otplib';
import QRCode from 'qrcode';
import prisma from '../../config/db.js';
import config from '../../config/index.js';
import { AppError } from '../../middleware/errorHandler.js';
import { sendPasswordResetEmail } from '../../utils/email.js';

const SALT_ROUNDS = 12;
const MAX_LOGIN_ATTEMPTS = 10;
const LOCK_DURATION_MS = 30 * 60 * 1000; // 30分

export const generateTokens = (userId) => {
  const accessToken = jwt.sign(
    { userId },
    config.jwt.secret,
    { expiresIn: config.jwt.accessExpiresIn }
  );

  const refreshToken = jwt.sign(
    { userId, tokenId: crypto.randomUUID() },
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshExpiresIn }
  );

  return { accessToken, refreshToken };
};

export const register = async ({ email, password, name }) => {
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    throw new AppError('Email already registered', 409);
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      name,
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
    },
  });

  const { accessToken, refreshToken } = generateTokens(user.id);

  // Store refresh token
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);
  await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      userId: user.id,
      expiresAt,
    },
  });

  return { user, accessToken, refreshToken };
};

export const login = async ({ email, password }) => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new AppError('Invalid email or password', 401);
  }

  // アカウントロック確認（401で返してアカウント存在を漏洩しない）
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const remainMin = Math.ceil((user.lockedUntil - Date.now()) / 60000);
    throw new AppError(`ログイン試行回数が上限を超えました。${remainMin}分後に再試行してください。`, 401);
  }

  if (!user.passwordHash) {
    throw new AppError('このアカウントはLINEでログインしてください', 400);
  }

  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
  if (!isPasswordValid) {
    const attempts = user.loginAttempts + 1;
    const isLocked = attempts >= MAX_LOGIN_ATTEMPTS;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        loginAttempts: attempts,
        lockedUntil: isLocked ? new Date(Date.now() + LOCK_DURATION_MS) : null,
      },
    });
    if (isLocked) {
      throw new AppError(`ログイン試行回数が上限を超えました。30分後に再試行してください。`, 401);
    }
    throw new AppError('Invalid email or password', 401);
  }

  // ログイン成功 → 失敗カウントをリセット
  if (user.loginAttempts > 0 || user.lockedUntil) {
    await prisma.user.update({
      where: { id: user.id },
      data: { loginAttempts: 0, lockedUntil: null },
    });
  }

  const { accessToken, refreshToken } = generateTokens(user.id);

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);
  await prisma.refreshToken.create({
    data: { token: refreshToken, userId: user.id, expiresAt },
  });

  return {
    user: { id: user.id, email: user.email, name: user.name, role: user.role, twoFactorEnabled: user.twoFactorEnabled },
    accessToken,
    refreshToken,
  };
};

// 2FA: TOTPでログイン完了
export const verifyTwoFactorLogin = async ({ tempToken, code }) => {
  let payload;
  try {
    payload = jwt.verify(tempToken, config.jwt.secret);
  } catch {
    throw new AppError('無効または期限切れのトークンです', 401);
  }
  if (payload.purpose !== '2fa') throw new AppError('Invalid token purpose', 401);

  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user?.twoFactorEnabled || !user.twoFactorSecret) {
    throw new AppError('2FAが設定されていません', 400);
  }

  const { valid } = otpVerifySync({ token: code, secret: user.twoFactorSecret });
  if (!valid) throw new AppError('認証コードが正しくありません', 401);

  const { accessToken, refreshToken } = generateTokens(user.id);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);
  await prisma.refreshToken.create({
    data: { token: refreshToken, userId: user.id, expiresAt },
  });

  return {
    user: { id: user.id, email: user.email, name: user.name, role: user.role, twoFactorEnabled: true },
    accessToken,
    refreshToken,
  };
};

// 2FA: セットアップ（シークレット生成 + QRコード）
export const setupTwoFactor = async (userId) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('User not found', 404);

  const secret = otpGenerateSecret();
  const otpAuthUrl = otpGenerateURI({ type: 'totp', label: user.email, issuer: 'FoxSense', secret });
  const qrCodeDataUrl = await QRCode.toDataURL(otpAuthUrl);

  // 仮保存（有効化前）
  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorSecret: secret, twoFactorEnabled: false },
  });

  return { secret, qrCodeDataUrl };
};

// 2FA: 有効化（初回コード確認）
export const enableTwoFactor = async (userId, code) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.twoFactorSecret) throw new AppError('2FAのセットアップを先に完了してください', 400);
  if (user.twoFactorEnabled) throw new AppError('2FAはすでに有効です', 400);

  const { valid: isValid } = otpVerifySync({ token: code, secret: user.twoFactorSecret });
  if (!isValid) throw new AppError('認証コードが正しくありません', 401);

  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorEnabled: true },
  });
};

// 2FA: 無効化
export const disableTwoFactor = async (userId, code) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.twoFactorEnabled) throw new AppError('2FAは有効ではありません', 400);

  const { valid: isValidDisable } = otpVerifySync({ token: code, secret: user.twoFactorSecret });
  if (!isValidDisable) throw new AppError('認証コードが正しくありません', 401);

  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorEnabled: false, twoFactorSecret: null },
  });
};

export const logout = async (refreshToken) => {
  if (refreshToken) {
    await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
  }
};

export const refreshAccessToken = async (refreshToken) => {
  if (!refreshToken) {
    throw new AppError('Refresh token required', 401);
  }

  const decoded = jwt.verify(refreshToken, config.jwt.refreshSecret);

  const storedToken = await prisma.refreshToken.findUnique({
    where: { token: refreshToken },
    include: { user: true },
  });

  if (!storedToken || storedToken.expiresAt < new Date()) {
    throw new AppError('Invalid or expired refresh token', 401);
  }

  // Delete old token and create new one
  await prisma.refreshToken.delete({ where: { id: storedToken.id } });

  const { accessToken, refreshToken: newRefreshToken } = generateTokens(storedToken.userId);

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);
  await prisma.refreshToken.create({
    data: {
      token: newRefreshToken,
      userId: storedToken.userId,
      expiresAt,
    },
  });

  return {
    accessToken,
    refreshToken: newRefreshToken,
    user: {
      id: storedToken.user.id,
      email: storedToken.user.email,
      name: storedToken.user.name,
      role: storedToken.user.role,
      twoFactorEnabled: storedToken.user.twoFactorEnabled,
    },
  };
};

export const requestPasswordReset = async (email) => {
  const user = await prisma.user.findUnique({ where: { email } });

  // メール存在確認を漏らさないため、ユーザーが存在しなくても成功を返す
  if (!user) return;

  // 古いトークンを削除
  await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });

  // 新しいトークンを生成（64文字の16進数 = 32バイト）
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1時間後

  await prisma.passwordResetToken.create({
    data: { token, userId: user.id, expiresAt },
  });

  const resetUrl = `${config.frontendUrl}/reset-password?token=${token}`;

  try {
    await sendPasswordResetEmail({ to: user.email, resetUrl });
  } catch (err) {
    console.error('[Auth] Failed to send password reset email:', err.message);
    // メール送信失敗はAPI エラーにしない（トークンは生成済み）
  }
};

export const resetPassword = async (token, newPassword) => {
  const record = await prisma.passwordResetToken.findUnique({
    where: { token },
    include: { user: true },
  });

  if (!record || record.used || record.expiresAt < new Date()) {
    throw new AppError('無効または期限切れのリセットリンクです', 400);
  }

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash },
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { used: true },
    }),
    // 全リフレッシュトークンを無効化（セキュリティ）
    prisma.refreshToken.deleteMany({ where: { userId: record.userId } }),
  ]);
};

export const getLineAuthUrl = (redirectUri) => {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.line.channelId,
    redirect_uri: redirectUri,
    state: crypto.randomBytes(16).toString('hex'),
    scope: 'profile openid email',
  });
  return `https://access.line.me/oauth2/v2.1/authorize?${params}`;
};

export const lineCallback = async (code, redirectUri) => {
  const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: config.line.channelId,
      client_secret: config.line.channelSecret,
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new AppError('LINE認証に失敗しました', 400);

  const profileRes = await fetch('https://api.line.me/v2/profile', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const profile = await profileRes.json();
  if (!profile.userId) throw new AppError('LINEプロフィールの取得に失敗しました', 400);

  let user = await prisma.user.findUnique({ where: { lineId: profile.userId } });
  if (!user) {
    const emailCandidate = `line_${profile.userId}@foxsense.app`;
    const existing = await prisma.user.findUnique({ where: { email: emailCandidate } });
    if (existing) {
      user = await prisma.user.update({
        where: { id: existing.id },
        data: { lineId: profile.userId, lineAvatar: profile.pictureUrl ?? null },
      });
    } else {
      user = await prisma.user.create({
        data: {
          lineId: profile.userId,
          lineAvatar: profile.pictureUrl ?? null,
          name: profile.displayName,
          email: emailCandidate,
          passwordHash: null,
        },
      });
    }
  } else if (user.lineAvatar !== (profile.pictureUrl ?? null)) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { lineAvatar: profile.pictureUrl ?? null },
    });
  }

  const { accessToken, refreshToken } = generateTokens(user.id);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);
  await prisma.refreshToken.create({ data: { token: refreshToken, userId: user.id, expiresAt } });

  return {
    user: { id: user.id, email: user.email, name: user.name, role: user.role, twoFactorEnabled: user.twoFactorEnabled, lineAvatar: user.lineAvatar },
    accessToken,
    refreshToken,
  };
};

export const getCurrentUser = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      twoFactorEnabled: true,
      subscription: {
        select: {
          plan: true,
          status: true,
          currentPeriodEnd: true,
        },
      },
    },
  });

  if (!user) {
    throw new AppError('User not found', 404);
  }

  return user;
};
