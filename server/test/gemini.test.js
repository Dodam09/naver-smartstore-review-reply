import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  generateText,
  setGeminiFetchForTests,
  GeminiError,
  GeminiTimeoutError,
} from '../gemini.js';
import { configureGeminiQueue, resetGeminiQueueForTests } from '../gemini-queue.js';

process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key';
process.env.GEMINI_MAX_RETRIES = '2';
process.env.GEMINI_TIMEOUT_MS = '80';

function geminiJson(text) {
  return JSON.stringify({
    candidates: [{ content: { parts: [{ text }] } }],
  });
}

function fakeResponse({ status = 200, body = geminiJson('안녕하세요 고객님'), retryAfter = null } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        if (String(name).toLowerCase() === 'retry-after') return retryAfter;
        return null;
      },
    },
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
  };
}

afterEach(() => {
  process.env.GEMINI_MAX_RETRIES = '2';
  process.env.GEMINI_TIMEOUT_MS = '80';
  setGeminiFetchForTests(null);
  resetGeminiQueueForTests();
  configureGeminiQueue({ maxConcurrent: 5, maxQueued: 20, queueWaitMs: 15000 });
});

test('429는 Retry-After를 존중하고 재시도한 뒤 성공한다', async () => {
  let calls = 0;
  setGeminiFetchForTests(async () => {
    calls += 1;
    if (calls === 1) return fakeResponse({ status: 429, retryAfter: '0' });
    return fakeResponse({ status: 200 });
  });
  const text = await generateText('리뷰');
  assert.equal(text, '안녕하세요 고객님');
  assert.equal(calls, 2);
});

test('503은 재시도 후 성공한다', async () => {
  let calls = 0;
  setGeminiFetchForTests(async () => {
    calls += 1;
    if (calls < 3) return fakeResponse({ status: 503, retryAfter: '0' });
    return fakeResponse({ status: 200, body: geminiJson('재시도 성공') });
  });
  const text = await generateText('리뷰');
  assert.equal(text, '재시도 성공');
  assert.equal(calls, 3);
});

test('재시도 횟수를 넘긴 429는 사용자용 오류로 실패한다', async () => {
  let calls = 0;
  setGeminiFetchForTests(async () => {
    calls += 1;
    return fakeResponse({ status: 429, retryAfter: '0' });
  });
  await assert.rejects(() => generateText('리뷰'), (err) => {
    assert.equal(err instanceof GeminiError, true);
    assert.equal(err.retryable, true);
    assert.equal(err.status, 503);
    assert.match(err.message, /잠시 후/);
    return true;
  });
  assert.equal(calls, 3);
});

test('네트워크 오류는 재시도한다', async () => {
  let calls = 0;
  setGeminiFetchForTests(async () => {
    calls += 1;
    if (calls === 1) throw new TypeError('fetch failed');
    return fakeResponse({ status: 200, body: geminiJson('네트워크 복구') });
  });
  const text = await generateText('리뷰');
  assert.equal(text, '네트워크 복구');
  assert.equal(calls, 2);
});

test('빈 응답은 재시도 가능한 오류다', async () => {
  let calls = 0;
  setGeminiFetchForTests(async () => {
    calls += 1;
    return fakeResponse({ status: 200, body: JSON.stringify({ candidates: [] }) });
  });
  await assert.rejects(() => generateText('리뷰'), (err) => {
    assert.equal(err.code, 'GEMINI_EMPTY');
    assert.equal(err.retryable, true);
    return true;
  });
  assert.equal(calls, 3);
});

test('타임아웃 후 슬롯을 반환한다', async () => {
  setGeminiFetchForTests(async (_url, options) => {
    await new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
  });
  await assert.rejects(() => generateText('리뷰'), GeminiTimeoutError);
});

test('클라이언트 취소는 재시도하지 않는다', async () => {
  let calls = 0;
  const ac = new AbortController();
  setGeminiFetchForTests(async () => {
    calls += 1;
    ac.abort();
    const err = new Error('aborted');
    err.name = 'AbortError';
    throw err;
  });
  await assert.rejects(() => generateText('리뷰', { signal: ac.signal }), (err) => {
    assert.equal(err.name, 'AbortError');
    return true;
  });
  assert.equal(calls, 1);
});
