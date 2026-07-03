import crypto from 'node:crypto';
import {
  activateUserSubscription,
  createBillingOrder,
  findBillingOrder,
  findBillingOrderByOrderId,
  findUserById,
  getOrCreateCustomerKey,
  markBillingOrderPaid,
  setUserBillingKey,
  upgradeUserSubscription,
} from './db.js';
import { getPlan, getPlanRank, listPaidPlans, normalizePaidPlanId } from './plans.js';
import { getSubscriptionSummary, resolveCheckoutAction } from './subscription.js';

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
    autoRenewEnabled: String(process.env.RENEWAL_ENABLED || 'true').toLowerCase() !== 'false',
    plans: listPaidPlans().map((plan) => ({
      id: plan.id,
      name: plan.name,
      price: plan.price,
      replyLimit: plan.replyLimit,
      toneLimit: plan.toneLimit,
      rank: getPlanRank(plan.id),
    })),
  };
}

export function createOrderId(userId) {
  const rand = crypto.randomBytes(6).toString('hex');
  return `order_${userId}_${Date.now()}_${rand}`;
}

export function isMockBillingKey(billingKey) {
  return BILLING_MOCK && String(billingKey || '').startsWith('mock_bill_');
}

function mockBillingKeyForUser(userId) {
  return `mock_bill_${userId}`;
}

function tossAuthHeader() {
  return `Basic ${Buffer.from(`${TOSS_SECRET_KEY}:`).toString('base64')}`;
}

async function tossRequest(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: tossAuthHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (_) {
    data = {};
  }

  if (!response.ok) {
    const message = data?.message || raw.slice(0, 200) || `Toss 요청 실패 (${response.status})`;
    throw new Error(message);
  }

  return data;
}

async function confirmTossPayment({ paymentKey, orderId, amount }) {
  return tossRequest('https://api.tosspayments.com/v1/payments/confirm', {
    paymentKey,
    orderId,
    amount,
  });
}

export async function issueTossBillingKey({ authKey, customerKey }) {
  if (!TOSS_SECRET_KEY) throw new Error('TOSS_SECRET_KEY가 설정되지 않았습니다.');
  const data = await tossRequest('https://api.tosspayments.com/v1/billing/authorizations/issue', {
    authKey,
    customerKey,
  });
  if (!data?.billingKey) {
    throw new Error('빌링키 발급에 실패했습니다.');
  }
  return data;
}

export async function chargeWithBillingKey({ billingKey, customerKey, amount, orderId, orderName }) {
  if (!TOSS_SECRET_KEY) throw new Error('TOSS_SECRET_KEY가 설정되지 않았습니다.');
  const data = await tossRequest(`https://api.tosspayments.com/v1/billing/${billingKey}`, {
    customerKey,
    amount,
    orderId,
    orderName,
  });
  return {
    paymentKey: data.paymentKey || null,
    raw: data,
  };
}

export function prepareCheckout(userId, planId) {
  const user = findUserById(userId);
  if (!user) throw new Error('사용자를 찾을 수 없습니다.');
  const action = resolveCheckoutAction(user, planId);
  const plan = getPlan(action.planId);
  const orderId = createOrderId(userId);
  const customerKey = getOrCreateCustomerKey(userId);

  createBillingOrder({
    userId,
    orderId,
    planId: plan.id,
    amount: action.amount,
    orderName: action.orderName,
    customerKey,
  });

  const useBillingAuth = action.type === 'subscribe';

  return {
    orderId,
    amount: action.amount,
    orderName: action.orderName,
    customerKey,
    planId: plan.id,
    planName: plan.name,
    checkoutType: action.type,
    useBillingAuth,
    clientKey: TOSS_CLIENT_KEY || null,
    successUrl: `${APP_BASE_URL}/billing-success.html`,
    billingAuthSuccessUrl: `${APP_BASE_URL}/billing-auth-success.html?orderId=${encodeURIComponent(orderId)}`,
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

  const userBeforeActivate = findUserById(userId);
  const action = resolveCheckoutAction(userBeforeActivate, order.plan_id);

  let user;
  if (action.type === 'upgrade') {
    user = upgradeUserSubscription(userId, action.planId);
  } else {
    user = activateUserSubscription(userId, order.plan_id, SUBSCRIPTION_DAYS, {
      autoRenew: false,
    });
  }

  return {
    order: findBillingOrder(order.id),
    user,
    subscription: getSubscriptionSummary(user),
    alreadyPaid: false,
  };
}

export async function confirmBillingAuthCheckout(userId, { authKey, customerKey, orderId }) {
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

  const userBeforeActivate = findUserById(userId);
  const action = resolveCheckoutAction(userBeforeActivate, order.plan_id);
  if (action.type !== 'subscribe') {
    throw new Error('자동결제 등록은 신규 구독 결제에서만 사용할 수 있습니다.');
  }

  let billingKey;
  if (BILLING_MOCK && String(authKey || '').startsWith('mock_auth_')) {
    billingKey = mockBillingKeyForUser(userId);
  } else {
    if (!TOSS_SECRET_KEY) throw new Error('TOSS_SECRET_KEY가 설정되지 않았습니다.');
    const issued = await issueTossBillingKey({ authKey, customerKey });
    billingKey = issued.billingKey;
  }

  setUserBillingKey(userId, billingKey);
  markBillingOrderPaid(order.id, billingKey);

  const user = activateUserSubscription(userId, order.plan_id, SUBSCRIPTION_DAYS, {
    billingKey,
    autoRenew: true,
  });

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

  const userBeforeActivate = findUserById(userId);
  const action = resolveCheckoutAction(userBeforeActivate, order.plan_id);

  if (action.type === 'subscribe') {
    const billingKey = mockBillingKeyForUser(userId);
    setUserBillingKey(userId, billingKey);
    markBillingOrderPaid(order.id, billingKey);
    const user = activateUserSubscription(userId, order.plan_id, SUBSCRIPTION_DAYS, {
      billingKey,
      autoRenew: true,
    });
    return {
      order: findBillingOrder(order.id),
      user,
      subscription: getSubscriptionSummary(user),
      alreadyPaid: false,
    };
  }

  return confirmCheckout(userId, {
    paymentKey: `mock_${orderId}`,
    orderId,
    amount: order.amount,
  });
}

export async function mockConfirmBillingAuth(userId, orderId) {
  if (!BILLING_MOCK) {
    throw new Error('BILLING_MOCK 모드에서만 사용할 수 있습니다.');
  }
  return confirmBillingAuthCheckout(userId, {
    authKey: `mock_auth_${orderId}`,
    customerKey: getOrCreateCustomerKey(userId),
    orderId,
  });
}
