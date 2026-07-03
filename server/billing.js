import crypto from 'node:crypto';
import {
  activateUserSubscription,
  createBillingOrder,
  findBillingOrder,
  findBillingOrderByOrderId,
  findUserById,
  getOrCreateCustomerKey,
  listBillingOrdersForUser,
  markBillingOrderPaid,
  markBillingOrderRefunded,
  setUserBillingKey,
  upgradeUserSubscription,
} from './db.js';
import { getPlan, getPlanRank, listPaidPlans, normalizePaidPlanId } from './plans.js';
import { getSubscriptionSummary, isSubscriptionActive, resolveCheckoutAction } from './subscription.js';

const TOSS_SECRET_KEY = String(process.env.TOSS_SECRET_KEY || '').trim();
const TOSS_CLIENT_KEY = String(process.env.TOSS_CLIENT_KEY || '').trim();
const BILLING_MOCK = String(process.env.BILLING_MOCK || 'false').toLowerCase() === 'true';
const SUBSCRIPTION_DAYS = Number(process.env.SUBSCRIPTION_DAYS || 30);
const RENEWAL_GRACE_DAYS = Number(process.env.RENEWAL_GRACE_DAYS || 3);
const RENEWAL_MAX_ATTEMPTS = Number(process.env.RENEWAL_MAX_ATTEMPTS || 3);

function resolveAppBaseUrl() {
  const explicit = String(process.env.APP_BASE_URL || '').trim().replace(/\/$/, '');
  if (explicit) return explicit;

  const railwayDomain = String(process.env.RAILWAY_PUBLIC_DOMAIN || '').trim();
  if (railwayDomain) return `https://${railwayDomain}`.replace(/\/$/, '');

  const port = process.env.PORT || 8787;
  return `http://127.0.0.1:${port}`;
}

const APP_BASE_URL = resolveAppBaseUrl();

export function assertLegalConsent(legalConsent) {
  if (legalConsent !== true && legalConsent !== 'true' && legalConsent !== 1) {
    throw new Error('정기결제 안내에 동의해야 결제할 수 있습니다.');
  }
}

function assertOrderHasLegalConsent(order) {
  if (!order?.legal_consent_at) {
    throw new Error('정기결제 안내에 동의해야 결제할 수 있습니다.');
  }
}

export function getBillingConfig() {
  const tossConfigured = !!TOSS_SECRET_KEY && !!TOSS_CLIENT_KEY;
  const productionReady = tossConfigured && !BILLING_MOCK;
  return {
    mockMode: BILLING_MOCK,
    tossConfigured,
    productionReady,
    clientKey: TOSS_CLIENT_KEY || null,
    appBaseUrl: APP_BASE_URL,
    subscriptionDays: SUBSCRIPTION_DAYS,
    renewalGraceDays: RENEWAL_GRACE_DAYS,
    renewalMaxAttempts: RENEWAL_MAX_ATTEMPTS,
    autoRenewEnabled: String(process.env.RENEWAL_ENABLED || 'true').toLowerCase() !== 'false',
    legalNotice: {
      billingCycle: `${SUBSCRIPTION_DAYS}일`,
      cancelMethod: '확장 프로그램 [설정] → [구독 취소]',
      retryPolicy: `갱신 실패 시 최대 ${RENEWAL_MAX_ATTEMPTS}회(약 ${RENEWAL_GRACE_DAYS}일) 재시도`,
    },
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

export function logBillingStartupWarnings() {
  if (BILLING_MOCK) {
    console.warn('WARN: BILLING_MOCK=true — 실제 결제 없음. 배포 시 false + TOSS 키 설정 필요');
  } else if (!TOSS_SECRET_KEY || !TOSS_CLIENT_KEY) {
    console.warn('WARN: TOSS 키 미설정 — 결제 불가');
  } else {
    console.log('Production billing ready (Toss + auto-renewal)');
  }
}

function formatOrderKind(kind) {
  const map = {
    subscribe: '신규 구독',
    upgrade: '플랜 업그레이드',
    renewal: '자동 갱신',
    card_update: '결제 수단 변경',
    payment: '결제',
  };
  return map[kind] || kind || '결제';
}

export function getPaymentHistory(userId, limit = 20) {
  return listBillingOrdersForUser(userId, limit).map((order) => ({
    orderId: order.order_id,
    planId: order.plan_id,
    planName: getPlan(order.plan_id).name,
    amount: order.amount,
    orderName: order.order_name,
    kind: order.order_kind || 'payment',
    kindLabel: formatOrderKind(order.order_kind),
    status: order.status,
    paidAt: order.paid_at || order.created_at,
  }));
}

export async function refundBillingOrder(orderDbId, { reason = '관리자 환불' } = {}) {
  const order = findBillingOrder(orderDbId);
  if (!order) throw new Error('주문을 찾을 수 없습니다.');
  if (order.status === 'refunded') throw new Error('이미 환불된 주문입니다.');
  if (order.status !== 'paid') throw new Error('결제 완료된 주문만 환불할 수 있습니다.');

  const paymentKey = String(order.payment_key || '').trim();
  if (!paymentKey) throw new Error('환불할 payment_key가 없습니다.');

  if (BILLING_MOCK || paymentKey.startsWith('mock_') || paymentKey.startsWith('mock_bill_')) {
    markBillingOrderRefunded(order.id);
  } else {
    if (!TOSS_SECRET_KEY) throw new Error('TOSS_SECRET_KEY가 설정되지 않았습니다.');
    await tossRequest(`https://api.tosspayments.com/v1/payments/${encodeURIComponent(paymentKey)}/cancel`, {
      cancelReason: reason,
    });
    markBillingOrderRefunded(order.id);
  }

  return findBillingOrder(order.id);
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

export function prepareCheckout(userId, planId, { legalConsent } = {}) {
  assertLegalConsent(legalConsent);
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
    orderKind: action.type === 'upgrade' ? 'upgrade' : 'subscribe',
    legalConsentAt: new Date().toISOString(),
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
  assertOrderHasLegalConsent(order);
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
  assertOrderHasLegalConsent(order);
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
  assertOrderHasLegalConsent(order);

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

export async function mockSubscribe(userId, planId, { legalConsent } = {}) {
  if (!BILLING_MOCK) {
    throw new Error('BILLING_MOCK 모드에서만 사용할 수 있습니다.');
  }
  const checkout = prepareCheckout(userId, planId, { legalConsent });
  return mockConfirmBillingAuth(userId, checkout.orderId);
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

export function prepareCardUpdate(userId) {
  const user = findUserById(userId);
  if (!user) throw new Error('사용자를 찾을 수 없습니다.');
  if (!isSubscriptionActive(user)) {
    throw new Error('활성 구독이 있을 때만 결제 수단을 변경할 수 있습니다.');
  }
  if (String(user.subscription_status || 'none') === 'cancelled') {
    throw new Error('취소 예약 중에는 결제 수단을 변경할 수 없습니다. [취소 철회] 후 다시 시도해 주세요.');
  }

  const customerKey = getOrCreateCustomerKey(userId);
  return {
    customerKey,
    clientKey: TOSS_CLIENT_KEY || null,
    billingAuthSuccessUrl: `${APP_BASE_URL}/billing-auth-success.html?mode=card-update`,
    failUrl: `${APP_BASE_URL}/billing-fail.html`,
    mockMode: BILLING_MOCK,
  };
}

export async function confirmCardUpdate(userId, { authKey, customerKey }) {
  const user = findUserById(userId);
  if (!user) throw new Error('사용자를 찾을 수 없습니다.');
  if (!isSubscriptionActive(user)) {
    throw new Error('활성 구독이 있을 때만 결제 수단을 변경할 수 있습니다.');
  }

  let billingKey;
  if (BILLING_MOCK && String(authKey || '').startsWith('mock_auth_card_')) {
    billingKey = mockBillingKeyForUser(userId);
  } else {
    if (!TOSS_SECRET_KEY) throw new Error('TOSS_SECRET_KEY가 설정되지 않았습니다.');
    const issued = await issueTossBillingKey({ authKey, customerKey });
    billingKey = issued.billingKey;
  }

  setUserBillingKey(userId, billingKey, { enableAutoRenew: !!user.auto_renew });
  return {
    user: findUserById(userId),
    subscription: getSubscriptionSummary(findUserById(userId)),
  };
}

export async function mockConfirmCardUpdate(userId) {
  if (!BILLING_MOCK) {
    throw new Error('BILLING_MOCK 모드에서만 사용할 수 있습니다.');
  }
  return confirmCardUpdate(userId, {
    authKey: `mock_auth_card_${userId}_${Date.now()}`,
    customerKey: getOrCreateCustomerKey(userId),
  });
}
