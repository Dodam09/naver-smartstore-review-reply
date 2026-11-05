import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { after, before, beforeEach, test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-stability-'));
process.env.DATA_DIR = tmp;
process.env.DB_PATH = path.join(tmp, 'app.db');
process.env.GEMINI_API_KEY = 'test-key';
process.env.GEMINI_MAX_RETRIES = '0';
process.env.GEMINI_TIMEOUT_MS = '2000';
process.env.ALLOW_REGISTRATION = 'true';
process.env.BILLING_MOCK = 'true';
process.env.RENEWAL_ENABLED = 'false';

const { setGeminiFetchForTests } = await import('../gemini.js');
const { configureGeminiQueue, resetGeminiQueueForTests } = await import('../gemini-queue.js');
const { app } = await import('../index.js');
const { loginUser, registerUser } = await import('../auth.js');
const {
  activateUserSubscription,
  createBillingOrder,
  currentPeriod,
  deactivateUserSubscription,
  findBillingOrder,
  findUserById,
  getDb,
  getOrCreateCustomerKey,
  getUsageRow,
  migrateLegacySubscriptionUsage,
  setUsageMigrationFaultForTests,
  recordRenewalFailure,
  renewUserSubscriptionPeriod,
  setSubscriptionFaultForTests,
  setUsageLogFaultForTests,
  setUserSubscriptionActive,
} = await import('../db.js');
const {
  chargeWithBillingKey,
  classifyTossSecretKey,
  confirmBillingAuthCheckout,
  confirmCardUpdate,
  confirmCheckout,
  mockConfirmBillingAuth,
  mockConfirmCheckout,
  mockSubscribe,
  prepareCheckout,
  prepareCardUpdate,
  prepareReviewCheckout,
  refundBillingOrder,
  setTossTransportForTests,
} = await import('../billing.js');
const { recoverBillingOrder } = await import('../billing-recovery.js');
const { chargeAndApplyRenewal } = await import('../renewal.js');
const { cancelUserSubscriptionAtPeriodEnd, scheduleDowngrade } = await import('../subscription.js');
const { getUsageSummary, recordUsage, resetUserLocksForTests } = await import('../usage.js');

function geminiJson(text) {
  return JSON.stringify({
    candidates: [{ content: { parts: [{ text }] } }],
  });
}

function fakeOk(text = '배송이 늦어 죄송합니다. 다음에도 찾아 주세요.') {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    async text() {
      return geminiJson(text);
    },
  };
}

function fakeStatus(status) {
  return {
    ok: false,
    status,
    headers: { get: () => null },
    async text() {
      return JSON.stringify({ error: { message: `status ${status}` } });
    },
  };
}

const replyBody = {
  channel: 'review',
  systemPrompt: '짧고 공손하게 답글만 작성하세요. 감사합니다 정도로 마무리합니다.',
  row: { content: '포장이 꼼꼼하고 좋았어요', product: '테스트상품' },
};

let server;
let baseUrl;
let seq = 0;

function nextEmail() {
  seq += 1;
  return `user${seq}@example.com`;
}

async function createSession({ planId = 'none', subscribe = false } = {}) {
  const email = nextEmail();
  const password = 'password1';
  const user = registerUser({ email, password, planId: subscribe ? planId : 'none' });
  if (subscribe) setUserSubscriptionActive(user.id, planId, 30);
  return loginUser({ email, password });
}

function request(pathname, { method = 'GET', token, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(
      url,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...headers,
          ...(payload ? { 'Content-Length': payload.length } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let data = {};
          try {
            data = raw ? JSON.parse(raw) : {};
          } catch (_) {
            data = { raw };
          }
          resolve({ status: res.statusCode, data });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  process.env.GEMINI_MAX_RETRIES = '0';
  process.env.GEMINI_TIMEOUT_MS = '2000';
  resetGeminiQueueForTests();
  resetUserLocksForTests();
  setSubscriptionFaultForTests(null);
  setUsageLogFaultForTests(null);
  setTossTransportForTests(null);
  process.env.TOSS_SINGLE_CLIENT_KEY = 'test_ck_single_store';
  process.env.TOSS_SINGLE_SECRET_KEY = 'test_sk_single_store';
  process.env.TOSS_SINGLE_MID = 'mid_single';
  process.env.TOSS_BILLING_CLIENT_KEY = 'test_ck_billing_store';
  process.env.TOSS_BILLING_SECRET_KEY = 'test_sk_billing_store';
  process.env.TOSS_BILLING_MID = 'mid_billing';
  delete process.env.TOSS_CLIENT_KEY;
  delete process.env.TOSS_SECRET_KEY;
  delete process.env.TOSS_MID;
  delete process.env.DEV_API_SECRET;
  delete process.env.RAILWAY_ENVIRONMENT;
  delete process.env.RAILWAY_ENVIRONMENT_NAME;
  delete process.env.ADMIN_SECRET;
  if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'development') {
    delete process.env.NODE_ENV;
  }
  configureGeminiQueue({ maxConcurrent: 5, maxQueued: 20, queueWaitMs: 15000 });
  setGeminiFetchForTests(async () => fakeOk());
});

function makeOrder(userId, planId = 'basic', orderKind = 'subscribe') {
  seq += 1;
  const amount = planId === 'pro' ? 39900 : planId === 'standard' ? 19900 : 9900;
  return createBillingOrder({
    userId,
    orderId: `ord_${userId}_${seq}`,
    planId,
    amount,
    orderName: '테스트 결제',
    customerKey: `cust_${userId}`,
    orderKind,
    legalConsentAt: new Date().toISOString(),
  });
}

function tossDone(order, extra = {}) {
  return {
    paymentKey: `pay_${order.id}`,
    orderId: order.order_id,
    totalAmount: order.amount,
    status: 'DONE',
    type: 'BILLING',
    mId: 'mid_billing',
    ...extra,
  };
}

function usageLogCount(userId) {
  return Number(getDb().prepare('SELECT COUNT(*) AS n FROM usage_logs WHERE user_id = ?').get(userId).n);
}

function confirmOrderInWorker(payload) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../apply-order-worker.mjs', import.meta.url), {
      workerData: {
        dataDir: process.env.DATA_DIR,
        dbPath: process.env.DB_PATH,
        ...payload,
      },
    });
    const messages = [];
    worker.on('message', (message) => messages.push(message));
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`worker exit ${code}`));
        return;
      }
      resolve(messages.at(-1) || { ok: false, error: 'no message' });
    });
  });
}

test('health와 이메일 로그인 응답 형식이 유지된다', async () => {
  const health = await request('/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.ok, true);
  assert.equal(health.data.billing.mockMode, true);
  assert.ok(health.data.geminiQueue);
  assert.equal(health.data.geminiQueue.maxConcurrent, 5);

  const session = await createSession();
  const me = await request('/api/auth/me', { token: session.token });
  assert.equal(me.status, 200);
  assert.equal(me.data.ok, true);
  assert.equal(me.data.user.planId, 'none');
  assert.equal(me.data.usage.replyLimit, 10);
});

test('답글 생성 성공 시에만 사용량이 오른다', async () => {
  const session = await createSession();
  const ok = await request('/api/generate-reply', { method: 'POST', token: session.token, body: replyBody });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.ok, true);
  assert.equal(ok.data.usage.replyUsed, 1);

  setGeminiFetchForTests(async () => fakeStatus(500));
  const fail = await request('/api/generate-reply', { method: 'POST', token: session.token, body: replyBody });
  assert.equal(fail.status, 500);
  assert.equal(fail.data.ok, false);
  const usage = getUsageSummary(session.user.id, 'none', undefined, false);
  assert.equal(usage.replyUsed, 1);
});

test('빈 답변과 공백 답변은 사용량을 차감하지 않는다', async () => {
  const session = await createSession();
  for (const blank of ['', '   \n\t  ']) {
    setGeminiFetchForTests(async () => fakeOk(blank));
    const res = await request('/api/generate-reply', { method: 'POST', token: session.token, body: replyBody });
    assert.equal(res.status, 502);
    assert.equal(res.data.ok, false);
    assert.equal(res.data.code, 'GEMINI_EMPTY');
  }
  assert.equal(getUsageSummary(session.user.id, 'none', undefined, false).replyUsed, 0);
});

test('타임아웃과 생성 중 오류는 사용량을 차감하지 않는다', async () => {
  const session = await createSession();
  process.env.GEMINI_TIMEOUT_MS = '40';
  process.env.GEMINI_MAX_RETRIES = '0';
  setGeminiFetchForTests((_url, options) => new Promise((_resolve, reject) => {
    const signal = options?.signal;
    if (signal?.aborted) {
      const err = new Error('aborted');
      err.name = 'AbortError';
      reject(err);
      return;
    }
    signal?.addEventListener('abort', () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      reject(err);
    }, { once: true });
  }));
  const timeout = await request('/api/generate-reply', { method: 'POST', token: session.token, body: replyBody });
  assert.equal(timeout.status, 504);
  assert.equal(timeout.data.ok, false);

  setGeminiFetchForTests(async () => {
    throw new Error('생성 중 서버 오류');
  });
  const crashed = await request('/api/generate-reply', { method: 'POST', token: session.token, body: replyBody });
  assert.notEqual(crashed.status, 200);
  assert.equal(crashed.data.ok, false);
  assert.equal(getUsageSummary(session.user.id, 'none', undefined, false).replyUsed, 0);
});

test('근거 없는 문의 답변이 비면 사용량을 차감하지 않는다', async () => {
  const session = await createSession();
  setGeminiFetchForTests(async () => fakeOk('자세한 안내는 https://example.com 에서 확인해 주세요.'));
  const res = await request('/api/generate-reply', {
    method: 'POST',
    token: session.token,
    body: {
      channel: 'inquiry',
      systemPrompt: '짧고 공손하게 답글만 작성하세요. 감사합니다 정도로 마무리합니다.',
      row: { content: '배송은 언제 출발하나요', product: '테스트상품' },
    },
  });
  assert.equal(res.status, 502);
  assert.equal(res.data.code, 'EMPTY_REPLY');
  assert.equal(getUsageSummary(session.user.id, 'none', undefined, false).replyUsed, 0);
});

test('정상 답변은 요청마다 정확히 1건만 차감한다', async () => {
  const session = await createSession();
  const first = await request('/api/generate-reply', { method: 'POST', token: session.token, body: replyBody });
  const second = await request('/api/generate-reply', { method: 'POST', token: session.token, body: replyBody });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.data.usage.replyUsed, 1);
  assert.equal(second.data.usage.replyUsed, 2);
  assert.ok(String(first.data.text).trim().length > 0);
  assert.equal(getUsageSummary(session.user.id, 'none', undefined, false).replyUsed, 2);
});

test('무료 체험 한도에 도달하면 429 USAGE_LIMIT이다', async () => {
  const session = await createSession();
  for (let i = 0; i < 10; i += 1) {
    recordUsage(session.user.id, 'reply', 'review', undefined, false);
  }
  const res = await request('/api/generate-reply', { method: 'POST', token: session.token, body: replyBody });
  assert.equal(res.status, 429);
  assert.equal(res.data.code, 'USAGE_LIMIT');
  assert.equal(res.data.usage.replyUsed, 10);
});

test('같은 계정 동시 요청은 체험 한도 10건을 넘기지 않는다', async () => {
  const session = await createSession();
  setGeminiFetchForTests(async () => {
    await new Promise((r) => setTimeout(r, 30));
    return fakeOk();
  });
  const results = await Promise.all(
    Array.from({ length: 15 }, () =>
      request('/api/generate-reply', { method: 'POST', token: session.token, body: replyBody })
    )
  );
  const ok = results.filter((r) => r.status === 200);
  const limited = results.filter((r) => r.status === 429);
  assert.equal(ok.length, 10);
  assert.equal(limited.length, 5);
  const usage = getUsageSummary(session.user.id, 'none', undefined, false);
  assert.equal(usage.replyUsed, 10);
});

test('다른 계정 동시 요청은 서로 막지 않는다', async () => {
  const a = await createSession();
  const b = await createSession();
  const [ra, rb] = await Promise.all([
    request('/api/generate-reply', { method: 'POST', token: a.token, body: replyBody }),
    request('/api/generate-reply', { method: 'POST', token: b.token, body: replyBody }),
  ]);
  assert.equal(ra.status, 200);
  assert.equal(rb.status, 200);
  assert.equal(getUsageSummary(a.user.id, 'none', undefined, false).replyUsed, 1);
  assert.equal(getUsageSummary(b.user.id, 'none', undefined, false).replyUsed, 1);
});

test('유료 플랜 한도도 동시에 넘기지 않는다', async () => {
  const session = await createSession({ planId: 'basic', subscribe: true });
  for (let i = 0; i < 149; i += 1) {
    recordUsage(session.user.id, 'reply', 'review', undefined, true);
  }
  setGeminiFetchForTests(async () => {
    await new Promise((r) => setTimeout(r, 20));
    return fakeOk();
  });
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      request('/api/generate-reply', { method: 'POST', token: session.token, body: replyBody })
    )
  );
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.equal(results.filter((r) => r.status === 429).length, 4);
  assert.equal(getUsageSummary(session.user.id, 'basic', undefined, true).replyUsed, 150);
});

test('대기열 초과 시 503으로 거절한다', async () => {
  configureGeminiQueue({ maxConcurrent: 1, maxQueued: 1, queueWaitMs: 2000 });
  setGeminiFetchForTests(async () => {
    await new Promise((r) => setTimeout(r, 120));
    return fakeOk();
  });
  const a = await createSession();
  const b = await createSession();
  const c = await createSession();
  const results = await Promise.all([
    request('/api/generate-reply', { method: 'POST', token: a.token, body: replyBody }),
    request('/api/generate-reply', { method: 'POST', token: b.token, body: replyBody }),
    request('/api/generate-reply', { method: 'POST', token: c.token, body: replyBody }),
  ]);
  const busy = results.filter((r) => r.status === 503);
  const ok = results.filter((r) => r.status === 200);
  assert.ok(busy.length >= 1);
  assert.ok(ok.length >= 1);
  assert.equal(busy[0].data.retryable, true);
});

test('Gemini 429는 사용량 한도가 아니라 재시도 가능한 503이다', async () => {
  const session = await createSession();
  setGeminiFetchForTests(async () => fakeStatus(429));
  const res = await request('/api/generate-reply', { method: 'POST', token: session.token, body: replyBody });
  assert.equal(res.status, 503);
  assert.notEqual(res.data.code, 'USAGE_LIMIT');
  assert.equal(res.data.retryable, true);
  assert.equal(getUsageSummary(session.user.id, 'none', undefined, false).replyUsed, 0);
});

test('말투 분석은 성공 시에만 횟수가 오른다', async () => {
  const session = await createSession();
  setGeminiFetchForTests(async () =>
    fakeOk('짧고 공손한 문장으로 인사한 뒤 리뷰 내용에 맞춰 공감하고 감사로 마무리하세요. 이모지는 쓰지 않습니다.')
  );
  const samples = [
    '안녕하세요 고객님 첫 구매 감사드려요 배송 늦어서 죄송합니다.',
    '맛있게 드셨다니 기쁩니다 다음에도 좋은 상품으로 찾아뵙겠습니다.',
  ];
  const ok = await request('/api/analyze-tone', {
    method: 'POST',
    token: session.token,
    body: { context: 'review', samples },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.usage.toneUsed, 1);

  const again = await request('/api/analyze-tone', {
    method: 'POST',
    token: session.token,
    body: { context: 'review', samples },
  });
  assert.equal(again.status, 429);
  assert.equal(again.data.code, 'USAGE_LIMIT');
});

test('결제 설정 조회 응답이 깨지지 않는다', async () => {
  const session = await createSession();
  const res = await request('/api/billing/config', { token: session.token });
  assert.equal(res.status, 200);
  assert.equal(res.data.ok, true);
  assert.equal(typeof res.data.mockMode, 'boolean');
  assert.equal(res.data.singleClientKey, 'test_ck_single_store');
  assert.equal(res.data.billingClientKey, 'test_ck_billing_store');
  assert.equal(JSON.stringify(res.data).includes('test_sk_'), false);
});

test('카카오가 없으면 로그인 시작은 503이다', async () => {
  const res = await request('/api/auth/kakao/login');
  assert.equal(res.status, 503);
  assert.equal(res.data.ok, false);
});

test('신규 결제는 30일 구독 주기의 사용량을 연다', async () => {
  const session = await createSession();
  const paid = await mockSubscribe(session.user.id, 'basic', { legalConsent: true });
  const user = findUserById(session.user.id);
  const usage = getUsageSummary(user.id, user.plan_id, undefined, true);
  assert.equal(paid.alreadyPaid, false);
  assert.equal(user.usage_cycle, 1);
  assert.equal(usage.period, 'cycle:1');
  assert.equal(usage.periodLabel, '구독 기간');
  assert.equal(usage.replyLimit, 150);
  assert.equal(usage.replyUsed, 0);
  assert.equal(usage.toneLimit, 50);
  recordUsage(user.id, 'reply', 'review', undefined, true);
  const extended = activateUserSubscription(user.id, 'basic', 30, { autoRenew: true });
  assert.equal(extended.usage_cycle, 1);
  assert.equal(getUsageSummary(user.id, 'basic', undefined, true).replyUsed, 1);
  assert.equal(getUsageSummary(user.id, 'basic', undefined, true).period, 'cycle:1');
});

test('정기결제 성공 때만 다음 사용량 기간으로 넘어간다', async () => {
  const session = await createSession();
  await mockSubscribe(session.user.id, 'standard', { legalConsent: true });
  recordUsage(session.user.id, 'reply', 'review', undefined, true);
  recordUsage(session.user.id, 'reply', 'inquiry', undefined, true);
  const before = findUserById(session.user.id);
  const renewed = renewUserSubscriptionPeriod(session.user.id, 30);
  const next = getUsageSummary(session.user.id, renewed.plan_id, undefined, true);
  assert.equal(before.usage_cycle, 1);
  assert.equal(renewed.usage_cycle, 2);
  assert.equal(next.period, 'cycle:2');
  assert.equal(next.replyUsed, 0);
  assert.equal(next.replyLimit, 600);
  assert.equal(getUsageRow(session.user.id, 'cycle:1').reply_count, 2);
});

test('결제 실패와 재시도 중에는 사용량 기간이 유지된다', async () => {
  const session = await createSession();
  await mockSubscribe(session.user.id, 'basic', { legalConsent: true });
  recordUsage(session.user.id, 'reply', 'review', undefined, true);
  const before = findUserById(session.user.id);
  const failed = recordRenewalFailure(session.user.id, 3);
  const during = findUserById(session.user.id);
  assert.equal(failed.deactivated, false);
  assert.equal(during.subscription_expires_at, before.subscription_expires_at);
  assert.equal(during.usage_cycle, before.usage_cycle);
  assert.equal(getUsageSummary(session.user.id, 'basic', undefined, true).replyUsed, 1);
  assert.equal(getUsageSummary(session.user.id, 'basic', undefined, true).period, 'cycle:1');

  const renewed = renewUserSubscriptionPeriod(session.user.id, 30);
  assert.equal(renewed.usage_cycle, 2);
  assert.equal(getUsageSummary(session.user.id, 'basic', undefined, true).period, 'cycle:2');
  assert.equal(getUsageSummary(session.user.id, 'basic', undefined, true).replyUsed, 0);
  assert.equal(getUsageRow(session.user.id, 'cycle:1').reply_count, 1);
});

test('같은 결제 주문을 다시 확인해도 사용량 기간은 그대로다', async () => {
  const session = await createSession();
  const paid = await mockSubscribe(session.user.id, 'pro', { legalConsent: true });
  recordUsage(session.user.id, 'reply', 'review', undefined, true);
  const before = findUserById(session.user.id);
  const again = await mockConfirmBillingAuth(session.user.id, paid.order.order_id);
  const after = findUserById(session.user.id);
  assert.equal(again.alreadyPaid, true);
  assert.equal(after.subscription_expires_at, before.subscription_expires_at);
  assert.equal(after.usage_cycle, before.usage_cycle);
  assert.equal(getUsageSummary(session.user.id, 'pro', undefined, true).replyUsed, 1);
  assert.equal(getUsageSummary(session.user.id, 'pro', undefined, true).replyLimit, 2000);
  assert.equal(getUsageSummary(session.user.id, 'pro', undefined, true).toneLimit, 300);
  assert.equal(getUsageSummary(session.user.id, 'pro', undefined, true).period, 'cycle:1');
});

test('만료 후 재가입은 새 사용량 기간을 연다', async () => {
  const session = await createSession();
  await mockSubscribe(session.user.id, 'basic', { legalConsent: true });
  recordUsage(session.user.id, 'reply', 'review', undefined, true);
  const first = findUserById(session.user.id);
  deactivateUserSubscription(session.user.id);
  assert.equal(getUsageSummary(session.user.id, 'none', undefined, false).period, 'lifetime');
  await mockSubscribe(session.user.id, 'basic', { legalConsent: true });
  const second = findUserById(session.user.id);
  const usage = getUsageSummary(session.user.id, 'basic', undefined, true);
  assert.equal(first.usage_cycle, 1);
  assert.equal(second.usage_cycle, 2);
  assert.equal(usage.period, 'cycle:2');
  assert.equal(usage.replyUsed, 0);
  assert.equal(getUsageRow(session.user.id, 'cycle:1').reply_count, 1);
});

test('구독 취소 후에도 만료 전까지 같은 사용량을 쓴다', async () => {
  const session = await createSession();
  await mockSubscribe(session.user.id, 'basic', { legalConsent: true });
  recordUsage(session.user.id, 'reply', 'review', undefined, true);
  const before = findUserById(session.user.id);
  cancelUserSubscriptionAtPeriodEnd(session.user.id);
  const cancelled = findUserById(session.user.id);
  assert.equal(cancelled.subscription_expires_at, before.subscription_expires_at);
  assert.equal(cancelled.usage_cycle, before.usage_cycle);
  assert.equal(cancelled.subscription_status, 'cancelled');
  const usage = getUsageSummary(session.user.id, cancelled.plan_id, undefined, true);
  assert.equal(usage.replyUsed, 1);
  assert.equal(usage.period, 'cycle:1');
  recordUsage(session.user.id, 'reply', 'inquiry', undefined, true);
  assert.equal(getUsageSummary(session.user.id, 'basic', undefined, true).replyUsed, 2);
});

test('업그레이드는 사용량을 유지하고 한도만 올린다', async () => {
  const session = await createSession();
  await mockSubscribe(session.user.id, 'basic', { legalConsent: true });
  recordUsage(session.user.id, 'reply', 'review', undefined, true);
  recordUsage(session.user.id, 'tone', 'review', undefined, true);
  const before = findUserById(session.user.id);
  const checkout = prepareCheckout(session.user.id, 'standard', { legalConsent: true });
  const upgraded = await mockConfirmCheckout(session.user.id, checkout.orderId);
  const after = findUserById(session.user.id);
  const usage = getUsageSummary(session.user.id, after.plan_id, undefined, true);
  assert.equal(upgraded.user.plan_id, 'standard');
  assert.equal(after.subscription_expires_at, before.subscription_expires_at);
  assert.equal(after.usage_cycle, before.usage_cycle);
  assert.equal(usage.replyUsed, 1);
  assert.equal(usage.toneUsed, 1);
  assert.equal(usage.replyLimit, 600);
  assert.equal(usage.toneLimit, 120);
  assert.equal(usage.period, 'cycle:1');
});

test('다운그레이드는 다음 정기결제 성공 때 낮은 한도의 새 기간으로 적용된다', async () => {
  const session = await createSession();
  await mockSubscribe(session.user.id, 'standard', { legalConsent: true });
  recordUsage(session.user.id, 'reply', 'review', undefined, true);
  const before = findUserById(session.user.id);
  scheduleDowngrade(session.user.id, 'basic');
  const pending = findUserById(session.user.id);
  const during = getUsageSummary(session.user.id, pending.plan_id, undefined, true);
  assert.equal(pending.plan_id, 'standard');
  assert.equal(pending.pending_plan_id, 'basic');
  assert.equal(pending.usage_cycle, before.usage_cycle);
  assert.equal(during.replyUsed, 1);
  assert.equal(during.replyLimit, 600);
  assert.equal(during.period, 'cycle:1');

  const renewed = renewUserSubscriptionPeriod(session.user.id, 30);
  const next = getUsageSummary(session.user.id, renewed.plan_id, undefined, true);
  assert.equal(renewed.plan_id, 'basic');
  assert.equal(renewed.usage_cycle, 2);
  assert.equal(next.replyUsed, 0);
  assert.equal(next.replyLimit, 150);
  assert.equal(next.toneLimit, 50);
  assert.equal(next.period, 'cycle:2');
});

test('무료 체험 사용량은 구독 후에도 lifetime에 남는다', async () => {
  const session = await createSession();
  recordUsage(session.user.id, 'reply', 'review', undefined, false);
  recordUsage(session.user.id, 'reply', 'inquiry', undefined, false);
  recordUsage(session.user.id, 'tone', 'review', undefined, false);
  await mockSubscribe(session.user.id, 'basic', { legalConsent: true });
  const trial = getUsageSummary(session.user.id, 'none', undefined, false);
  const paid = getUsageSummary(session.user.id, 'basic', undefined, true);
  assert.equal(trial.period, 'lifetime');
  assert.equal(trial.replyUsed, 2);
  assert.equal(trial.toneUsed, 1);
  assert.equal(trial.replyLimit, 10);
  assert.equal(paid.replyUsed, 0);
  assert.equal(paid.replyLimit, 150);
  assert.notEqual(paid.period, 'lifetime');
});

test('같은 결제 주문으로 활성화나 갱신을 두 번 해도 주기는 한 번만 증가한다', async () => {
  const session = await createSession();
  const firstOrder = makeOrder(session.user.id, 'basic');
  const once = activateUserSubscription(session.user.id, 'basic', 30, {
    billingOrderId: firstOrder.id,
    paymentKey: 'pay_once',
    billingKey: 'bill_once',
    autoRenew: true,
  });
  const twice = activateUserSubscription(session.user.id, 'basic', 30, {
    billingOrderId: firstOrder.id,
    paymentKey: 'pay_once',
    billingKey: 'bill_once',
    autoRenew: true,
  });
  assert.equal(once.usage_cycle, 1);
  assert.equal(twice.usage_cycle, 1);
  assert.equal(twice.subscription_expires_at, once.subscription_expires_at);
  assert.equal(Number(findBillingOrder(firstOrder.id).usage_applied), 1);

  const renewalOrder = makeOrder(session.user.id, 'basic');
  const renewed = renewUserSubscriptionPeriod(session.user.id, 30, {
    billingOrderId: renewalOrder.id,
    paymentKey: 'pay_renew',
  });
  const renewedAgain = renewUserSubscriptionPeriod(session.user.id, 30, {
    billingOrderId: renewalOrder.id,
    paymentKey: 'pay_renew',
  });
  assert.equal(renewed.usage_cycle, 2);
  assert.equal(renewedAgain.usage_cycle, 2);
  assert.equal(renewedAgain.subscription_expires_at, renewed.subscription_expires_at);
  assert.equal(findBillingOrder(renewalOrder.id).status, 'paid');
});

test('같은 결제 웹훅이 동시에 두 번 들어와도 주기는 한 번만 증가한다', async () => {
  const session = await createSession();
  const customerKey = getOrCreateCustomerKey(session.user.id);
  const order = createBillingOrder({
    userId: session.user.id,
    orderId: `ord_parallel_${session.user.id}`,
    planId: 'basic',
    amount: 9900,
    orderName: '테스트 결제',
    customerKey,
    orderKind: 'subscribe',
    legalConsentAt: new Date().toISOString(),
  });
  const payload = {
    userId: session.user.id,
    authKey: `mock_auth_${order.order_id}`,
    customerKey,
    orderId: order.order_id,
  };
  const [left, right] = await Promise.all([confirmOrderInWorker(payload), confirmOrderInWorker(payload)]);
  assert.equal(left.ok, true, left.error);
  assert.equal(right.ok, true, right.error);
  const user = findUserById(session.user.id);
  const saved = findBillingOrder(order.id);
  assert.equal(Number(user.usage_cycle), 1);
  assert.equal(saved.status, 'paid');
  assert.equal(Number(saved.usage_applied), 1);
  assert.equal(left.expiresAt, user.subscription_expires_at);
  assert.equal(right.expiresAt, user.subscription_expires_at);
});

test('서로 다른 결제 두 건은 각각 한 번씩 주기를 증가시킨다', async () => {
  const session = await createSession();
  const firstOrder = makeOrder(session.user.id, 'standard');
  const secondOrder = makeOrder(session.user.id, 'standard');
  const first = activateUserSubscription(session.user.id, 'standard', 30, {
    billingOrderId: firstOrder.id,
    paymentKey: 'pay_a',
    autoRenew: true,
  });
  const second = renewUserSubscriptionPeriod(session.user.id, 30, {
    billingOrderId: secondOrder.id,
    paymentKey: 'pay_b',
  });
  activateUserSubscription(session.user.id, 'standard', 30, {
    billingOrderId: firstOrder.id,
    paymentKey: 'pay_a',
    autoRenew: true,
  });
  renewUserSubscriptionPeriod(session.user.id, 30, {
    billingOrderId: secondOrder.id,
    paymentKey: 'pay_b',
  });
  const user = findUserById(session.user.id);
  assert.equal(first.usage_cycle, 1);
  assert.equal(second.usage_cycle, 2);
  assert.equal(user.usage_cycle, 2);
  assert.equal(user.subscription_expires_at, second.subscription_expires_at);
  assert.equal(getUsageSummary(session.user.id, 'standard', undefined, true).replyLimit, 600);
});

test('결제 반영 중 오류가 나면 주기 증가와 결제 완료가 함께 롤백된다', async () => {
  const session = await createSession();
  const order = makeOrder(session.user.id, 'basic');
  setSubscriptionFaultForTests(() => {
    throw new Error('db fail');
  });
  assert.throws(
    () =>
      activateUserSubscription(session.user.id, 'basic', 30, {
        billingOrderId: order.id,
        paymentKey: 'pay_fail',
        billingKey: 'bill_fail',
        autoRenew: true,
      }),
    /db fail/
  );
  const rolledBack = findUserById(session.user.id);
  const saved = findBillingOrder(order.id);
  assert.equal(Number(rolledBack.usage_cycle || 0), 0);
  assert.notEqual(rolledBack.subscription_status, 'active');
  assert.equal(saved.status, 'pending');
  assert.equal(Number(saved.usage_applied), 0);

  setSubscriptionFaultForTests(null);
  const paid = activateUserSubscription(session.user.id, 'basic', 30, {
    billingOrderId: order.id,
    paymentKey: 'pay_fail',
    billingKey: 'bill_fail',
    autoRenew: true,
  });
  assert.equal(paid.usage_cycle, 1);
  assert.equal(findBillingOrder(order.id).status, 'paid');
  assert.equal(Number(findBillingOrder(order.id).usage_applied), 1);
});

test('사용 기록 저장이 실패하면 사용량 차감도 롤백된다', async () => {
  const session = await createSession();
  recordUsage(session.user.id, 'reply', 'review', undefined, false);
  assert.equal(getUsageSummary(session.user.id, 'none', undefined, false).replyUsed, 1);
  assert.equal(usageLogCount(session.user.id), 1);

  setUsageLogFaultForTests(() => {
    throw new Error('log failed');
  });
  assert.throws(() => recordUsage(session.user.id, 'reply', 'inquiry', undefined, false), /log failed/);
  assert.equal(getUsageSummary(session.user.id, 'none', undefined, false).replyUsed, 1);
  assert.equal(usageLogCount(session.user.id), 1);

  setUsageLogFaultForTests(null);
  recordUsage(session.user.id, 'reply', 'inquiry', undefined, false);
  assert.equal(getUsageSummary(session.user.id, 'none', undefined, false).replyUsed, 2);
  assert.equal(getUsageSummary(session.user.id, 'none', undefined, false).replyLimit, 10);
  assert.equal(usageLogCount(session.user.id), 2);
});

test('무료 체험과 유료 사용량은 동시에 각자 집계된다', async () => {
  const trial = await createSession();
  const paid = await createSession({ planId: 'basic', subscribe: true });
  setGeminiFetchForTests(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return fakeOk();
  });
  const [trialRes, paidRes] = await Promise.all([
    request('/api/generate-reply', { method: 'POST', token: trial.token, body: replyBody }),
    request('/api/generate-reply', { method: 'POST', token: paid.token, body: replyBody }),
  ]);
  assert.equal(trialRes.status, 200);
  assert.equal(paidRes.status, 200);
  assert.equal(getUsageSummary(trial.user.id, 'none', undefined, false).replyUsed, 1);
  assert.equal(getUsageSummary(trial.user.id, 'none', undefined, false).period, 'lifetime');
  assert.equal(getUsageSummary(trial.user.id, 'none', undefined, false).replyLimit, 10);
  assert.equal(getUsageSummary(paid.user.id, 'basic', undefined, true).replyUsed, 1);
  assert.equal(getUsageSummary(paid.user.id, 'basic', undefined, true).period, 'cycle:1');
  assert.equal(getUsageSummary(paid.user.id, 'basic', undefined, true).replyLimit, 150);
});

test('사용량 한도 직전 동시 요청은 한 건만 남긴다', async () => {
  const session = await createSession();
  for (let i = 0; i < 9; i += 1) {
    recordUsage(session.user.id, 'reply', 'review', undefined, false);
  }
  setGeminiFetchForTests(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    return fakeOk();
  });
  const results = await Promise.all([
    request('/api/generate-reply', { method: 'POST', token: session.token, body: replyBody }),
    request('/api/generate-reply', { method: 'POST', token: session.token, body: replyBody }),
  ]);
  const ok = results.filter((result) => result.status === 200);
  const limited = results.filter((result) => result.status === 429);
  assert.equal(ok.length, 1);
  assert.equal(limited.length, 1);
  assert.equal(getUsageSummary(session.user.id, 'none', undefined, false).replyUsed, 10);
  assert.equal(getUsageSummary(session.user.id, 'none', undefined, false).replyLimit, 10);
});

async function subscribedRenewalOrder() {
  const session = await createSession();
  await mockSubscribe(session.user.id, 'basic', { legalConsent: true });
  const user = findUserById(session.user.id);
  const order = makeOrder(user.id, 'basic', 'renewal');
  return { session, user, order };
}

test('승인 성공 후 DB 저장이 실패하면 재조회로 한 번만 복구한다', async () => {
  const { user, order } = await subscribedRenewalOrder();
  setTossTransportForTests(async () => ({ ok: true, status: 200, data: tossDone(order) }));
  setSubscriptionFaultForTests(() => {
    throw new Error('db fail');
  });
  await chargeAndApplyRenewal(user, order);
  assert.equal(findUserById(user.id).usage_cycle, 1);
  assert.equal(findBillingOrder(order.id).status, 'unknown');
  assert.equal(Number(findBillingOrder(order.id).usage_applied), 0);

  setSubscriptionFaultForTests(null);
  const recovered = await recoverBillingOrder(order.id);
  const again = await recoverBillingOrder(order.id);
  assert.equal(recovered.action, 'applied');
  assert.equal(again.action, 'already');
  assert.equal(findUserById(user.id).usage_cycle, 2);
  assert.equal(Number(findBillingOrder(order.id).usage_applied), 1);
});

test('승인 요청이 타임아웃돼도 조회 결과가 DONE이면 복구한다', async () => {
  const { user, order } = await subscribedRenewalOrder();
  const calls = [];
  setTossTransportForTests(async (req) => {
    calls.push(req.url);
    if (String(req.url).includes('/v1/billing/')) {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    }
    return { ok: true, status: 200, data: tossDone(order) };
  });
  await chargeAndApplyRenewal(user, order);
  assert.equal(findBillingOrder(order.id).status, 'unknown');
  assert.equal(findUserById(user.id).usage_cycle, 1);
  const beforeGets = calls.filter((url) => url.includes('/v1/payments/orders/')).length;
  const recovered = await recoverBillingOrder(order.id);
  assert.equal(recovered.action, 'applied');
  assert.equal(findUserById(user.id).usage_cycle, 2);
  assert.equal(calls.filter((url) => url.includes('/v1/billing/')).length, 1);
  assert.ok(calls.filter((url) => url.includes('/v1/payments/orders/')).length > beforeGets);
});

test('재조회 결과가 DONE이면 구독을 복구한다', async () => {
  const { user, order } = await subscribedRenewalOrder();
  setTossTransportForTests(async () => ({ ok: true, status: 200, data: tossDone(order) }));
  const recovered = await recoverBillingOrder(order.id);
  assert.equal(recovered.action, 'applied');
  assert.equal(findUserById(user.id).usage_cycle, 2);
  assert.equal(getUsageSummary(user.id, 'basic', undefined, true).replyLimit, 150);
});

test('재조회 결과가 CANCELED이면 실패로 남기고 주기를 올리지 않는다', async () => {
  const { user, order } = await subscribedRenewalOrder();
  setTossTransportForTests(async () => ({
    ok: true,
    status: 200,
    data: tossDone(order, { status: 'CANCELED' }),
  }));
  const recovered = await recoverBillingOrder(order.id);
  assert.equal(recovered.action, 'failed');
  assert.equal(findBillingOrder(order.id).status, 'failed');
  assert.equal(findUserById(user.id).usage_cycle, 1);
});

test('결제 조회 결과가 없으면 실패로 단정하지 않는다', async () => {
  const { user, order } = await subscribedRenewalOrder();
  setTossTransportForTests(async () => ({
    ok: false,
    status: 404,
    data: { code: 'NOT_FOUND_PAYMENT', message: '없음' },
  }));
  const recovered = await recoverBillingOrder(order.id);
  assert.equal(recovered.action, 'unknown');
  assert.equal(findBillingOrder(order.id).status, 'unknown');
  assert.equal(findUserById(user.id).usage_cycle, 1);
});

test('결제 조회 API 5xx는 미확정으로 남긴다', async () => {
  const { user, order } = await subscribedRenewalOrder();
  setTossTransportForTests(async () => ({ ok: false, status: 503, data: { code: 'PROVIDER_ERROR', message: '일시 오류' } }));
  const recovered = await recoverBillingOrder(order.id);
  assert.equal(recovered.action, 'unknown');
  assert.equal(findBillingOrder(order.id).failure_reason, 'PROVIDER_ERROR');
  assert.equal(findUserById(user.id).usage_cycle, 1);
});

test('금액이 다른 결제는 구독에 반영하지 않는다', async () => {
  const { user, order } = await subscribedRenewalOrder();
  setTossTransportForTests(async () => ({ ok: true, status: 200, data: tossDone(order, { totalAmount: 1 }) }));
  const recovered = await recoverBillingOrder(order.id);
  assert.equal(recovered.action, 'mismatch');
  assert.equal(findBillingOrder(order.id).status, 'manual_review');
  assert.equal(findUserById(user.id).usage_cycle, 1);
});

test('orderId가 다른 결제는 구독에 반영하지 않는다', async () => {
  const { user, order } = await subscribedRenewalOrder();
  setTossTransportForTests(async () => ({ ok: true, status: 200, data: tossDone(order, { orderId: 'someone_else' }) }));
  const recovered = await recoverBillingOrder(order.id);
  assert.equal(recovered.action, 'mismatch');
  assert.equal(findUserById(user.id).usage_cycle, 1);
});

test('같은 주문 재시도는 같은 멱등키를 쓰고 다른 금액은 거절한다', async () => {
  const { user, order } = await subscribedRenewalOrder();
  const keys = [];
  setTossTransportForTests(async (req) => {
    keys.push(req.headers['Idempotency-Key']);
    return { ok: true, status: 200, data: tossDone(order) };
  });
  await chargeWithBillingKey({
    billingKey: 'bill_live',
    customerKey: order.customer_key,
    amount: order.amount,
    orderId: order.order_id,
    orderName: order.order_name,
  });
  await chargeWithBillingKey({
    billingKey: 'bill_live',
    customerKey: order.customer_key,
    amount: order.amount,
    orderId: order.order_id,
    orderName: order.order_name,
  });
  assert.equal(keys.length, 2);
  assert.equal(keys[0], order.idempotency_key);
  assert.equal(keys[1], order.idempotency_key);
  await assert.rejects(
    () => chargeWithBillingKey({
      billingKey: 'bill_live',
      customerKey: order.customer_key,
      amount: order.amount + 100,
      orderId: order.order_id,
      orderName: order.order_name,
    }),
    /결제 정보/
  );
  assert.equal(keys.length, 2);
});

test('같은 복구 작업을 동시에 실행해도 주기는 한 번만 증가한다', async () => {
  const { user, order } = await subscribedRenewalOrder();
  setTossTransportForTests(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { ok: true, status: 200, data: tossDone(order) };
  });
  const [left, right] = await Promise.all([recoverBillingOrder(order.id), recoverBillingOrder(order.id)]);
  const actions = [left.action, right.action].sort();
  assert.deepEqual(actions, ['applied', 'busy']);
  assert.equal(findUserById(user.id).usage_cycle, 2);
  assert.equal(Number(findBillingOrder(order.id).usage_applied), 1);
});

test('복구 작업을 두 번 실행해도 주기는 한 번만 증가한다', async () => {
  const { user, order } = await subscribedRenewalOrder();
  setTossTransportForTests(async () => ({ ok: true, status: 200, data: tossDone(order) }));
  const first = await recoverBillingOrder(order.id);
  const second = await recoverBillingOrder(order.id);
  assert.equal(first.action, 'applied');
  assert.equal(second.action, 'already');
  assert.equal(findUserById(user.id).usage_cycle, 2);
});

test('15일이 지난 미확정 주문은 새 승인 요청 없이 수동 확인으로 남긴다', async () => {
  const { order } = await subscribedRenewalOrder();
  getDb()
    .prepare(`UPDATE billing_orders SET idempotency_sent_at = ? WHERE id = ?`)
    .run(new Date(Date.now() - 16 * 24 * 60 * 60 * 1000).toISOString(), order.id);
  let called = false;
  setTossTransportForTests(async () => {
    called = true;
    return { ok: true, status: 200, data: tossDone(order) };
  });
  const recovered = await recoverBillingOrder(order.id);
  assert.equal(recovered.action, 'manual');
  assert.equal(findBillingOrder(order.id).status, 'manual_review');
  assert.equal(called, false);
  assert.equal(classifyTossSecretKey('live_gsk'), 'live_gsk');
  assert.equal(classifyTossSecretKey('live_sk'), 'live_sk');
});

test('복구 반영 중 DB 오류가 나면 주기 증가가 롤백된다', async () => {
  const { user, order } = await subscribedRenewalOrder();
  setTossTransportForTests(async () => ({ ok: true, status: 200, data: tossDone(order) }));
  setSubscriptionFaultForTests(() => {
    throw new Error('db fail');
  });
  const recovered = await recoverBillingOrder(order.id);
  assert.equal(recovered.action, 'unknown');
  assert.equal(findUserById(user.id).usage_cycle, 1);
  assert.equal(Number(findBillingOrder(order.id).usage_applied), 0);
  assert.equal(findBillingOrder(order.id).status, 'unknown');
});

test('정상 정기결제는 usage_applied로 주기를 한 번만 올린다', async () => {
  const { user, order } = await subscribedRenewalOrder();
  const keys = [];
  setTossTransportForTests(async (req) => {
    keys.push(req.headers['Idempotency-Key']);
    return { ok: true, status: 200, data: tossDone(order) };
  });
  await chargeAndApplyRenewal(user, order);
  await chargeAndApplyRenewal(user, findBillingOrder(order.id));
  assert.equal(findUserById(user.id).usage_cycle, 2);
  assert.equal(Number(findBillingOrder(order.id).usage_applied), 1);
  assert.equal(keys.length, 1);
  assert.equal(keys[0], order.idempotency_key);
  assert.equal(getUsageSummary(user.id, 'basic', undefined, true).replyLimit, 150);
  assert.equal(getUsageSummary(user.id, 'basic', undefined, true).period, 'cycle:2');
});

test('토스에 닿지 않은 승인은 같은 멱등키로 재시도하면 성공한다', async () => {
  const { user, order } = await subscribedRenewalOrder();
  const keys = [];
  let posts = 0;
  setTossTransportForTests(async (req) => {
    if (String(req.url).includes('/v1/payments/orders/')) {
      return { ok: false, status: 404, data: { code: 'NOT_FOUND_PAYMENT', message: '없음' } };
    }
    posts += 1;
    keys.push(req.headers['Idempotency-Key']);
    if (posts === 1) throw new Error('socket hangup');
    return { ok: true, status: 200, data: tossDone(order) };
  });
  await chargeAndApplyRenewal(user, order);
  assert.equal(findBillingOrder(order.id).status, 'unknown');
  assert.ok(findBillingOrder(order.id).idempotency_sent_at);
  const recovered = await recoverBillingOrder(order.id);
  assert.equal(recovered.action, 'applied');
  assert.equal(posts, 2);
  assert.equal(keys[0], order.idempotency_key);
  assert.equal(keys[1], order.idempotency_key);
  assert.equal(findUserById(user.id).usage_cycle, 2);
});

test('응답이 유실된 성공 결제는 같은 키 재시도로 한 번만 반영된다', async () => {
  const { user, order } = await subscribedRenewalOrder();
  let chargeCreations = 0;
  const keys = [];
  setTossTransportForTests(async (req) => {
    if (String(req.url).includes('/v1/payments/orders/')) {
      return { ok: false, status: 404, data: { code: 'NOT_FOUND_PAYMENT', message: '없음' } };
    }
    keys.push(req.headers['Idempotency-Key']);
    if (chargeCreations === 0) {
      chargeCreations += 1;
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    }
    return { ok: true, status: 200, data: tossDone(order) };
  });
  await chargeAndApplyRenewal(user, order);
  const recovered = await recoverBillingOrder(order.id);
  const again = await recoverBillingOrder(order.id);
  assert.equal(recovered.action, 'applied');
  assert.equal(again.action, 'already');
  assert.equal(chargeCreations, 1);
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
  assert.equal(findUserById(user.id).usage_cycle, 2);
  assert.equal(Number(findBillingOrder(order.id).usage_applied), 1);
});

test('같은 멱등키 재시도로 결제가 두 번 만들어지지 않는다', async () => {
  const { user, order } = await subscribedRenewalOrder();
  const seen = new Set();
  let creations = 0;
  setTossTransportForTests(async (req) => {
    if (String(req.url).includes('/v1/payments/orders/')) {
      return { ok: false, status: 404, data: { code: 'NOT_FOUND_PAYMENT', message: '없음' } };
    }
    const key = req.headers['Idempotency-Key'];
    if (!seen.has(key)) {
      seen.add(key);
      creations += 1;
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    }
    return { ok: true, status: 200, data: tossDone(order) };
  });
  await chargeAndApplyRenewal(user, order);
  await recoverBillingOrder(order.id);
  await recoverBillingOrder(order.id);
  assert.equal(creations, 1);
  assert.equal(seen.size, 1);
  assert.equal(findUserById(user.id).usage_cycle, 2);
});

test('요청 본문이 달라지면 기존 멱등키 재시도를 거절한다', async () => {
  const { order } = await subscribedRenewalOrder();
  let posts = 0;
  setTossTransportForTests(async () => {
    posts += 1;
    return { ok: true, status: 200, data: tossDone(order) };
  });
  await chargeWithBillingKey({
    billingKey: 'bill_original',
    customerKey: order.customer_key,
    amount: order.amount,
    orderId: order.order_id,
    orderName: order.order_name,
  });
  await assert.rejects(
    () => chargeWithBillingKey({
      billingKey: 'bill_other',
      customerKey: order.customer_key,
      amount: order.amount,
      orderId: order.order_id,
      orderName: order.order_name,
    }),
    /결제 수단/
  );
  await assert.rejects(
    () => chargeWithBillingKey({
      billingKey: 'bill_original',
      customerKey: order.customer_key,
      amount: order.amount + 100,
      orderId: order.order_id,
      orderName: order.order_name,
    }),
    /결제 정보/
  );
  assert.equal(posts, 1);
  assert.equal(findBillingOrder(order.id).idempotency_key, order.idempotency_key);
});

test('15일 이내의 미확정 주문은 같은 요청으로 자동 복구된다', async () => {
  const { user, order } = await subscribedRenewalOrder();
  const sentAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  const createdAt = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
  getDb()
    .prepare(
      `UPDATE billing_orders
       SET status = 'unknown', idempotency_sent_at = ?, idempotency_created_at = ?, charge_billing_key = ?
       WHERE id = ?`
    )
    .run(sentAt, createdAt, 'bill_saved', order.id);
  let posts = 0;
  setTossTransportForTests(async (req) => {
    if (String(req.url).includes('/v1/payments/orders/')) {
      return { ok: false, status: 404, data: { code: 'NOT_FOUND_PAYMENT', message: '없음' } };
    }
    posts += 1;
    assert.equal(req.headers['Idempotency-Key'], order.idempotency_key);
    assert.equal(req.body.amount, order.amount);
    assert.equal(req.body.orderId, order.order_id);
    assert.equal(req.body.customerKey, order.customer_key);
    assert.equal(req.body.orderName, order.order_name);
    assert.equal(String(req.url).includes(encodeURIComponent('bill_saved')), true);
    return { ok: true, status: 200, data: tossDone(order) };
  });
  const recovered = await recoverBillingOrder(order.id);
  assert.equal(recovered.action, 'applied');
  assert.equal(posts, 1);
  assert.equal(findUserById(user.id).usage_cycle, 2);
});

test('멱등키를 보낸 지 15일이 지난 미확정 주문은 manual_review가 된다', async () => {
  const { user, order } = await subscribedRenewalOrder();
  getDb()
    .prepare(
      `UPDATE billing_orders
       SET status = 'unknown', idempotency_created_at = ?, idempotency_sent_at = ?
       WHERE id = ?`
    )
    .run(new Date().toISOString(), new Date(Date.now() - 16 * 24 * 60 * 60 * 1000).toISOString(), order.id);
  let called = false;
  setTossTransportForTests(async () => {
    called = true;
    return { ok: true, status: 200, data: tossDone(order) };
  });
  const recovered = await recoverBillingOrder(order.id);
  assert.equal(recovered.action, 'manual');
  assert.equal(findBillingOrder(order.id).status, 'manual_review');
  assert.equal(called, false);
  assert.equal(findUserById(user.id).usage_cycle, 1);
});

test('같은 미확정 복구를 동시에 여러 번 해도 승인과 주기는 한 번이다', async () => {
  const { user, order } = await subscribedRenewalOrder();
  getDb()
    .prepare(`UPDATE billing_orders SET status = 'unknown', charge_billing_key = ? WHERE id = ?`)
    .run('bill_saved', order.id);
  let posts = 0;
  setTossTransportForTests(async (req) => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (String(req.url).includes('/v1/payments/orders/')) {
      return { ok: false, status: 404, data: { code: 'NOT_FOUND_PAYMENT', message: '없음' } };
    }
    posts += 1;
    return { ok: true, status: 200, data: tossDone(order) };
  });
  const results = await Promise.all([
    recoverBillingOrder(order.id),
    recoverBillingOrder(order.id),
    recoverBillingOrder(order.id),
  ]);
  const applied = results.filter((result) => result.action === 'applied');
  const busy = results.filter((result) => result.action === 'busy');
  assert.equal(applied.length, 1);
  assert.equal(busy.length, 2);
  assert.equal(posts, 1);
  assert.equal(findUserById(user.id).usage_cycle, 2);
  assert.equal(Number(findBillingOrder(order.id).usage_applied), 1);
});

test('복구된 주문의 사용량 주기는 다시 증가하지 않는다', async () => {
  const { user, order } = await subscribedRenewalOrder();
  setTossTransportForTests(async (req) => {
    if (String(req.url).includes('/v1/payments/orders/')) {
      return { ok: false, status: 404, data: { code: 'NOT_FOUND_PAYMENT', message: '없음' } };
    }
    return { ok: true, status: 200, data: tossDone(order) };
  });
  const first = await recoverBillingOrder(order.id);
  const second = await recoverBillingOrder(order.id);
  await chargeAndApplyRenewal(findUserById(user.id), findBillingOrder(order.id));
  assert.equal(first.action, 'applied');
  assert.equal(second.action, 'already');
  assert.equal(findUserById(user.id).usage_cycle, 2);
  assert.equal(Number(findBillingOrder(order.id).usage_applied), 1);
});

function authSecret(headers = {}) {
  const raw = headers.Authorization || headers.authorization || '';
  return Buffer.from(String(raw).replace(/^Basic\s+/i, ''), 'base64').toString('utf8').replace(/:$/, '');
}

function singleDone(order) {
  return {
    paymentKey: `pay_single_${order.id || order.order_id}`,
    orderId: order.order_id || order.orderId,
    totalAmount: order.amount,
    status: 'DONE',
    type: 'NORMAL',
    mId: 'mid_single',
  };
}

test('단건 결제는 단건 MID와 키만 사용한다', async () => {
  const session = await createSession();
  const checkout = prepareReviewCheckout(session.user.id, {
    mode: 'onetime',
    planId: 'basic',
    legalConsent: true,
  });
  assert.equal(checkout.clientKey, 'test_ck_single_store');
  assert.equal(checkout.useBillingAuth, false);
  let secret = '';
  let billingCalls = 0;
  setTossTransportForTests(async (req) => {
    secret = authSecret(req.headers);
    if (String(req.url).includes('/v1/billing/')) billingCalls += 1;
    return { ok: true, status: 200, data: { ...singleDone(checkout), paymentKey: 'pay_single_real' } };
  });
  const result = await confirmCheckout(session.user.id, {
    paymentKey: 'pay_single_real',
    orderId: checkout.orderId,
    amount: checkout.amount,
  });
  assert.equal(secret, 'test_sk_single_store');
  assert.equal(billingCalls, 0);
  assert.equal(result.alreadyPaid, false);
  assert.equal(findUserById(session.user.id).subscription_status, 'active');
  assert.equal(findUserById(session.user.id).billing_key, null);
  assert.equal(findBillingOrder(result.order.id).payment_key, 'pay_single_real');
});

test('빌링키 발급과 정기결제는 빌링 키 세트만 사용한다', async () => {
  const session = await createSession();
  const basic = prepareCheckout(session.user.id, 'basic', { legalConsent: true });
  const standard = prepareCheckout((await createSession()).user.id, 'standard', { legalConsent: true });
  const pro = prepareCheckout((await createSession()).user.id, 'pro', { legalConsent: true });
  assert.equal(basic.amount, 9900);
  assert.equal(standard.amount, 19900);
  assert.equal(pro.amount, 39900);
  assert.equal(basic.clientKey, 'test_ck_billing_store');
  const secrets = [];
  setTossTransportForTests(async (req) => {
    secrets.push(authSecret(req.headers));
    if (String(req.url).includes('/authorizations/issue')) {
      return { ok: true, status: 200, data: { billingKey: 'bill_first', card: { cardCompany: '신한', cardNumber: '4242' } } };
    }
    return { ok: true, status: 200, data: tossDone({ id: 1, order_id: basic.orderId, amount: basic.amount }, { paymentKey: 'pay_first' }) };
  });
  const started = await confirmBillingAuthCheckout(session.user.id, {
    authKey: 'auth_live_first',
    customerKey: basic.customerKey,
    orderId: basic.orderId,
  });
  assert.equal(secrets.every((value) => value === 'test_sk_billing_store'), true);
  assert.equal(started.user.usage_cycle, 1);
  assert.equal(started.user.billing_key, 'bill_first');
  assert.equal(findBillingOrder(started.order.id).payment_key, 'pay_first');
  assert.notEqual(started.user.billing_key, findBillingOrder(started.order.id).payment_key);

  const renewal = makeOrder(started.user.id, 'basic', 'renewal');
  secrets.length = 0;
  setTossTransportForTests(async (req) => {
    secrets.push(authSecret(req.headers));
    return { ok: true, status: 200, data: tossDone(renewal) };
  });
  await chargeAndApplyRenewal(findUserById(session.user.id), renewal);
  assert.deepEqual(secrets, ['test_sk_billing_store']);
  assert.equal(findUserById(session.user.id).usage_cycle, 2);
});

test('단건 키와 빌링 키를 섞거나 MID가 다르면 구독을 시작하지 않는다', async () => {
  const session = await createSession();
  delete process.env.TOSS_BILLING_CLIENT_KEY;
  await assert.rejects(
    async () => prepareCheckout(session.user.id, 'basic', { legalConsent: true }),
    /TOSS_BILLING_CLIENT_KEY/
  );
  process.env.TOSS_BILLING_CLIENT_KEY = 'test_ck_billing_store';

  const checkout = prepareCheckout(session.user.id, 'basic', { legalConsent: true });
  let calls = 0;
  setTossTransportForTests(async (req) => {
    calls += 1;
    if (String(req.url).includes('/authorizations/issue')) {
      return { ok: true, status: 200, data: { billingKey: 'bill_wrong_mid' } };
    }
    return {
      ok: true,
      status: 200,
      data: tossDone({ id: 2, order_id: checkout.orderId, amount: checkout.amount }, { mId: 'mid_single', paymentKey: 'pay_wrong_mid' }),
    };
  });
  await assert.rejects(
    () => confirmBillingAuthCheckout(session.user.id, {
      authKey: 'auth_wrong_mid',
      customerKey: checkout.customerKey,
      orderId: checkout.orderId,
    }),
    /상점 정보/
  );
  assert.notEqual(findUserById(session.user.id).subscription_status, 'active');
  assert.equal(Number(findUserById(session.user.id).usage_cycle || 0), 0);
  assert.notEqual(findUserById(session.user.id).billing_key, 'bill_wrong_mid');

  const renewal = await subscribedRenewalOrder();
  delete process.env.TOSS_BILLING_SECRET_KEY;
  calls = 0;
  setTossTransportForTests(async () => {
    calls += 1;
    return { ok: true, status: 200, data: tossDone(renewal.order) };
  });
  await assert.rejects(
    () => chargeWithBillingKey({
      billingKey: renewal.user.billing_key,
      customerKey: renewal.order.customer_key,
      amount: renewal.order.amount,
      orderId: renewal.order.order_id,
      orderName: renewal.order.order_name,
    }),
    /TOSS_BILLING_SECRET_KEY/
  );
  assert.equal(calls, 0);
});

test('최초 빌링 승인 성공은 한 번만 결제하고 실패하면 구독을 시작하지 않는다', async () => {
  const failedSession = await createSession();
  const failedCheckout = prepareCheckout(failedSession.user.id, 'standard', { legalConsent: true });
  setTossTransportForTests(async (req) => {
    if (String(req.url).includes('/authorizations/issue')) {
      return { ok: true, status: 200, data: { billingKey: 'bill_declined' } };
    }
    return { ok: false, status: 400, data: { code: 'REJECT_CARD_PAYMENT', message: '거절' } };
  });
  await assert.rejects(
    () => confirmBillingAuthCheckout(failedSession.user.id, {
      authKey: 'auth_declined',
      customerKey: failedCheckout.customerKey,
      orderId: failedCheckout.orderId,
    }),
    /거절/
  );
  assert.equal(findUserById(failedSession.user.id).subscription_status, 'none');
  assert.equal(findUserById(failedSession.user.id).usage_cycle, 0);

  const session = await createSession();
  const checkout = prepareCheckout(session.user.id, 'pro', { legalConsent: true });
  let charges = 0;
  setTossTransportForTests(async (req) => {
    if (String(req.url).includes('/authorizations/issue')) {
      return { ok: true, status: 200, data: { billingKey: 'bill_pro' } };
    }
    charges += 1;
    assert.equal(req.body.amount, 39900);
    assert.equal(req.headers['Idempotency-Key'] || req.headers['idempotency-key'], findBillingOrderByOrder(checkout.orderId).idempotency_key);
    return { ok: true, status: 200, data: tossDone({ id: 3, order_id: checkout.orderId, amount: 39900 }, { paymentKey: 'pay_pro' }) };
  });
  const started = await confirmBillingAuthCheckout(session.user.id, {
    authKey: 'auth_pro',
    customerKey: checkout.customerKey,
    orderId: checkout.orderId,
  });
  const again = await confirmBillingAuthCheckout(session.user.id, {
    authKey: 'auth_pro_again',
    customerKey: checkout.customerKey,
    orderId: checkout.orderId,
  });
  assert.equal(charges, 1);
  assert.equal(again.alreadyPaid, true);
  assert.equal(started.user.usage_cycle, 1);
  assert.equal(findUserById(session.user.id).usage_cycle, 1);
  assert.equal(getUsageSummary(session.user.id, 'pro', undefined, true).period, 'cycle:1');
});

function findBillingOrderByOrder(orderId) {
  return getDb().prepare('SELECT * FROM billing_orders WHERE order_id = ?').get(orderId);
}

test('최초 승인 타임아웃은 같은 주문으로 복구되고 중복 청구되지 않는다', async () => {
  const session = await createSession();
  const checkout = prepareCheckout(session.user.id, 'basic', { legalConsent: true });
  const seen = new Set();
  let chargeAttempts = 0;
  setTossTransportForTests(async (req) => {
    if (String(req.url).includes('/authorizations/issue')) {
      return { ok: true, status: 200, data: { billingKey: 'bill_timeout' } };
    }
    if (String(req.url).includes('/v1/payments/orders/')) {
      return { ok: false, status: 404, data: { code: 'NOT_FOUND_PAYMENT', message: '없음' } };
    }
    chargeAttempts += 1;
    const key = req.headers['Idempotency-Key'];
    if (!seen.has(key)) {
      seen.add(key);
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    }
    return { ok: true, status: 200, data: tossDone({ id: 4, order_id: checkout.orderId, amount: checkout.amount }, { paymentKey: 'pay_timeout' }) };
  });
  await assert.rejects(
    () => confirmBillingAuthCheckout(session.user.id, {
      authKey: 'auth_timeout',
      customerKey: checkout.customerKey,
      orderId: checkout.orderId,
    }),
    /초과|확인하지 못했습니다/
  );
  assert.equal(findUserById(session.user.id).subscription_status, 'none');
  const order = findBillingOrderByOrder(checkout.orderId);
  assert.equal(order.status, 'unknown');
  assert.equal(order.charge_billing_key, 'bill_timeout');
  const againCheckout = prepareCheckout(session.user.id, 'basic', { legalConsent: true });
  assert.equal(againCheckout.orderId, checkout.orderId);
  const recovered = await recoverBillingOrder(order.id);
  const repeat = await recoverBillingOrder(order.id);
  assert.equal(recovered.action, 'applied');
  assert.equal(repeat.action, 'already');
  assert.equal(seen.size, 1);
  assert.equal(chargeAttempts, 2);
  assert.equal(findUserById(session.user.id).usage_cycle, 1);
  assert.equal(findUserById(session.user.id).billing_key, 'bill_timeout');
  assert.equal(findBillingOrder(order.id).payment_key, 'pay_timeout');
});

test('카드 변경은 빌링키만 다시 발급하고 청구하지 않는다', async () => {
  const session = await createSession();
  await mockSubscribe(session.user.id, 'basic', { legalConsent: true });
  const before = findUserById(session.user.id);
  let charges = 0;
  setTossTransportForTests(async (req) => {
    assert.equal(authSecret(req.headers), 'test_sk_billing_store');
    if (!String(req.url).includes('/authorizations/issue')) charges += 1;
    return { ok: true, status: 200, data: { billingKey: 'bill_replaced', card: { cardCompany: '삼성', cardNumber: '1111' } } };
  });
  const cardUpdate = prepareCardUpdate(session.user.id);
  assert.equal(cardUpdate.clientKey, 'test_ck_billing_store');
  await confirmCardUpdate(session.user.id, { authKey: 'auth_card_change', customerKey: cardUpdate.customerKey });
  const after = findUserById(session.user.id);
  assert.equal(charges, 0);
  assert.equal(after.billing_key, 'bill_replaced');
  assert.equal(after.usage_cycle, before.usage_cycle);
  assert.equal(after.subscription_expires_at, before.subscription_expires_at);
});

test('무료 체험은 결제 키 분리와 무관하게 유지된다', async () => {
  const session = await createSession();
  const usage = getUsageSummary(session.user.id, 'none', undefined, false);
  assert.equal(usage.replyLimit, 10);
  assert.equal(usage.toneLimit, 1);
  assert.equal(usage.period, 'lifetime');
  assert.equal(findUserById(session.user.id).billing_key, null);
});

test('환불은 원래 결제 유형의 시크릿 키를 사용한다', async () => {
  const session = await createSession();
  const single = makeOrder(session.user.id, 'basic', 'review_onetime');
  const billing = makeOrder(session.user.id, 'basic', 'renewal');
  getDb().prepare(`UPDATE billing_orders SET status = 'paid', payment_key = ? WHERE id = ?`).run('pay_single_refund', single.id);
  getDb().prepare(`UPDATE billing_orders SET status = 'paid', payment_key = ? WHERE id = ?`).run('pay_billing_refund', billing.id);
  const secrets = [];
  process.env.BILLING_MOCK = 'false';
  try {
    setTossTransportForTests(async (req) => {
      secrets.push(authSecret(req.headers));
      assert.equal(String(req.url).includes('/cancel'), true);
      return { ok: true, status: 200, data: { status: 'CANCELED' } };
    });
    await refundBillingOrder(single.id);
    await refundBillingOrder(billing.id);
    assert.deepEqual(secrets, ['test_sk_single_store', 'test_sk_billing_store']);
    assert.equal(findBillingOrder(single.id).status, 'refunded');
    assert.equal(findBillingOrder(billing.id).status, 'refunded');
  } finally {
    process.env.BILLING_MOCK = 'true';
  }
});

function futureExpiry(days = 20) {
  const next = new Date(Date.now() + days * 86400000);
  return next.toISOString().slice(0, 19).replace('T', ' ');
}

test('production에서는 DEV_API_SECRET으로 로그인과 사용량 한도를 우회할 수 없다', async () => {
  const secret = 'dev-secret-should-not-work';
  process.env.DEV_API_SECRET = secret;
  process.env.NODE_ENV = 'development';
  process.env.RAILWAY_ENVIRONMENT = 'production';
  const me = await request('/api/auth/me', { token: secret });
  const reply = await request('/api/generate-reply', { method: 'POST', token: secret, body: replyBody });
  const health = await request('/health');
  const body = JSON.stringify({ me: me.data, reply: reply.data, health: health.data });
  assert.equal(me.status, 401);
  assert.equal(reply.status, 401);
  assert.equal(body.includes(secret), false);

  delete process.env.RAILWAY_ENVIRONMENT;
  delete process.env.NODE_ENV;
  const unset = await request('/api/auth/me', { token: secret });
  assert.equal(unset.status, 401);

  process.env.NODE_ENV = 'production';
  const production = await request('/api/generate-reply', { method: 'POST', token: secret, body: replyBody });
  assert.equal(production.status, 401);
});

test('개발 환경의 DEV_API_SECRET은 일반 계정 한도를 풀지 않는다', async () => {
  process.env.NODE_ENV = 'development';
  process.env.DEV_API_SECRET = 'local-dev-secret';
  const session = await createSession();
  for (let i = 0; i < 10; i += 1) recordUsage(session.user.id, 'reply', 'review', undefined, false);
  const limited = await request('/api/generate-reply', { method: 'POST', token: session.token, body: replyBody });
  assert.equal(limited.status, 429);
  const dev = await request('/api/auth/me', { token: 'local-dev-secret' });
  assert.equal(dev.status, 200);
  assert.equal(dev.data.mode, 'dev');
  assert.equal(JSON.stringify(dev.data).includes('local-dev-secret'), false);
  const generated = await request('/api/generate-reply', { method: 'POST', token: 'local-dev-secret', body: replyBody });
  assert.equal(generated.status, 200);
  assert.equal(getUsageSummary(session.user.id, 'none', undefined, false).replyUsed, 10);
});

test('일반 로그인과 관리자 인증은 개발 비밀과 분리된다', async () => {
  process.env.NODE_ENV = 'production';
  process.env.DEV_API_SECRET = 'not-an-admin-secret';
  process.env.ADMIN_SECRET = 'admin-secret-value';
  const session = await createSession();
  const login = await request('/api/auth/login', {
    method: 'POST',
    body: { email: session.user.email, password: 'password1' },
  });
  assert.equal(login.status, 200);
  assert.ok(login.data.token);
  const me = await request('/api/auth/me', { token: login.data.token });
  assert.equal(me.status, 200);
  assert.equal(me.data.mode, 'user');
  const missing = await request('/api/admin/users');
  const wrong = await request('/api/admin/users', { headers: { 'x-admin-secret': 'not-an-admin-secret' } });
  assert.equal(missing.status, 403);
  assert.equal(wrong.status, 403);
});

test('관리자 비밀이 맞으면 사용자 목록을 조회할 수 있다', async () => {
  process.env.ADMIN_SECRET = 'admin-secret-value';
  const res = await request('/api/admin/users', { headers: { 'x-admin-secret': 'admin-secret-value' } });
  assert.equal(res.status, 200);
  assert.equal(res.data.ok, true);
  assert.equal(JSON.stringify(res.data).includes('admin-secret-value'), false);
});

function seedLegacyPaidUsage(replyCount, { withLogs = true } = {}) {
  const session = registerUser({ email: nextEmail(), password: 'password1', planId: 'none' });
  const userId = session.id;
  const expires = futureExpiry(12);
  getDb()
    .prepare(
      `UPDATE users
       SET plan_id = 'basic', subscription_status = 'active', subscription_expires_at = ?,
           usage_cycle = 0, usage_legacy_migrated = 0
       WHERE id = ?`
    )
    .run(expires, userId);
  const period = currentPeriod();
  getDb()
    .prepare(
      `INSERT INTO usage_monthly (user_id, period, reply_count, tone_count)
       VALUES (?, ?, ?, 0)`
    )
    .run(userId, period, replyCount);
  if (withLogs) {
    const createdAt = new Date(Date.now() - 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const insert = getDb().prepare(
      `INSERT INTO usage_logs (user_id, period, kind, channel, created_at) VALUES (?, ?, 'reply', 'review', ?)`
    );
    for (let i = 0; i < replyCount; i += 1) insert.run(userId, period, createdAt);
  }
  return userId;
}

test('기존 월별 사용량을 현재 구독 주기로 옮기고 다시 실행해도 늘지 않는다', () => {
  const userId = seedLegacyPaidUsage(40);
  migrateLegacySubscriptionUsage(getDb());
  migrateLegacySubscriptionUsage(getDb());
  const user = findUserById(userId);
  const cycle = getUsageRow(userId, 'cycle:1');
  assert.equal(user.usage_cycle, 1);
  assert.equal(user.usage_legacy_migrated, 1);
  assert.equal(cycle.reply_count, 40);
  assert.equal(getUsageSummary(userId, 'basic', undefined, true).replyUsed, 40);
  assert.equal(getUsageSummary(userId, 'basic', undefined, true).replyLimit, 150);
});

test('월별 집계와 사용 기록이 다르면 주기를 만들지 않고 검토 대상으로 남긴다', () => {
  const userId = seedLegacyPaidUsage(25, { withLogs: false });
  migrateLegacySubscriptionUsage(getDb());
  migrateLegacySubscriptionUsage(getDb());
  const user = findUserById(userId);
  assert.equal(user.usage_cycle, 0);
  assert.equal(user.usage_legacy_migrated, 1);
  assert.equal(user.usage_legacy_review, 1);
  assert.equal(getUsageRow(userId, 'cycle:1'), undefined);
  const usage = getUsageSummary(userId, 'basic', undefined, true);
  assert.equal(usage.replyUsed, 25);
  assert.equal(usage.replyLimit, 150);
  assert.equal(usage.period, currentPeriod());
});

function sqlTime(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

test('구독 기간 안의 답글 3건만 옮기고 이전 기간 6건은 제외한다', () => {
  const session = registerUser({ email: nextEmail(), password: 'password1', planId: 'none' });
  const userId = session.id;
  const now = new Date();
  const expires = new Date(now.getTime() + 20 * 86400000);
  const start = new Date(expires.getTime() - 30 * 86400000);
  const before = new Date(start.getTime() - 2 * 86400000);
  const inside = new Date(start.getTime() + 60 * 60 * 1000);
  getDb()
    .prepare(
      `UPDATE users
       SET plan_id = 'basic', subscription_status = 'active', subscription_expires_at = ?,
           usage_cycle = 0, usage_legacy_migrated = 0
       WHERE id = ?`
    )
    .run(sqlTime(expires), userId);
  getDb()
    .prepare(
      `INSERT INTO usage_monthly (user_id, period, reply_count, tone_count)
       VALUES (?, '2026-11', 9, 0)`
    )
    .run(userId);
  const insert = getDb().prepare(
    `INSERT INTO usage_logs (user_id, period, kind, channel, created_at) VALUES (?, '2026-11', 'reply', 'review', ?)`
  );
  for (let i = 0; i < 6; i += 1) insert.run(userId, sqlTime(before));
  for (let i = 0; i < 3; i += 1) insert.run(userId, sqlTime(inside));
  migrateLegacySubscriptionUsage(getDb());
  migrateLegacySubscriptionUsage(getDb());
  const user = findUserById(userId);
  assert.equal(user.usage_cycle, 1);
  assert.equal(user.usage_legacy_review, 0);
  assert.equal(getUsageRow(userId, 'cycle:1').reply_count, 3);
  assert.equal(getUsageRow(userId, 'cycle:1').tone_count, 0);
  assert.equal(getUsageRow(userId, '2026-11').reply_count, 9);
  assert.equal(getUsageSummary(userId, 'basic', undefined, true).replyUsed, 3);
});

test('사용량이 없는 유료 계정은 0건으로 주기를 연다', () => {
  const session = registerUser({ email: nextEmail(), password: 'password1', planId: 'none' });
  const userId = session.id;
  getDb()
    .prepare(
      `UPDATE users
       SET plan_id = 'basic', subscription_status = 'active', subscription_expires_at = ?,
           usage_cycle = 0, usage_legacy_migrated = 0
       WHERE id = ?`
    )
    .run(futureExpiry(20), userId);
  migrateLegacySubscriptionUsage(getDb());
  migrateLegacySubscriptionUsage(getDb());
  const user = findUserById(userId);
  assert.equal(user.usage_cycle, 1);
  assert.equal(user.usage_legacy_review, 0);
  const usage = getUsageSummary(userId, 'basic', undefined, true);
  assert.equal(usage.replyUsed, 0);
  assert.equal(usage.toneUsed, 0);
  assert.equal(usage.replyLimit, 150);
});

test('마이그레이션 오류가 나면 기존 사용량과 주기를 유지한다', () => {
  const userId = seedLegacyPaidUsage(15);
  setUsageMigrationFaultForTests(() => {
    throw new Error('migration failed');
  });
  assert.throws(() => migrateLegacySubscriptionUsage(getDb()), /migration failed/);
  setUsageMigrationFaultForTests(null);
  const user = findUserById(userId);
  assert.equal(user.usage_cycle, 0);
  assert.equal(user.usage_legacy_migrated, 0);
  assert.equal(getUsageRow(userId, currentPeriod()).reply_count, 15);
  assert.equal(getUsageRow(userId, 'cycle:1'), undefined);
});

test('사용량이 없는 신규 계정은 주기를 만들지 않는다', () => {
  const session = registerUser({ email: nextEmail(), password: 'password1', planId: 'none' });
  migrateLegacySubscriptionUsage(getDb());
  const user = findUserById(session.id);
  assert.equal(user.usage_cycle, 0);
  assert.equal(user.usage_legacy_migrated, 1);
  assert.equal(getUsageRow(session.id, 'cycle:1'), undefined);
  assert.equal(getUsageSummary(session.id, 'none', undefined, false).replyLimit, 10);
});
