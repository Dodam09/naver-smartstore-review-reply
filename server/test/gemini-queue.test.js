import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  configureGeminiQueue,
  getGeminiQueueStats,
  resetGeminiQueueForTests,
  withGeminiSlot,
  GeminiQueueFullError,
} from '../gemini-queue.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(() => {
  resetGeminiQueueForTests();
  configureGeminiQueue({ maxConcurrent: 5, maxQueued: 20, queueWaitMs: 15000 });
});

async function assertPeak(count, maxConcurrent) {
  configureGeminiQueue({ maxConcurrent, maxQueued: 40, queueWaitMs: 2000 });
  let current = 0;
  let peak = 0;
  const tasks = Array.from({ length: count }, () =>
    withGeminiSlot(async () => {
      current += 1;
      peak = Math.max(peak, current);
      await sleep(20);
      current -= 1;
    })
  );
  await Promise.all(tasks);
  assert.equal(peak, maxConcurrent);
  assert.equal(getGeminiQueueStats().active, 0);
}

test('동시 요청 5개는 상한 5를 넘지 않는다', async () => {
  await assertPeak(5, 5);
});

test('동시 요청 10개는 상한 5를 넘지 않는다', async () => {
  await assertPeak(10, 5);
});

test('동시 요청 20개는 상한 5를 넘지 않는다', async () => {
  await assertPeak(20, 5);
});

test('대기열이 가득 차면 거절한다', async () => {
  configureGeminiQueue({ maxConcurrent: 1, maxQueued: 1, queueWaitMs: 2000 });
  let release;
  const blocker = withGeminiSlot(() => new Promise((resolve) => { release = resolve; }));
  await sleep(20);
  const queued = withGeminiSlot(async () => 'ok');
  await sleep(20);
  await assert.rejects(() => withGeminiSlot(async () => 'no'), GeminiQueueFullError);
  release();
  assert.equal(await queued, 'ok');
  await blocker;
});

test('실행 중 오류가 나도 슬롯을 반환한다', async () => {
  configureGeminiQueue({ maxConcurrent: 1, maxQueued: 1, queueWaitMs: 2000 });
  await assert.rejects(
    () => withGeminiSlot(async () => { throw new Error('boom'); }),
    /boom/
  );
  assert.equal(getGeminiQueueStats().active, 0);
  const result = await withGeminiSlot(async () => 'next');
  assert.equal(result, 'next');
});
