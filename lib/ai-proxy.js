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

async function persistLoginResponse(data) {
  await saveAuthSession({
    token: data.token,
    email: data.user?.email || '',
    displayName: data.user?.displayName || null,
    authProvider: data.user?.authProvider || 'email',
    planId: data.user?.planId,
    planName: data.user?.plan?.name || '',
    usage: data.usage || null,
    subscription: data.subscription || data.user?.subscription || null,
  });
  return data;
}

async function completeLoginFromToken(token) {
  await saveAuthSession({ token });
  const data = await refreshAccountUsage();
  if (!data || data.mode === 'dev') {
    throw new Error('로그인 정보를 불러오지 못했습니다.');
  }
  return data;
}

const KAKAO_LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
let kakaoLoginPromise = null;

function startKakaoLoginFlow() {
  if (kakaoLoginPromise) return kakaoLoginPromise;

  const base = getProxyBaseUrl();
  if (!base) return Promise.reject(new Error('API_BASE_URL이 설정되지 않았습니다.'));

  kakaoLoginPromise = new Promise((resolve, reject) => {
    let tabId = null;
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('카카오 로그인 시간이 초과되었습니다.'));
    }, KAKAO_LOGIN_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      kakaoLoginPromise = null;
    }

    function onUpdated(updatedTabId, changeInfo, tab) {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete' || !tab?.url) return;
      if (!tab.url.includes('/kakao-success.html')) return;

      try {
        const parsed = new URL(tab.url);
        const error = parsed.searchParams.get('error');
        const token = parsed.searchParams.get('token');

        if (error) {
          cleanup();
          reject(new Error(decodeURIComponent(error)));
          return;
        }

        if (!token) return;

        cleanup();
        chrome.tabs.remove(updatedTabId).catch(() => {});
        completeLoginFromToken(token).then(resolve).catch((err) => {
          chrome.tabs.update(updatedTabId, {
            url: `${base}/kakao-success.html?error=${encodeURIComponent(err.message || '로그인에 실패했습니다.')}`,
          }).catch(() => {});
          reject(err);
        });
      } catch (err) {
        cleanup();
        reject(err);
      }
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.create({ url: `${base}/api/auth/kakao/login?source=extension` }, (tab) => {
      if (chrome.runtime.lastError || !tab?.id) {
        cleanup();
        reject(new Error(chrome.runtime.lastError?.message || '카카오 로그인 창을 열 수 없습니다.'));
        return;
      }
      tabId = tab.id;
    });
  });

  return kakaoLoginPromise;
}

async function loginWithKakao() {
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'KAKAO_LOGIN' }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response?.ok) {
          reject(new Error(response?.error || '카카오 로그인에 실패했습니다.'));
          return;
        }
        resolve(response.data);
      });
    });
  }

  return startKakaoLoginFlow();
}

async function loginWithPassword(email, password) {
  const data = await fetchAuthApi('/api/auth/login', {
    method: 'POST',
    auth: false,
    body: { email, password },
  });

  return persistLoginResponse(data);
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
    displayName: data.user?.displayName || session.displayName || null,
    authProvider: data.user?.authProvider || session.authProvider || 'email',
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
    return `구독 중 · ${subscription.planName || subscription.planId} · 만료 ${subscription.expiresAt || '-'}`;
  }
  return '구독 전 · [구독하기]에서 플랜 선택';
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
  if (usage.locked || usage.planName === '구독 전') {
    return '구독 전 · 결제 후 답글·말투 분석 이용';
  }
  return (
    `${usage.planName || usage.planId || '플랜'} · ` +
    `답글 ${usage.replyUsed}/${usage.replyLimit} · ` +
    `말투 ${usage.toneUsed}/${usage.toneLimit} (${usage.period || ''})`
  );
}
