import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
const { setUserSubscriptionActive } = await import('../db.js');
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

function request(pathname, { method = 'GET', token, body } = {}) {
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
  configureGeminiQueue({ maxConcurrent: 5, maxQueued: 20, queueWaitMs: 15000 });
  setGeminiFetchForTests(async () => fakeOk());
});

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
});

test('카카오가 없으면 로그인 시작은 503이다', async () => {
  const res = await request('/api/auth/kakao/login');
  assert.equal(res.status, 503);
  assert.equal(res.data.ok, false);
});
