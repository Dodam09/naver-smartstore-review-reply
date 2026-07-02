import crypto from 'node:crypto';
import {
  activateUserSubscription,
  createBillingOrder,
  findBillingOrder,
  findBillingOrderByOrderId,
  findUserById,
  getOrCreateCustomerKey,
  markBillingOrderPaid,
} from './db.js';
import { getPlan, normalizePlanId, PLANS } from './plans.js';
import { addDaysIso, getSubscriptionSummary } from './subscription.js';

const TOSS_SECRET_KEY = String(process.env.TOSS_SECRET_KEY || '').trim();
const TOSS_CLIENT_KEY = String(process.env.TOSS_CLIENT_KEY || '').trim();
const BILLING_MOCK = String(process.env.BILLING_MOCK || 'false').toLowerCase() === 'true';
const SUBSCRIPTION_DAYS = Number(process.env.SUBSCRIPTION_DAYS || 30);

function resolveAppBaseUrl() {
  const explicit = String(process.env.APP_BASE_URL || '').trim().replace(/\/$/, '');
  if (explicit) return explicit;

  const railwayDomain = String(process.env.RAILWAY_PUBLIC_DOMAIN || '').trim();
  if (railwayDomain) return `https://${railwayDomain}`.replace(/\/$/, '');

  const port = process.env.PORT || 8787;
  return `http://127.0.0.1:${port}`;
}

const APP_BASE_URL = resolveAppBaseUrl();

export function getBillingConfig() {
  return {
    mockMode: BILLING_MOCK,
    tossConfigured: !!TOSS_SECRET_KEY && !!TOSS_CLIENT_KEY,
    clientKey: TOSS_CLIENT_KEY || null,
    appBaseUrl: APP_BASE_URL,
    subscriptionDays: SUBSCRIPTION_DAYS,
    plans: Object.values(PLANS).map((plan) => ({
      id: plan.id,
      name: plan.name,
      price: plan.price,
      replyLimit: plan.replyLimit,
      toneLimit: plan.toneLimit,
    })),
  };
}

function createOrderId(userId) {
  const rand = crypto.randomBytes(6).toString('hex');
  return `order_${userId}_${Date.now()}_${rand}`;
}

function tossAuthHeader() {
  return `Basic ${Buffer.from(`${TOSS_SECRET_KEY}:`).toString('base64')}`;
}

async function confirmTossPayment({ paymentKey, orderId, amount }) {
  const response = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
    method: 'POST',
    headers: {
      Authorization: tossAuthHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ paymentKey, orderId, amount }),
  });

  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (_) {
    data = {};
  }

  if (!response.ok) {
    const message = data?.message || raw.slice(0, 200) || `결제 승인 실패 (${response.status})`;
    throw new Error(message);
  }

  return data;
}

export function prepareCheckout(userId, planId) {
  const user = findUserById(userId);
  if (!user) throw new Error('사용자를 찾을 수 없습니다.');

  const plan = getPlan(normalizePlanId(planId));
  const orderId = createOrderId(userId);
  const customerKey = getOrCreateCustomerKey(userId);

  createBillingOrder({
    userId,
    orderId,
    planId: plan.id,
    amount: plan.price,
    orderName: `스마트스토어 답글 ${plan.name}`,
    customerKey,
  });

  return {
    orderId,
    amount: plan.price,
    orderName: `스마트스토어 답글 ${plan.name}`,
    customerKey,
    planId: plan.id,
    planName: plan.name,
    clientKey: TOSS_CLIENT_KEY || null,
    successUrl: `${APP_BASE_URL}/billing-success.html`,
    failUrl: `${APP_BASE_URL}/billing-fail.html`,
    mockMode: BILLING_MOCK,
  };
}

export async function confirmCheckout(userId, { paymentKey, orderId, amount }) {
  const order = findBillingOrderByOrderId(orderId);
  if (!order) throw new Error('주문을 찾을 수 없습니다.');
  if (Number(order.user_id) !== Number(userId)) {
    throw new Error('주문 정보가 일치하지 않습니다.');
  }
  if (order.status === 'paid') {
    const user = findUserById(userId);
    return {
      order,
      user,
      subscription: getSubscriptionSummary(user),
      alreadyPaid: true,
    };
  }

  const expectedAmount = Number(order.amount);
  const paidAmount = Number(amount);
  if (!Number.isFinite(paidAmount) || paidAmount !== expectedAmount) {
    throw new Error('결제 금액이 일치하지 않습니다.');
  }

  if (BILLING_MOCK && String(paymentKey || '').startsWith('mock_')) {
    markBillingOrderPaid(order.id, paymentKey || 'mock_payment');
  } else {
    if (!TOSS_SECRET_KEY) throw new Error('TOSS_SECRET_KEY가 설정되지 않았습니다.');
    await confirmTossPayment({ paymentKey, orderId, amount: expectedAmount });
    markBillingOrderPaid(order.id, paymentKey);
  }

  const user = activateUserSubscription(userId, order.plan_id, SUBSCRIPTION_DAYS);
  return {
    order: findBillingOrder(order.id),
    user,
    subscription: getSubscriptionSummary(user),
    alreadyPaid: false,
  };
}

export async function mockConfirmCheckout(userId, orderId) {
  if (!BILLING_MOCK) {
    throw new Error('BILLING_MOCK 모드에서만 사용할 수 있습니다.');
  }
  const order = findBillingOrderByOrderId(orderId);
  if (!order) throw new Error('주문을 찾을 수 없습니다.');
  if (Number(order.user_id) !== Number(userId)) {
    throw new Error('주문 정보가 일치하지 않습니다.');
  }

  return confirmCheckout(userId, {
    paymentKey: `mock_${orderId}`,
    orderId,
    amount: order.amount,
  });
}
