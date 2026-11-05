import crypto from 'node:crypto';
import {
  activateUserSubscription,
  billingChargeFingerprint,
  createBillingOrder,
  findBillingOrder,
  findBillingOrderByOrderId,
  findOpenInitialBillingOrder,
  findUserById,
  getOrCreateCustomerKey,
  isIdempotencyKeyExpired,
  listBillingOrdersForUser,
  markBillingOrderRecovery,
  rememberIdempotencySend,
  rememberIssuedBillingKey,
  markBillingOrderRefunded,
  setUserBillingKey,
  upgradeUserSubscription,
} from './db.js';
import {
  FREE_TRIAL,
  REVIEW_ONETIME_AMOUNTS,
  REVIEW_ONETIME_PRODUCTS,
  getPlan,
  getPlanRank,
  listPaidPlans,
  listReviewBillingProducts,
  listReviewOnetimeProducts,
  normalizePaidPlanId,
} from './plans.js';
import { formatCardLabel, resolveCardCompanyName } from './card-codes.js';
import {
  getSubscriptionSummary,
  isSubscriptionActive,
  resolveCheckoutAction,
  scheduleDowngrade,
} from './subscription.js';

const BILLING_MOCK = String(process.env.BILLING_MOCK || 'false').toLowerCase() === 'true';

function readEnv(name) {
  return String(process.env[name] || '').trim();
}

function requireEnv(name) {
  const value = readEnv(name);
  if (!value) throw new Error(`${name}가 설정되지 않았습니다.`);
  return value;
}

function singleClientKey() {
  return readEnv('TOSS_SINGLE_CLIENT_KEY');
}

function billingClientKey() {
  return readEnv('TOSS_BILLING_CLIENT_KEY');
}

function requireSingleClientKey() {
  return requireEnv('TOSS_SINGLE_CLIENT_KEY');
}

function requireBillingClientKey() {
  return requireEnv('TOSS_BILLING_CLIENT_KEY');
}

function requireSingleSecret() {
  return requireEnv('TOSS_SINGLE_SECRET_KEY');
}

function requireBillingSecret() {
  return requireEnv('TOSS_BILLING_SECRET_KEY');
}

function assertSingleMerchantReady() {
  requireSingleSecret();
  requireEnv('TOSS_SINGLE_MID');
}

function assertBillingMerchantReady() {
  requireBillingSecret();
  requireEnv('TOSS_BILLING_MID');
}
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
  const singleClient = singleClientKey();
  const singleSecret = readEnv('TOSS_SINGLE_SECRET_KEY');
  const billingClient = billingClientKey();
  const billingSecret = readEnv('TOSS_BILLING_SECRET_KEY');
  const singleConfigured = !!singleClient && !!singleSecret && !!readEnv('TOSS_SINGLE_MID');
  const billingConfigured = !!billingClient && !!billingSecret && !!readEnv('TOSS_BILLING_MID');
  const tossConfigured = singleConfigured || billingConfigured;
  const productionReady = tossConfigured && !BILLING_MOCK;
  const pairs = [];
  if (singleClient || singleSecret) pairs.push([singleClient, singleSecret]);
  if (billingClient || billingSecret) pairs.push([billingClient, billingSecret]);
  const liveKeys = pairs.length > 0 && pairs.every(([client, secret]) => client.startsWith('live_') && secret.startsWith('live_'));
  const testKeys = pairs.length > 0 && pairs.every(([client, secret]) => client.startsWith('test_') && secret.startsWith('test_'));
  return {
    mockMode: BILLING_MOCK,
    tossConfigured,
    singleConfigured,
    billingConfigured,
    productionReady,
    liveMode: productionReady && liveKeys,
    testModeKeys: productionReady && testKeys,
    singleClientKey: singleClient || null,
    billingClientKey: billingClient || null,
    appBaseUrl: APP_BASE_URL,
    subscriptionDays: SUBSCRIPTION_DAYS,
    renewalGraceDays: RENEWAL_GRACE_DAYS,
    renewalMaxAttempts: RENEWAL_MAX_ATTEMPTS,
    autoRenewEnabled: String(process.env.RENEWAL_ENABLED || 'true').toLowerCase() !== 'false',
    freeTrial: FREE_TRIAL,
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
    reviewProducts: {
      billing: listReviewBillingProducts(),
      onetime: listReviewOnetimeProducts(),
    },
  };
}

export function logBillingStartupWarnings() {
  if (BILLING_MOCK) {
    console.warn('WARN: BILLING_MOCK=true — 실제 결제 없음. 배포 시 false + TOSS 키 설정 필요');
  } else if (!readEnv('TOSS_SINGLE_SECRET_KEY') || !singleClientKey() || !readEnv('TOSS_BILLING_SECRET_KEY') || !billingClientKey()) {
    console.warn('WARN: 단건 또는 빌링 키 미설정 — 해당 결제는 불가');
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

  const mockBilling = String(process.env.BILLING_MOCK || 'false').toLowerCase() === 'true';
  if (mockBilling || paymentKey.startsWith('mock_') || paymentKey.startsWith('mock_bill_')) {
    markBillingOrderRefunded(order.id);
  } else {
    const secret = billingOrderUsesBillingKey(order) ? requireBillingSecret() : requireSingleSecret();
    await tossRequest(`https://api.tosspayments.com/v1/payments/${encodeURIComponent(paymentKey)}/cancel`, {
      cancelReason: reason,
    }, { secret });
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

export class TossPaymentUnknownError extends Error {
  constructor(message, code = 'UNKNOWN') {
    super(message);
    this.name = 'TossPaymentUnknownError';
    this.code = code;
  }
}

export class TossPaymentFailedError extends Error {
  constructor(message, code = 'FAILED') {
    super(message);
    this.name = 'TossPaymentFailedError';
    this.code = code;
  }
}

export function classifyTossSecretKey(secret = readEnv('TOSS_BILLING_SECRET_KEY')) {
  const value = String(secret || '');
  if (value.startsWith('live_gsk')) return 'live_gsk';
  if (value.startsWith('test_gsk')) return 'test_gsk';
  if (value.startsWith('live_sk')) return 'live_sk';
  if (value.startsWith('test_sk')) return 'test_sk';
  return 'unknown';
}

export function canLookupPaymentByOrderId(secret = readEnv('TOSS_BILLING_SECRET_KEY')) {
  const family = classifyTossSecretKey(secret);
  return family === 'live_sk' || family === 'test_sk';
}

function billingOrderUsesBillingKey(order) {
  return ['subscribe', 'review_billing', 'renewal'].includes(String(order?.order_kind || ''));
}

let tossTransportForTests = null;

export function setTossTransportForTests(fn) {
  tossTransportForTests = typeof fn === 'function' ? fn : null;
}

async function defaultTossFetch({ url, method, headers, body, signal }) {
  const response = await fetch(url, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
    signal,
  });
  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (_) {
    data = { message: raw.slice(0, 200) };
  }
  return { ok: response.ok, status: response.status, data };
}

function interpretTossResponse(result) {
  const status = Number(result?.status || 0);
  const data = result?.data || {};
  const code = String(data.code || '');
  if (!result || status === 0) {
    throw new TossPaymentUnknownError('결제 응답이 없습니다.', 'EMPTY');
  }
  if (status >= 500 || status === 408 || status === 409 || status === 429) {
    throw new TossPaymentUnknownError(data.message || `결제 응답을 확정할 수 없습니다. (${status})`, code || 'UPSTREAM');
  }
  if (!result.ok) {
    if (code === 'NOT_FOUND_PAYMENT' || code === 'NOT_FOUND' || status === 404) {
      throw new TossPaymentUnknownError(data.message || '결제 조회 결과가 없습니다.', 'NOT_FOUND');
    }
    throw new TossPaymentFailedError(data.message || `결제 실패 (${status})`, code || 'FAILED');
  }
  return data;
}

async function tossRequest(url, body, { method = 'POST', idempotencyKey = null, timeoutMs = 60_000, secret } = {}) {
  if (!secret) throw new Error('결제 시크릿 키가 없습니다.');
  const headers = {
    Authorization: `Basic ${Buffer.from(`${secret}:`).toString('base64')}`,
    'Content-Type': 'application/json',
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const exec = tossTransportForTests || defaultTossFetch;
    const result = await exec({ url, method, headers, body, signal: controller.signal });
    return interpretTossResponse(result);
  } catch (error) {
    if (error instanceof TossPaymentUnknownError || error instanceof TossPaymentFailedError) throw error;
    if (error?.name === 'AbortError') {
      throw new TossPaymentUnknownError('결제 응답 시간이 초과되었습니다.', 'TIMEOUT');
    }
    throw new TossPaymentUnknownError(error?.message || '결제 네트워크 오류', 'NETWORK');
  } finally {
    clearTimeout(timer);
  }
}

async function confirmTossPayment({ paymentKey, orderId, amount }) {
  return tossRequest('https://api.tosspayments.com/v1/payments/confirm', {
    paymentKey,
    orderId,
    amount,
  }, { secret: requireSingleSecret() });
}

export async function issueTossBillingKey({ authKey, customerKey }) {
  const data = await tossRequest('https://api.tosspayments.com/v1/billing/authorizations/issue', {
    authKey,
    customerKey,
  }, { secret: requireBillingSecret() });
  if (!data?.billingKey) {
    throw new Error('빌링키 발급에 실패했습니다.');
  }
  return data;
}

export function extractCardMetaFromBillingIssue(data) {
  const card = data?.card && typeof data.card === 'object' ? data.card : {};
  const companyRaw = String(
    card.cardCompany || card.issuerCode || data?.cardCompany || data?.issuerCode || ''
  ).trim();
  const number = String(
    card.cardNumber || card.number || data?.cardNumber || data?.number || ''
  ).trim();
  const company = resolveCardCompanyName(companyRaw) || companyRaw || null;
  return {
    cardCompany: company || null,
    cardNumber: number || null,
  };
}

export async function chargeWithBillingKey({ billingKey, customerKey, amount, orderId, orderName }) {
  if (!tossTransportForTests) assertBillingMerchantReady();
  const order = findBillingOrderByOrderId(orderId);
  if (!order) throw new Error('주문을 찾을 수 없습니다.');
  if (Number(order.usage_applied) === 1 || order.status === 'paid') {
    return {
      paymentKey: order.payment_key || null,
      raw: null,
      idempotencyKey: order.idempotency_key,
      alreadyApplied: true,
    };
  }
  if (order.status === 'manual_review' || isIdempotencyKeyExpired(order)) {
    markBillingOrderRecovery(order.id, {
      status: 'manual_review',
      failureReason: 'idempotency_expired',
      nextRecoveryAt: null,
    });
    throw new TossPaymentUnknownError('멱등키 유효기간이 지나 자동 재승인할 수 없습니다.', 'IDEMPOTENCY_EXPIRED');
  }
  const fingerprint = billingChargeFingerprint({ amount, orderId, customerKey, orderName });
  if (order.charge_fingerprint && order.charge_fingerprint !== fingerprint) {
    throw new TossPaymentFailedError('같은 주문의 금액이나 결제 정보가 달라 요청할 수 없습니다.', 'PAYLOAD_MISMATCH');
  }
  if (order.charge_billing_key && order.charge_billing_key !== String(billingKey || '')) {
    throw new TossPaymentFailedError('같은 주문의 결제 수단이 달라 요청할 수 없습니다.', 'PAYLOAD_MISMATCH');
  }
  assertBillingMerchantReady();
  rememberIdempotencySend(order.id, billingKey, new Date().toISOString());
  const data = await tossRequest(`https://api.tosspayments.com/v1/billing/${encodeURIComponent(billingKey)}`, {
    customerKey,
    amount,
    orderId,
    orderName,
  }, {
    idempotencyKey: order.idempotency_key,
    timeoutMs: 60_000,
    secret: requireBillingSecret(),
  });
  return {
    paymentKey: data.paymentKey || null,
    raw: data,
    idempotencyKey: order.idempotency_key,
    alreadyApplied: false,
  };
}

export async function lookupTossPaymentByOrderId(orderId) {
  const secret = requireBillingSecret();
  if (!tossTransportForTests && !canLookupPaymentByOrderId(secret)) {
    throw new TossPaymentUnknownError(
      '주문번호 결제 조회는 API 개별 연동 시크릿 키(test_sk, live_sk)에서만 가능합니다.',
      'LOOKUP_KEY_UNSUPPORTED'
    );
  }
  return tossRequest(
    `https://api.tosspayments.com/v1/payments/orders/${encodeURIComponent(orderId)}`,
    null,
    { method: 'GET', timeoutMs: 15_000, secret }
  );
}

export function assessTossPayment(order, payment, { channel = 'billing' } = {}) {
  if (!payment || typeof payment !== 'object') return { action: 'unknown', reason: 'empty' };
  if (String(payment.orderId || '') !== String(order.order_id)) return { action: 'mismatch', reason: 'order_mismatch' };
  const paidAmount = payment.totalAmount != null ? payment.totalAmount : payment.amount;
  if (Number(paidAmount) !== Number(order.amount)) return { action: 'mismatch', reason: 'amount_mismatch' };
  const merchantId = channel === 'single' ? readEnv('TOSS_SINGLE_MID') : readEnv('TOSS_BILLING_MID');
  if (!merchantId) return { action: 'unknown', reason: 'merchant_unconfigured' };
  if (String(payment.mId || '') !== merchantId) return { action: 'mismatch', reason: 'merchant_mismatch' };
  const expectedType = channel === 'single' ? 'NORMAL' : 'BILLING';
  if (String(payment.type || '') !== expectedType) return { action: 'mismatch', reason: 'type_mismatch' };
  const status = String(payment.status || '');
  if (status === 'DONE') return { action: 'apply', reason: 'DONE' };
  if (['CANCELED', 'PARTIAL_CANCELED', 'ABORTED', 'EXPIRED'].includes(status)) {
    return { action: 'fail', reason: status };
  }
  return { action: 'unknown', reason: status || 'unclear' };
}

/**
 * 카드사 심사용: 구독 상태와 무관하게 빌링/단건 창을 연다.
 * - billing: 베이직·스탠다드·프로 정가 → 카드 등록(빌링) 창
 * - onetime: 베이직 9,900 / 스탠다드 10,000 / 프로 30,000 → 일반 결제 창
 */
function billingWindow(order, extra = {}) {
  return {
    orderId: order.order_id,
    amount: Number(order.amount),
    orderName: order.order_name,
    customerKey: order.customer_key,
    planId: order.plan_id,
    planName: getPlan(order.plan_id).name,
    clientKey: requireBillingClientKey(),
    successUrl: `${APP_BASE_URL}/billing-success.html`,
    billingAuthSuccessUrl: `${APP_BASE_URL}/billing-auth-success.html?orderId=${encodeURIComponent(order.order_id)}`,
    failUrl: `${APP_BASE_URL}/billing-fail.html`,
    mockMode: BILLING_MOCK,
    useBillingAuth: true,
    ...extra,
  };
}

function singleWindow(order, extra = {}) {
  return {
    orderId: order.order_id,
    amount: Number(order.amount),
    orderName: order.order_name,
    customerKey: order.customer_key,
    planId: order.plan_id,
    planName: getPlan(order.plan_id).name,
    clientKey: requireSingleClientKey(),
    successUrl: `${APP_BASE_URL}/billing-success.html`,
    billingAuthSuccessUrl: `${APP_BASE_URL}/billing-auth-success.html?orderId=${encodeURIComponent(order.order_id)}`,
    failUrl: `${APP_BASE_URL}/billing-fail.html`,
    mockMode: BILLING_MOCK,
    useBillingAuth: false,
    ...extra,
  };
}

function reuseOrCreateInitialBillingOrder(userId, { planId, amount, orderName, customerKey, orderKind }) {
  const open = findOpenInitialBillingOrder(userId);
  if (open) {
    if (open.status === 'manual_review') {
      throw new Error('확인이 필요한 자동결제가 있어 새 구독을 시작할 수 없습니다.');
    }
    if (String(open.plan_id) !== String(planId) || Number(open.amount) !== Number(amount)) {
      throw new Error('확인되지 않은 자동결제가 있어 새 구독을 시작할 수 없습니다.');
    }
    return open;
  }
  return createBillingOrder({
    userId,
    orderId: createOrderId(userId),
    planId,
    amount,
    orderName,
    customerKey,
    orderKind,
    legalConsentAt: new Date().toISOString(),
  });
}

export function prepareReviewCheckout(userId, { mode, planId, productKey, legalConsent } = {}) {
  assertLegalConsent(legalConsent);
  const user = findUserById(userId);
  if (!user) throw new Error('사용자를 찾을 수 없습니다.');

  const plan = getPlan(normalizePaidPlanId(planId));
  const checkoutMode = String(mode || '').trim() === 'onetime' ? 'onetime' : 'billing';
  const customerKey = getOrCreateCustomerKey(userId);

  if (checkoutMode === 'billing') {
    requireBillingClientKey();
    const order = reuseOrCreateInitialBillingOrder(userId, {
      planId: plan.id,
      amount: plan.price,
      orderName: `스마트스토어 답글 ${plan.name} 정기결제(빌링)`,
      customerKey,
      orderKind: 'review_billing',
    });
    return billingWindow(order, {
      checkoutType: 'subscribe',
      reviewMode: 'billing',
    });
  }

  requireSingleClientKey();
  const key = String(productKey || plan.id);
  const catalog =
    REVIEW_ONETIME_PRODUCTS.find((item) => (item.productKey || item.id) === key) ||
    REVIEW_ONETIME_PRODUCTS.find((item) => item.id === plan.id);
  const amount = Number(catalog?.amount || REVIEW_ONETIME_AMOUNTS[key] || REVIEW_ONETIME_AMOUNTS[plan.id] || plan.price);
  const orderName = `스마트스토어 답글 ${catalog?.label || `${plan.name} 업그레이드`}(단건)`;
  const order = createBillingOrder({
    userId,
    orderId: createOrderId(userId),
    planId: plan.id,
    amount,
    orderName,
    customerKey,
    orderKind: 'review_onetime',
    legalConsentAt: new Date().toISOString(),
  });
  return singleWindow(order, {
    checkoutType: 'upgrade',
    reviewMode: 'onetime',
    productKey: key,
  });
}

export function prepareCheckout(userId, planId, { legalConsent } = {}) {
  assertLegalConsent(legalConsent);
  const user = findUserById(userId);
  if (!user) throw new Error('사용자를 찾을 수 없습니다.');
  const action = resolveCheckoutAction(user, planId);
  const plan = getPlan(action.planId);

  if (action.type === 'schedule_downgrade') {
    const subscription = scheduleDowngrade(userId, action.planId);
    const updated = findUserById(userId);
    return {
      orderId: null,
      amount: 0,
      orderName: action.orderName,
      customerKey: getOrCreateCustomerKey(userId),
      planId: plan.id,
      planName: plan.name,
      checkoutType: action.type,
      useBillingAuth: false,
      clientKey: null,
      successUrl: `${APP_BASE_URL}/billing.html`,
      billingAuthSuccessUrl: `${APP_BASE_URL}/billing.html`,
      failUrl: `${APP_BASE_URL}/billing-fail.html`,
      mockMode: BILLING_MOCK,
      scheduled: true,
      subscription,
      user: updated,
    };
  }

  const customerKey = getOrCreateCustomerKey(userId);
  const useBillingAuth = action.type === 'subscribe';
  if (useBillingAuth) {
    requireBillingClientKey();
    const order = reuseOrCreateInitialBillingOrder(userId, {
      planId: plan.id,
      amount: action.amount,
      orderName: action.orderName,
      customerKey,
      orderKind: 'subscribe',
    });
    return billingWindow(order, { checkoutType: action.type });
  }

  requireSingleClientKey();
  const order = createBillingOrder({
    userId,
    orderId: createOrderId(userId),
    planId: plan.id,
    amount: action.amount,
    orderName: action.orderName,
    customerKey,
    orderKind: 'upgrade',
    legalConsentAt: new Date().toISOString(),
  });
  return singleWindow(order, { checkoutType: action.type });
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

  let paidKey = paymentKey || 'mock_payment';
  if (!(BILLING_MOCK && String(paymentKey || '').startsWith('mock_'))) {
    if (billingOrderUsesBillingKey(order)) {
      throw new Error('자동결제는 단건 승인으로 확인할 수 없습니다.');
    }
    assertSingleMerchantReady();
    const payment = await confirmTossPayment({ paymentKey, orderId, amount: expectedAmount });
    const decision = assessTossPayment(order, payment, { channel: 'single' });
    if (decision.action !== 'apply') {
      if (decision.action === 'fail') {
        markBillingOrderRecovery(order.id, {
          status: 'failed',
          failureReason: decision.reason,
          nextRecoveryAt: null,
        });
      } else if (decision.action === 'mismatch') {
        markBillingOrderRecovery(order.id, {
          status: 'manual_review',
          failureReason: decision.reason,
          nextRecoveryAt: null,
        });
      }
      throw new Error(
        decision.action === 'mismatch'
          ? '단건 결제 상점 정보가 일치하지 않습니다.'
          : '단건 결제가 완료되지 않았습니다.'
      );
    }
    paidKey = payment.paymentKey || paidKey;
  }

  const userBeforeActivate = findUserById(userId);
  const orderKind = String(order.order_kind || '');
  const paymentOptions = { billingOrderId: order.id, paymentKey: paidKey };
  let user;
  if (orderKind === 'review_onetime') {
    if (isSubscriptionActive(userBeforeActivate)) {
      try {
        user = upgradeUserSubscription(userId, order.plan_id, paymentOptions);
      } catch (_) {
        user = activateUserSubscription(userId, order.plan_id, SUBSCRIPTION_DAYS, {
          autoRenew: false,
          ...paymentOptions,
        });
      }
    } else {
      user = activateUserSubscription(userId, order.plan_id, SUBSCRIPTION_DAYS, {
        autoRenew: false,
        ...paymentOptions,
      });
    }
  } else {
    const action = resolveCheckoutAction(userBeforeActivate, order.plan_id);
    if (action.type === 'upgrade') {
      user = upgradeUserSubscription(userId, action.planId, paymentOptions);
    } else {
      user = activateUserSubscription(userId, order.plan_id, SUBSCRIPTION_DAYS, {
        autoRenew: false,
        ...paymentOptions,
      });
    }
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
  if (customerKey && customerKey !== order.customer_key) {
    throw new Error('고객 키가 주문과 일치하지 않습니다.');
  }
  if (order.status === 'paid' || Number(order.usage_applied) === 1) {
    const user = findUserById(userId);
    return {
      order,
      user,
      subscription: getSubscriptionSummary(user),
      alreadyPaid: true,
    };
  }
  if (order.status === 'failed' || order.status === 'manual_review') {
    throw new Error('이 주문은 자동으로 다시 결제할 수 없습니다.');
  }

  const userBeforeActivate = findUserById(userId);
  const orderKind = String(order.order_kind || '');
  const isReviewBilling = orderKind === 'review_billing';
  if (!isReviewBilling) {
    const action = resolveCheckoutAction(userBeforeActivate, order.plan_id);
    if (action.type !== 'subscribe') {
      throw new Error('자동결제 등록은 신규 구독 결제에서만 사용할 수 있습니다.');
    }
  }

  let billingKey = order.charge_billing_key || null;
  let cardMeta = { cardCompany: null, cardNumber: null };
  const mockIssue = BILLING_MOCK && String(authKey || '').startsWith('mock_auth_');
  if (!billingKey) {
    if (mockIssue) {
      billingKey = mockBillingKeyForUser(userId);
      cardMeta = { cardCompany: '테스트', cardNumber: '****0000' };
    } else {
      assertBillingMerchantReady();
      const issued = await issueTossBillingKey({ authKey, customerKey: customerKey || order.customer_key });
      billingKey = issued.billingKey;
      cardMeta = extractCardMetaFromBillingIssue(issued);
    }
    if (!billingKey) throw new Error('빌링키 발급에 실패했습니다.');
    rememberIssuedBillingKey(order.id, billingKey);
  }

  if (mockIssue) {
    const user = activateUserSubscription(userId, order.plan_id, SUBSCRIPTION_DAYS, {
      billingKey,
      autoRenew: true,
      billingOrderId: order.id,
      paymentKey: `mock_pay_${order.order_id}`,
      cardCompany: cardMeta.cardCompany,
      cardNumber: cardMeta.cardNumber,
    });
    return {
      order: findBillingOrder(order.id),
      user,
      subscription: getSubscriptionSummary(user),
      alreadyPaid: false,
    };
  }

  let charge;
  try {
    charge = await chargeWithBillingKey({
      billingKey,
      customerKey: order.customer_key,
      amount: order.amount,
      orderId: order.order_id,
      orderName: order.order_name,
    });
  } catch (error) {
    if (error instanceof TossPaymentUnknownError && error.code !== 'IDEMPOTENCY_EXPIRED') {
      markBillingOrderRecovery(order.id, {
        status: 'unknown',
        failureReason: error.code,
        nextRecoveryAt: new Date().toISOString(),
      });
    } else if (error instanceof TossPaymentFailedError && error.code !== 'PAYLOAD_MISMATCH') {
      markBillingOrderRecovery(order.id, {
        status: 'failed',
        failureReason: error.code,
        nextRecoveryAt: null,
      });
    }
    throw error;
  }

  if (charge.alreadyApplied) {
    const user = findUserById(userId);
    return {
      order: findBillingOrder(order.id),
      user,
      subscription: getSubscriptionSummary(user),
      alreadyPaid: true,
    };
  }

  const decision = assessTossPayment(order, charge.raw, { channel: 'billing' });
  if (decision.action === 'apply') {
    const user = activateUserSubscription(userId, order.plan_id, SUBSCRIPTION_DAYS, {
      billingKey,
      autoRenew: true,
      billingOrderId: order.id,
      paymentKey: charge.paymentKey,
      cardCompany: cardMeta.cardCompany,
      cardNumber: cardMeta.cardNumber,
    });
    return {
      order: findBillingOrder(order.id),
      user,
      subscription: getSubscriptionSummary(user),
      alreadyPaid: false,
    };
  }

  if (decision.action === 'fail') {
    markBillingOrderRecovery(order.id, {
      status: 'failed',
      failureReason: decision.reason,
      nextRecoveryAt: null,
    });
    throw new TossPaymentFailedError('자동결제 승인이 완료되지 않았습니다.', decision.reason);
  }
  if (decision.action === 'mismatch') {
    markBillingOrderRecovery(order.id, {
      status: 'manual_review',
      failureReason: decision.reason,
      nextRecoveryAt: null,
    });
    throw new TossPaymentFailedError('자동결제 상점 정보가 일치하지 않습니다.', decision.reason);
  }
  markBillingOrderRecovery(order.id, {
    status: 'unknown',
    failureReason: decision.reason,
    nextRecoveryAt: new Date().toISOString(),
  });
  throw new TossPaymentUnknownError('결제 결과를 확인하지 못했습니다. 구독은 결제 확인 후 시작됩니다.', decision.reason);
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
    rememberIssuedBillingKey(order.id, billingKey);
    const user = activateUserSubscription(userId, order.plan_id, SUBSCRIPTION_DAYS, {
      billingKey,
      autoRenew: true,
      billingOrderId: order.id,
      paymentKey: `mock_pay_${order.order_id}`,
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
  if (checkout.checkoutType === 'schedule_downgrade') {
    return {
      order: null,
      user: checkout.user,
      subscription: checkout.subscription,
      alreadyPaid: false,
      scheduled: true,
      checkoutType: 'schedule_downgrade',
    };
  }
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
    clientKey: requireBillingClientKey(),
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
  let cardMeta = { cardCompany: null, cardNumber: null };
  if (BILLING_MOCK && String(authKey || '').startsWith('mock_auth_card_')) {
    billingKey = mockBillingKeyForUser(userId);
    cardMeta = { cardCompany: '테스트', cardNumber: '****0000' };
  } else {
    const issued = await issueTossBillingKey({ authKey, customerKey });
    billingKey = issued.billingKey;
    cardMeta = extractCardMetaFromBillingIssue(issued);
  }

  setUserBillingKey(userId, billingKey, {
    enableAutoRenew: !!user.auto_renew,
    cardCompany: cardMeta.cardCompany,
    cardNumber: cardMeta.cardNumber,
  });
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
