import {
  getAnalyticsFunnel,
  insertAnalyticsEvent,
  linkAnalyticsInstallUser,
  upsertAnalyticsInstall,
} from './db.js';

const ALLOWED_EVENTS = new Set([
  'install',
  'open',
  'login_click',
  'login_success',
  'login_fail',
  'fetch_success',
  'fetch_fail',
  'generate_success',
]);

export function recordAnalyticsEvent({ installId, event, userId = null, extensionVersion = null, meta = null }) {
  const ev = String(event || '').trim();
  if (!ALLOWED_EVENTS.has(ev)) {
    throw new Error('허용되지 않은 이벤트입니다.');
  }

  const install = upsertAnalyticsInstall(installId, {
    userId: userId || null,
    extensionVersion: extensionVersion || null,
  });
  if (!install) {
    throw new Error('installId가 올바르지 않습니다.');
  }

  if (userId) {
    linkAnalyticsInstallUser(install.install_id, userId);
  }

  insertAnalyticsEvent(install.install_id, ev, {
    userId: userId || install.user_id || null,
    meta,
  });

  return { installId: install.install_id, event: ev };
}

export function getFunnelSummary() {
  return getAnalyticsFunnel();
}
