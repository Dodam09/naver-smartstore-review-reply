/**
 * 익명 설치 ID + 퍼널 이벤트 (로그인 전에도 추적)
 */
const ANALYTICS_INSTALL_ID_KEY = 'analyticsInstallId';
const ANALYTICS_OPENED_DAY_KEY = 'analyticsOpenedDay';

function analyticsStorageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(Array.isArray(keys) ? keys : [keys], resolve);
  });
}

function analyticsStorageSet(data) {
  return new Promise((resolve) => chrome.storage.local.set(data, resolve));
}

function createInstallId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `inst_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

async function getAnalyticsInstallId() {
  const data = await analyticsStorageGet(ANALYTICS_INSTALL_ID_KEY);
  if (data[ANALYTICS_INSTALL_ID_KEY]) return data[ANALYTICS_INSTALL_ID_KEY];
  const id = createInstallId();
  await analyticsStorageSet({ [ANALYTICS_INSTALL_ID_KEY]: id });
  return id;
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function trackAnalyticsEvent(event, meta = {}) {
  try {
    const base = String(CONFIG?.API_BASE_URL || '')
      .trim()
      .replace(/\/$/, '');
    if (!base) return;

    const installId = await getAnalyticsInstallId();
    const headers = { 'Content-Type': 'application/json' };
    try {
      if (typeof loadAuthSession === 'function') {
        const session = await loadAuthSession();
        if (session?.token) headers.Authorization = `Bearer ${session.token}`;
      }
    } catch (_) {}

    let version = '';
    try {
      version = chrome.runtime.getManifest()?.version || '';
    } catch (_) {}

    fetch(`${base}/api/analytics/event`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        installId,
        event,
        version,
        meta: meta && typeof meta === 'object' ? meta : undefined,
      }),
    }).catch(() => {});
  } catch (_) {}
}

async function trackAnalyticsOpen() {
  const day = todayKey();
  const data = await analyticsStorageGet(ANALYTICS_OPENED_DAY_KEY);
  if (data[ANALYTICS_OPENED_DAY_KEY] === day) return;
  await analyticsStorageSet({ [ANALYTICS_OPENED_DAY_KEY]: day });
  await trackAnalyticsEvent('open');
}
