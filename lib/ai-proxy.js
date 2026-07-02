/**
 * 서버 프록시 — Gemini 키는 서버에만 둡니다.
 * CONFIG.API_BASE_URL 이 설정되면 background.js 가 직접 Gemini 를 호출하지 않습니다.
 */
const AUTH_STORAGE_KEY = CONFIG.AUTH_STORAGE_KEY || 'smartstoreAuthSession';

function getProxyBaseUrl() {
  return String(CONFIG.API_BASE_URL || '')
    .trim()
    .replace(/\/$/, '');
}

function useAiProxy() {
  return !!getProxyBaseUrl();
}

function storageGetAsync(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(Array.isArray(keys) ? keys : [keys], resolve);
  });
}

function storageSetAsync(data) {
  return new Promise((resolve) => chrome.storage.local.set(data, resolve));
}

function storageRemoveAsync(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.remove(Array.isArray(keys) ? keys : [keys], resolve);
  });
}

async function loadAuthSession() {
  const data = await storageGetAsync(AUTH_STORAGE_KEY);
  const session = data[AUTH_STORAGE_KEY];
  if (!session?.token) return null;
  return session;
}

async function saveAuthSession(session) {
  await storageSetAsync({
    [AUTH_STORAGE_KEY]: {
      ...session,
      savedAt: Date.now(),
    },
  });
}

async function clearAuthSession() {
  await storageRemoveAsync(AUTH_STORAGE_KEY);
}

async function buildAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const session = await loadAuthSession();
  if (session?.token) {
    headers.Authorization = `Bearer ${session.token}`;
    return headers;
  }

  const secret = String(CONFIG.API_DEV_SECRET || '').trim();
  if (secret) headers.Authorization = `Bearer ${secret}`;
  return headers;
}

async function postAiApi(path, body, signal) {
  const base = getProxyBaseUrl();
  if (!base) throw new Error('API_BASE_URL이 설정되지 않았습니다.');

  const headers = await buildAuthHeaders();
  if (!headers.Authorization) {
    throw new Error('로그인이 필요합니다. [설정] 탭에서 계정으로 로그인해 주세요.');
  }

  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });

  let data = {};
  const raw = await response.text();
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (_) {
    data = {};
  }

  if (!response.ok || data.ok === false) {
    if (data.usage && sessionHasToken(await loadAuthSession())) {
      await mergeAuthUsage(data.usage);
    }
    throw new Error(data.error || `서버 오류 (${response.status})`);
  }

  if (data.usage && sessionHasToken(await loadAuthSession())) {
    await mergeAuthUsage(data.usage);
  }

  return data;
}

function sessionHasToken(session) {
  return !!session?.token;
}

async function mergeAuthUsage(usage) {
  const session = await loadAuthSession();
  if (!session?.token) return;
  await saveAuthSession({ ...session, usage });
}

async function fetchAuthApi(path, options = {}) {
  const base = getProxyBaseUrl();
  if (!base) throw new Error('API_BASE_URL이 설정되지 않았습니다.');

  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (options.auth !== false) {
    const authHeaders = await buildAuthHeaders();
    if (authHeaders.Authorization) {
      headers.Authorization = authHeaders.Authorization;
    }
  }

  const response = await fetch(`${base}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let data = {};
  const raw = await response.text();
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (_) {
    data = {};
  }

  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `서버 오류 (${response.status})`);
  }

  return data;
}

async function loginWithPassword(email, password) {
  const data = await fetchAuthApi('/api/auth/login', {
    method: 'POST',
    auth: false,
    body: { email, password },
  });

  await saveAuthSession({
    token: data.token,
    email: data.user?.email || email,
    planId: data.user?.planId,
    planName: data.user?.plan?.name || '',
    usage: data.usage || null,
    subscription: data.subscription || data.user?.subscription || null,
  });

  return data;
}

async function registerWithPassword(email, password) {
  await fetchAuthApi('/api/auth/register', {
    method: 'POST',
    auth: false,
    body: { email, password },
  });
  return loginWithPassword(email, password);
}

async function fetchServerHealth() {
  const base = getProxyBaseUrl();
  if (!base) return null;
  const response = await fetch(`${base}/health`);
  if (!response.ok) return null;
  return response.json();
}

async function logoutAccount() {
  try {
    await fetchAuthApi('/api/auth/logout', { method: 'POST' });
  } catch (_) {}
  await clearAuthSession();
}

async function refreshAccountUsage() {
  const session = await loadAuthSession();
  if (!session?.token) return null;
  const data = await fetchAuthApi('/api/auth/me');
  if (data.mode === 'dev') return { mode: 'dev' };
  await saveAuthSession({
    ...session,
    email: data.user?.email || session.email,
    planId: data.user?.planId || session.planId,
    planName: data.user?.plan?.name || session.planName,
    usage: data.usage || session.usage,
    subscription: data.subscription || data.user?.subscription || session.subscription,
  });
  return data;
}

async function openBillingPage(planId = 'standard') {
  const session = await loadAuthSession();
  if (!session?.token) {
    throw new Error('로그인 후 구독할 수 있습니다.');
  }
  const params = new URLSearchParams({
    plan: planId,
    token: session.token,
  });
  const url = `${getProxyBaseUrl()}/billing.html?${params.toString()}`;
  if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
    chrome.tabs.create({ url });
    return url;
  }
  window.open(url, '_blank', 'noopener');
  return url;
}

function formatSubscriptionSummary(subscription) {
  if (!subscription) return '';
  if (subscription.active) {
    return `구독 중 · 만료 ${subscription.expiresAt || '-'}`;
  }
  return '구독 필요 · [구독하기]에서 결제';
}

async function ensureAiCredentials(apiKey) {
  if (useAiProxy()) {
    const secret = String(CONFIG.API_DEV_SECRET || '').trim();
    if (secret) return;
    const session = await loadAuthSession();
    if (session?.token) return;
    throw new Error('로그인이 필요합니다. [설정] 탭에서 계정으로 로그인해 주세요.');
  }

  if (!hasDirectGeminiKey(apiKey)) {
    throw new Error('API 키가 없습니다. [설정] 탭에서 입력하거나 API_BASE_URL을 설정하세요.');
  }
}

function hasDirectGeminiKey(apiKey) {
  const key = String(apiKey || CONFIG.GEMINI_API_KEY || '').trim();
  return !!key && !key.includes('YOUR_GEMINI');
}

function hasAiCredentials(apiKey) {
  if (useAiProxy()) {
    const secret = String(CONFIG.API_DEV_SECRET || '').trim();
    if (secret) return true;
    return false;
  }
  return hasDirectGeminiKey(apiKey);
}

async function hasAiCredentialsAsync(apiKey) {
  if (useAiProxy()) {
    const secret = String(CONFIG.API_DEV_SECRET || '').trim();
    if (secret) return true;
    const session = await loadAuthSession();
    return !!session?.token;
  }
  return hasDirectGeminiKey(apiKey);
}

function formatUsageSummary(usage) {
  if (!usage) return '';
  return (
    `${usage.planName || usage.planId || '플랜'} · ` +
    `답글 ${usage.replyUsed}/${usage.replyLimit} · ` +
    `말투 ${usage.toneUsed}/${usage.toneLimit} (${usage.period || ''})`
  );
}
