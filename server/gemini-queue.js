function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

let maxConcurrent = envInt('GEMINI_MAX_CONCURRENT', 5);
let maxQueued = envInt('GEMINI_MAX_QUEUED', 20);
let queueWaitMs = envInt('GEMINI_QUEUE_WAIT_MS', 15000);

let active = 0;
const waiters = [];

export class GeminiQueueFullError extends Error {
  constructor(message = '요청이 많아 잠시 후 다시 시도해 주세요.') {
    super(message);
    this.name = 'GeminiQueueFullError';
    this.status = 503;
    this.retryable = true;
    this.code = 'GEMINI_BUSY';
  }
}

export class GeminiTimeoutError extends Error {
  constructor(message = '답글 생성 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.') {
    super(message);
    this.name = 'GeminiTimeoutError';
    this.status = 504;
    this.retryable = true;
    this.code = 'GEMINI_TIMEOUT';
  }
}

function abortError(message = '요청이 취소되었습니다.') {
  const err = new Error(message);
  err.name = 'AbortError';
  err.status = 499;
  err.retryable = true;
  err.code = 'REQUEST_ABORTED';
  return err;
}

export function getGeminiQueueStats() {
  return {
    active,
    queued: waiters.length,
    maxConcurrent,
    maxQueued,
    queueWaitMs,
  };
}

export function configureGeminiQueue(options = {}) {
  if (options.maxConcurrent > 0) maxConcurrent = Math.floor(options.maxConcurrent);
  if (options.maxQueued > 0) maxQueued = Math.floor(options.maxQueued);
  if (options.queueWaitMs > 0) queueWaitMs = Math.floor(options.queueWaitMs);
}

export function resetGeminiQueueForTests() {
  for (const waiter of waiters) {
    waiter.reject(abortError('테스트 큐가 초기화되었습니다.'));
  }
  waiters.length = 0;
  active = 0;
}

function wakeNext() {
  while (waiters.length) {
    const waiter = waiters.shift();
    if (waiter.timer) clearTimeout(waiter.timer);
    if (waiter.signal) waiter.signal.removeEventListener('abort', waiter.onAbort);
    if (waiter.signal?.aborted) {
      waiter.reject(abortError());
      continue;
    }
    waiter.resolve();
    return true;
  }
  return false;
}

function acquireSlot(signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  if (active < maxConcurrent) {
    active += 1;
    return Promise.resolve();
  }
  if (waiters.length >= maxQueued) {
    return Promise.reject(new GeminiQueueFullError());
  }

  return new Promise((resolve, reject) => {
    const waiter = { resolve, reject, signal, timer: null, onAbort: null };
    waiter.onAbort = () => {
      const idx = waiters.indexOf(waiter);
      if (idx < 0) return;
      waiters.splice(idx, 1);
      if (waiter.timer) clearTimeout(waiter.timer);
      reject(abortError());
    };
    waiter.timer = setTimeout(() => {
      const idx = waiters.indexOf(waiter);
      if (idx < 0) return;
      waiters.splice(idx, 1);
      if (waiter.signal) waiter.signal.removeEventListener('abort', waiter.onAbort);
      reject(new GeminiTimeoutError('대기 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.'));
    }, queueWaitMs);
    if (signal) signal.addEventListener('abort', waiter.onAbort, { once: true });
    waiters.push(waiter);
  });
}

function releaseSlot() {
  if (wakeNext()) return;
  active = Math.max(0, active - 1);
}

export async function withGeminiSlot(fn, signal) {
  await acquireSlot(signal);
  try {
    return await fn();
  } finally {
    releaseSlot();
  }
}
