import Stripe from 'stripe';
import prisma from '../../config/db.js';
import config from '../../config/index.js';
import { AppError } from '../../middleware/errorHandler.js';

// テストモード: Stripe APIキーが未設定の場合はモック動作
const isTestMode = !config.stripe.secretKey || config.stripe.secretKey.startsWith('sk_test_xxx');
const stripe = isTestMode ? null : new Stripe(config.stripe.secretKey);

if (isTestMode) {
  console.log('⚠️  Stripe: テストモードで動作中（モック決済）');
}

const PLAN_PRICES = {
  MONTHLY: { amount: 1980, interval: 'month', intervalCount: 1 },
  QUARTERLY: { amount: 5340, interval: 'month', intervalCount: 3 },
  BIANNUAL: { amount: 9480, interval: 'month', intervalCount: 6 },
  YEARLY: { amount: 17760, interval: 'year', intervalCount: 1 },
  TWO_YEAR: { amount: 30720, interval: 'year', intervalCount: 2 },
  THREE_YEAR: { amount: 35280, interval: 'year', intervalCount: 3 },
};

export const createCheckoutSession = async (userId, plan) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { subscription: true },
  });

  if (!user) {
    throw new AppError('User not found', 404);
  }

  if (user.subscription?.status === 'ACTIVE') {
    throw new AppError('Already has an active subscription', 400);
  }

  // テストモード: 即座にサブスクリプション作成
  if (isTestMode) {
    const now = new Date();
    const periodEnd = new Date(now.getTime() + getPlanDurationMs(plan));

    await prisma.subscription.upsert({
      where: { userId },
      update: {
        plan,
        status: 'ACTIVE',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
      },
      create: {
        userId,
        stripeCustomerId: `mock_cus_${userId.slice(0, 8)}`,
        stripeSubscriptionId: `mock_sub_${Date.now()}`,
        plan,
        status: 'ACTIVE',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
      },
    });

    return {
      sessionId: `mock_session_${Date.now()}`,
      url: `${config.frontendUrl}/subscription/success?session_id=mock&plan=${plan}`,
      testMode: true,
    };
  }

  const priceId = config.stripe.prices[plan];
  if (!priceId) {
    throw new AppError('Invalid plan', 400);
  }

  // Get or create Stripe customer
  let customerId = user.subscription?.stripeCustomerId;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.name,
      metadata: { userId: user.id },
    });
    customerId = customer.id;
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${config.frontendUrl}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.frontendUrl}/subscription/cancel`,
    metadata: {
      userId: user.id,
      plan,
    },
  });

  return { sessionId: session.id, url: session.url };
};

export const getSubscription = async (userId) => {
  const subscription = await prisma.subscription.findUnique({
    where: { userId },
  });

  if (!subscription) {
    return null;
  }

  // テストモードまたはモックサブスクリプションの場合
  if (isTestMode || subscription.stripeSubscriptionId?.startsWith('mock_')) {
    return {
      ...subscription,
      testMode: true,
    };
  }

  // Get fresh data from Stripe if we have a subscription ID
  if (subscription.stripeSubscriptionId && stripe) {
    try {
      const stripeSub = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
      return {
        ...subscription,
        stripeData: {
          currentPeriodEnd: new Date(stripeSub.current_period_end * 1000),
          cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
        },
      };
    } catch (error) {
      console.error('Error fetching Stripe subscription:', error);
    }
  }

  return subscription;
};

export const cancelSubscription = async (userId) => {
  const subscription = await prisma.subscription.findUnique({
    where: { userId },
  });

  if (!subscription || !subscription.stripeSubscriptionId) {
    throw new AppError('No active subscription', 404);
  }

  // テストモード
  if (isTestMode || subscription.stripeSubscriptionId?.startsWith('mock_')) {
    await prisma.subscription.update({
      where: { userId },
      data: { status: 'CANCELED' },
    });
    return { message: 'Subscription canceled (test mode)', testMode: true };
  }

  await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
    cancel_at_period_end: true,
  });

  await prisma.subscription.update({
    where: { userId },
    data: { status: 'CANCELED' },
  });

  return { message: 'Subscription will be canceled at period end' };
};

export const createPortalSession = async (userId) => {
  const subscription = await prisma.subscription.findUnique({
    where: { userId },
  });

  if (!subscription?.stripeCustomerId) {
    throw new AppError('No customer found', 404);
  }

  // テストモード
  if (isTestMode || subscription.stripeCustomerId?.startsWith('mock_')) {
    return {
      url: `${config.frontendUrl}/subscription`,
      testMode: true,
      message: 'テストモードではポータルは利用できません',
    };
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: subscription.stripeCustomerId,
    return_url: `${config.frontendUrl}/settings`,
  });

  return { url: session.url };
};

export const handleWebhook = async (payload, signature) => {
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      payload,
      signature,
      config.stripe.webhookSecret
    );
  } catch (err) {
    throw new AppError(`Webhook signature verification failed: ${err.message}`, 400);
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const { userId, plan } = session.metadata;

      await prisma.subscription.upsert({
        where: { userId },
        update: {
          stripeCustomerId: session.customer,
          stripeSubscriptionId: session.subscription,
          plan,
          status: 'ACTIVE',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + getPlanDurationMs(plan)),
        },
        create: {
          userId,
          stripeCustomerId: session.customer,
          stripeSubscriptionId: session.subscription,
          plan,
          status: 'ACTIVE',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + getPlanDurationMs(plan)),
        },
      });
      break;
    }

    case 'invoice.paid': {
      const invoice = event.data.object;
      if (invoice.subscription) {
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
        await prisma.subscription.updateMany({
          where: { stripeSubscriptionId: invoice.subscription },
          data: {
            status: 'ACTIVE',
            currentPeriodStart: new Date(subscription.current_period_start * 1000),
            currentPeriodEnd: new Date(subscription.current_period_end * 1000),
          },
        });
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      if (invoice.subscription) {
        await prisma.subscription.updateMany({
          where: { stripeSubscriptionId: invoice.subscription },
          data: { status: 'PAST_DUE' },
        });
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      await prisma.subscription.updateMany({
        where: { stripeSubscriptionId: subscription.id },
        data: { status: 'CANCELED' },
      });
      break;
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object;
      const statusMap = {
        active: 'ACTIVE',
        past_due: 'PAST_DUE',
        canceled: 'CANCELED',
        trialing: 'TRIALING',
      };
      await prisma.subscription.updateMany({
        where: { stripeSubscriptionId: subscription.id },
        data: {
          status: statusMap[subscription.status] || 'ACTIVE',
          currentPeriodStart: new Date(subscription.current_period_start * 1000),
          currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        },
      });
      break;
    }
  }

  return { received: true };
};

function getPlanDurationMs(plan) {
  const durations = {
    MONTHLY: 30 * 24 * 60 * 60 * 1000,
    QUARTERLY: 90 * 24 * 60 * 60 * 1000,
    BIANNUAL: 180 * 24 * 60 * 60 * 1000,
    YEARLY: 365 * 24 * 60 * 60 * 1000,
    TWO_YEAR: 730 * 24 * 60 * 60 * 1000,
    THREE_YEAR: 1095 * 24 * 60 * 60 * 1000,
  };
  return durations[plan] || durations.MONTHLY;
}
