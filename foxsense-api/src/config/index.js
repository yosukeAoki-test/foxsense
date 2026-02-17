const config = {
  port: process.env.PORT || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',

  jwt: {
    secret: process.env.JWT_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
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
};

export default config;
