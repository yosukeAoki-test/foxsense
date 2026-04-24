// 本番環境で必須の環境変数をチェック
const REQUIRED_IN_PRODUCTION = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'DATABASE_URL'];
if (process.env.NODE_ENV === 'production') {
  const missing = REQUIRED_IN_PRODUCTION.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error(`[Config] Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
  if ((process.env.JWT_SECRET?.length ?? 0) < 32) {
    console.error('[Config] JWT_SECRET must be at least 32 characters');
    process.exit(1);
  }
  if ((process.env.JWT_REFRESH_SECRET?.length ?? 0) < 32) {
    console.error('[Config] JWT_REFRESH_SECRET must be at least 32 characters');
    process.exit(1);
  }
  // Stripe が設定されている場合はWebhookシークレットも必須
  if (process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_WEBHOOK_SECRET) {
    console.error('[Config] STRIPE_WEBHOOK_SECRET is required when STRIPE_SECRET_KEY is set');
    process.exit(1);
  }
  // テスト用Stripeキーが本番に混入していないか確認
  if (process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) {
    console.error('[Config] STRIPE_SECRET_KEY is a test key but NODE_ENV=production');
    process.exit(1);
  }
}

const config = {
  port: process.env.PORT || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-do-not-use-in-production',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-do-not-use-in-production',
    accessExpiresIn: '15m',
    refreshExpiresIn: '7d',
  },

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    prices: {
      MONTHLY: process.env.STRIPE_PRICE_MONTHLY,
      QUARTERLY: process.env.STRIPE_PRICE_QUARTERLY,
      BIANNUAL: process.env.STRIPE_PRICE_BIANNUAL,
      YEARLY: process.env.STRIPE_PRICE_YEARLY,
      TWO_YEAR: process.env.STRIPE_PRICE_TWO_YEAR,
      THREE_YEAR: process.env.STRIPE_PRICE_THREE_YEAR,
    },
  },

  soracom: {
    authKeyId: process.env.SORACOM_AUTH_KEY_ID,
    authKey: process.env.SORACOM_AUTH_KEY,
    apiUrl: process.env.SORACOM_API_URL || 'https://api.soracom.io/v1',
  },

  bridgeSecret: process.env.BRIDGE_SECRET || 'dev-bridge-secret',

  line: {
    channelId: process.env.LINE_CHANNEL_ID || '',
    channelSecret: process.env.LINE_CHANNEL_SECRET || '',
  },

  email: {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM || 'noreply@foxsense.jp',
  },
};

export default config;
