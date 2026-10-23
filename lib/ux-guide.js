/**
 * 눈에 띄는 안내 카드/토스트. 다음 할 일을 버튼으로 이어 줍니다.
 */
(function initUxGuide() {
  const STYLE_ID = 'ux-guide-style';
  const ROOT_ID = 'ux-guide-root';

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${ROOT_ID} { position: fixed; inset: 0; z-index: 99999; pointer-events: none; }
      .ux-guide-backdrop {
        position: absolute; inset: 0; background: rgba(15,23,42,.45);
        pointer-events: auto;
      }
      .ux-guide-card {
        pointer-events: auto;
        position: absolute; left: 50%; top: 18%;
        transform: translateX(-50%);
        width: min(420px, calc(100% - 24px));
        background: #fff;
        border-radius: 16px;
        box-shadow: 0 18px 50px rgba(15,23,42,.28);
        padding: 18px 18px 16px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .ux-guide-kicker {
        font-size: 11px; font-weight: 800; letter-spacing: .04em;
        color: #047857; margin: 0 0 6px;
      }
      .ux-guide-card.warn .ux-guide-kicker { color: #b45309; }
      .ux-guide-card.ok .ux-guide-kicker { color: #047857; }
      .ux-guide-title { margin: 0 0 8px; font-size: 18px; font-weight: 800; color: #0f172a; line-height: 1.35; }
      .ux-guide-body { margin: 0 0 14px; font-size: 14px; line-height: 1.55; color: #475569; white-space: pre-wrap; }
      .ux-guide-actions { display: flex; gap: 8px; flex-wrap: wrap; }
      .ux-guide-actions button {
        border: 0; border-radius: 10px; padding: 10px 14px;
        font-size: 14px; font-weight: 800; cursor: pointer;
      }
      .ux-guide-primary { background: #03c75a; color: #fff; }
      .ux-guide-secondary { background: #eef2f6; color: #334155; }
      .ux-guide-mute {
        background: transparent !important;
        color: #64748b !important;
        font-weight: 600 !important;
        padding: 10px 8px !important;
      }
      .ux-guide-toast .ux-guide-mute { color: #94a3b8 !important; }
      .ux-guide-toast {
        pointer-events: auto;
        position: absolute; left: 50%; bottom: 18px;
        transform: translateX(-50%);
        width: min(420px, calc(100% - 16px));
        background: #0f172a; color: #fff;
        border-radius: 14px;
        box-shadow: 0 12px 32px rgba(15,23,42,.35);
        padding: 14px 16px;
        border: 2px solid #03c75a;
        animation: uxToastIn .25s ease-out;
      }
      @keyframes uxToastIn {
        from { opacity: 0; transform: translate(-50%, 12px); }
        to { opacity: 1; transform: translate(-50%, 0); }
      }
      .ux-guide-toast .ux-guide-title { color: #fff; font-size: 15px; margin-bottom: 4px; }
      .ux-guide-toast .ux-guide-body { color: #cbd5e1; margin-bottom: 10px; font-size: 13px; }
      .ux-guide-toast .ux-guide-primary { background: #03c75a; }
      .style-hero-pulse {
        animation: styleHeroPulse 1.1s ease-in-out 3;
        box-shadow: 0 0 0 4px rgba(3,199,90,.35) !important;
      }
      @keyframes styleHeroPulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.03); }
      }
    `;
    document.head.appendChild(style);
  }

  function root() {
    ensureStyle();
    let el = document.getElementById(ROOT_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = ROOT_ID;
      document.body.appendChild(el);
    }
    return el;
  }

  const HINT_STORAGE_KEY = 'uxGuideHintsDismissed';

  function storageGet(keys) {
    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.storage?.local) {
        resolve({});
        return;
      }
      chrome.storage.local.get(keys, (data) => resolve(data || {}));
    });
  }

  function storageSet(obj) {
    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.storage?.local) {
        resolve();
        return;
      }
      chrome.storage.local.set(obj, () => resolve());
    });
  }

  async function isHintDismissed(hintId) {
    if (!hintId) return false;
    const data = await storageGet([HINT_STORAGE_KEY]);
    return !!(data[HINT_STORAGE_KEY] || {})[hintId];
  }

  async function dismissHint(hintId) {
    if (!hintId) return;
    const data = await storageGet([HINT_STORAGE_KEY]);
    const map = { ...(data[HINT_STORAGE_KEY] || {}) };
    map[hintId] = Date.now();
    await storageSet({ [HINT_STORAGE_KEY]: map });
  }

  function appendMuteButton(actions, hintId) {
    if (!hintId || !actions) return;
    const mute = document.createElement('button');
    mute.type = 'button';
    mute.className = 'ux-guide-mute';
    mute.textContent = '다시 안 보기';
    mute.addEventListener('click', () => {
      dismissHint(hintId);
      clear();
    });
    actions.appendChild(mute);
  }

  function clear() {
    const el = document.getElementById(ROOT_ID);
    if (el) el.innerHTML = '';
  }

  async function showUxGuide(options = {}) {
    const {
      title = '안내',
      body = '',
      actionLabel = '',
      onAction = null,
      dismissLabel = '닫기',
      tone = 'info',
      hintId = '',
    } = options;
    if (hintId && (await isHintDismissed(hintId))) return;
    const host = root();
    host.innerHTML = '';
    const backdrop = document.createElement('div');
    backdrop.className = 'ux-guide-backdrop';
    backdrop.addEventListener('click', clear);
    const card = document.createElement('div');
    card.className = `ux-guide-card ${tone === 'ok' ? 'ok' : tone === 'warn' ? 'warn' : ''}`;
    card.innerHTML = `
      <p class="ux-guide-kicker">${tone === 'ok' ? '다음 단계' : '먼저 이 일만 하면 됩니다'}</p>
      <h2 class="ux-guide-title"></h2>
      <p class="ux-guide-body"></p>
      <div class="ux-guide-actions"></div>
    `;
    card.querySelector('.ux-guide-title').textContent = title;
    card.querySelector('.ux-guide-body').textContent = body;
    const actions = card.querySelector('.ux-guide-actions');
    if (actionLabel) {
      const primary = document.createElement('button');
      primary.type = 'button';
      primary.className = 'ux-guide-primary';
      primary.textContent = actionLabel;
      primary.addEventListener('click', () => {
        clear();
        if (typeof onAction === 'function') onAction();
      });
      actions.appendChild(primary);
    }
    const secondary = document.createElement('button');
    secondary.type = 'button';
    secondary.className = 'ux-guide-secondary';
    secondary.textContent = dismissLabel;
    secondary.addEventListener('click', clear);
    actions.appendChild(secondary);
    appendMuteButton(actions, hintId);
    host.appendChild(backdrop);
    host.appendChild(card);
  }

  async function showUxToast(options = {}) {
    const {
      title = '',
      body = '',
      actionLabel = '',
      onAction = null,
      ms = 5200,
      hintId = '',
    } = options;
    if (hintId && (await isHintDismissed(hintId))) return;
    const host = root();
    host.innerHTML = '';
    const toast = document.createElement('div');
    toast.className = 'ux-guide-toast';
    toast.innerHTML = `
      <h2 class="ux-guide-title"></h2>
      <p class="ux-guide-body"></p>
      <div class="ux-guide-actions"></div>
    `;
    toast.querySelector('.ux-guide-title').textContent = title;
    toast.querySelector('.ux-guide-body').textContent = body;
    const actions = toast.querySelector('.ux-guide-actions');
    if (actionLabel) {
      const primary = document.createElement('button');
      primary.type = 'button';
      primary.className = 'ux-guide-primary';
      primary.textContent = actionLabel;
      primary.addEventListener('click', () => {
        clear();
        if (typeof onAction === 'function') onAction();
      });
      actions.appendChild(primary);
    }
    appendMuteButton(actions, hintId);
    host.appendChild(toast);
    if (ms > 0) setTimeout(() => {
      if (toast.isConnected) clear();
    }, ms);
  }

  function requestStyleSetup(channel) {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
    chrome.runtime.sendMessage({ type: 'FOCUS_STYLE_SETUP', channel: channel || 'review' }, () => {
      void chrome.runtime.lastError;
    });
  }

  function openWorkAfterStyle(channel) {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
    chrome.runtime.sendMessage({ type: 'OPEN_WORK_AFTER_STYLE', channel: channel || 'review' }, () => {
      void chrome.runtime.lastError;
    });
  }

  window.showUxGuide = showUxGuide;
  window.hideUxGuide = clear;
  window.showUxToast = showUxToast;
  window.requestStyleSetup = requestStyleSetup;
  window.openWorkAfterStyle = openWorkAfterStyle;
})();
