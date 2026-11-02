import {
  GeminiQueueFullError,
  GeminiTimeoutError,
  getGeminiQueueStats,
  withGeminiSlot,
} from './gemini-queue.js';

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

function timeoutMs() {
  return Math.max(50, Number(process.env.GEMINI_TIMEOUT_MS || 20000) || 20000);
}

function getMaxRetries() {
  const n = Number(process.env.GEMINI_MAX_RETRIES);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 2;
}

let fetchImpl = globalThis.fetch.bind(globalThis);

export { GeminiQueueFullError, GeminiTimeoutError, getGeminiQueueStats };

export class GeminiError extends Error {
  constructor(message, { status = 500, retryable = false, code = 'GEMINI_ERROR' } = {}) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
    this.retryable = retryable;
    this.code = code;
  }
}

export function setGeminiFetchForTests(fn) {
  fetchImpl = fn || globalThis.fetch.bind(globalThis);
}

function getApiKey() {
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (!key) throw new GeminiError('서버 GEMINI_API_KEY가 설정되지 않았습니다.', { status: 500 });
  return key;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error('요청이 취소되었습니다.');
      err.name = 'AbortError';
      reject(err);
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      const err = new Error('요청이 취소되었습니다.');
      err.name = 'AbortError';
      reject(err);
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

function parseRetryAfterMs(header) {
  if (!header) return null;
  const asNumber = Number(header);
  if (Number.isFinite(asNumber) && asNumber >= 0) return Math.min(asNumber * 1000, 30000);
  const asDate = Date.parse(header);
  if (Number.isFinite(asDate)) return Math.min(Math.max(0, asDate - Date.now()), 30000);
  return null;
}

function backoffMs(attempt, retryAfterMs) {
  if (retryAfterMs != null) return retryAfterMs;
  const base = Math.min(8000, 400 * 2 ** attempt);
  const jitter = Math.floor(Math.random() * 200);
  return base + jitter;
}

function userMessageForStatus(status) {
  if (status === 401 || status === 403) return 'AI 서비스 인증에 실패했습니다. 잠시 후 다시 시도해 주세요.';
  if (status === 404) return 'AI 모델을 찾을 수 없습니다. 잠시 후 다시 시도해 주세요.';
  if (status === 429) return '요청이 많아 잠시 후 다시 시도해 주세요.';
  if (status === 503 || status === 502 || status === 504) {
    return 'AI 서비스가 잠시 불안정합니다. 잠시 후 다시 시도해 주세요.';
  }
  return '답글 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.';
}

function isRetryableStatus(status) {
  return status === 429 || status === 503 || status === 502 || status === 504;
}

function wrapFetchError(err, signal) {
  if (signal?.aborted && err?.name === 'AbortError') {
    const abort = new Error('요청이 취소되었습니다.');
    abort.name = 'AbortError';
    abort.code = 'REQUEST_ABORTED';
    abort.retryable = false;
    return abort;
  }
  if (err instanceof GeminiTimeoutError || err instanceof GeminiQueueFullError || err instanceof GeminiError) {
    return err;
  }
  if (err?.name === 'AbortError') {
    return new GeminiTimeoutError();
  }
  return new GeminiError('네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.', {
    status: 503,
    retryable: true,
    code: 'GEMINI_NETWORK',
  });
}

function extractText(data) {
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text)
    .join('')
    .trim();
  if (!text) {
    throw new GeminiError('답글을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.', {
      status: 502,
      retryable: true,
      code: 'GEMINI_EMPTY',
    });
  }
  return text;
}

async function fetchOnce(url, body, signal) {
  return withGeminiSlot(async () => {
    const timeoutAc = new AbortController();
    const timer = setTimeout(() => timeoutAc.abort(), timeoutMs());
    const onClientAbort = () => timeoutAc.abort();
    if (signal) {
      if (signal.aborted) timeoutAc.abort();
      else signal.addEventListener('abort', onClientAbort, { once: true });
    }
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: timeoutAc.signal,
      });
      const raw = await response.text();
      return { response, raw };
    } catch (err) {
      if (signal?.aborted) throw wrapFetchError(err, signal);
      if (timeoutAc.signal.aborted && !signal?.aborted) throw new GeminiTimeoutError();
      throw wrapFetchError(err, signal);
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onClientAbort);
    }
  }, signal);
}

async function generateContent(body, { model, signal, maxRetries = getMaxRetries() } = {}) {
  const geminiModel = model || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${encodeURIComponent(getApiKey())}`;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (signal?.aborted) {
      const err = new Error('요청이 취소되었습니다.');
      err.name = 'AbortError';
      throw err;
    }
    try {
      const { response, raw } = await fetchOnce(url, body, signal);
      if (!response.ok) {
        const retryAfterMs = parseRetryAfterMs(response.headers?.get?.('retry-after'));
        const status = response.status;
        const retryable = isRetryableStatus(status);
        const err = new GeminiError(userMessageForStatus(status), {
          status: status === 429 ? 503 : status >= 400 && status < 600 ? status : 502,
          retryable,
          code: status === 429 ? 'GEMINI_RATE_LIMIT' : 'GEMINI_HTTP',
        });
        if (retryable && attempt < maxRetries) {
          lastError = err;
          await sleep(backoffMs(attempt, retryAfterMs), signal);
          continue;
        }
        throw err;
      }

      let data = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch (_) {
        const err = new GeminiError('답글을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.', {
          status: 502,
          retryable: true,
          code: 'GEMINI_EMPTY',
        });
        if (attempt < maxRetries) {
          lastError = err;
          await sleep(backoffMs(attempt, null), signal);
          continue;
        }
        throw err;
      }

      try {
        return extractText(data);
      } catch (err) {
        if (err?.retryable && attempt < maxRetries) {
          lastError = err;
          await sleep(backoffMs(attempt, null), signal);
          continue;
        }
        throw err;
      }
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      if (err instanceof GeminiQueueFullError) throw err;
      const retryable = err?.retryable === true || err instanceof GeminiTimeoutError;
      if (retryable && attempt < maxRetries) {
        lastError = err;
        await sleep(backoffMs(attempt, null), signal);
        continue;
      }
      throw err;
    }
  }

  throw lastError || new GeminiError('답글 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.');
}

export async function generateText(userText, { model, temperature = 0.7, signal } = {}) {
  return generateContent(
    {
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: { temperature },
    },
    { model, signal }
  );
}

export async function generateWithSystem(
  systemPrompt,
  userContent,
  { model, temperature = 0.7, googleSearch = false, signal } = {}
) {
  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userContent }] }],
    generationConfig: { temperature },
  };
  if (googleSearch) body.tools = [{ google_search: {} }];

  try {
    return await generateContent(body, { model, signal });
  } catch (err) {
    if (googleSearch && err?.name !== 'AbortError') {
      const fallbackBody = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userContent }] }],
        generationConfig: { temperature },
      };
      return generateContent(fallbackBody, { model, signal, maxRetries: 0 });
    }
    throw err;
  }
}
