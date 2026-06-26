/**
 * 상품문의 [답글] 클릭 시 인라인/팝업 textarea 자동 입력
 */
(function () {
  if (globalThis.__ssInquiryFillLoaded) return;
  globalThis.__ssInquiryFillLoaded = true;

  const STORAGE_KEY = CONFIG.INQUIRY_STORAGE_KEY || 'smartstoreInquiryReplies';
  const APPLY_ENABLED_KEY = CONFIG.INQUIRY_APPLY_ENABLED_KEY || 'smartstoreInquiryApplyEnabled';
  const PARSE_CACHE_KEY = CONFIG.INQUIRY_PARSE_CACHE_KEY || 'smartstoreInquiryParseCache';
  const FILLED_ATTR = 'data-ss-inquiry-filled';
  const FILLED_ID_ATTR = 'data-ss-inquiry-id';
  const TOAST_ID = 'ss-inquiry-reply-toast';

  let cachedReplies = null;
  let cachedInquiryRows = [];
  let applyEnabled = false;
  let openInquiryId = null;
  let activeInquiryId = null;
  let scanTimer = null;
  let clickWatchAttached = false;
  let isScanning = false;
  let lastScanAt = 0;
  let openIdBurstTimer = null;
  const warnedIds = new Set();
  const MIN_SCAN_INTERVAL_MS = 500;

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[STORAGE_KEY]) {
      cachedReplies = changes[STORAGE_KEY].newValue || {};
    }
    if (changes[APPLY_ENABLED_KEY]) {
      applyEnabled = !!changes[APPLY_ENABLED_KEY].newValue;
    }
    if (changes[PARSE_CACHE_KEY]) {
      cachedInquiryRows = changes[PARSE_CACHE_KEY].newValue?.inquiryRows || [];
    }
    syncWatchState();
  });

  chrome.storage.local.get([STORAGE_KEY, APPLY_ENABLED_KEY, PARSE_CACHE_KEY], (data) => {
    cachedReplies = data[STORAGE_KEY] || {};
    applyEnabled = !!data[APPLY_ENABLED_KEY];
    cachedInquiryRows = data[PARSE_CACHE_KEY]?.inquiryRows || [];
    syncWatchState();
  });

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.type !== 'SS_INQUIRY_OPEN_ID') return;
    openInquiryId = normalizeId(event.data.id);
    activeInquiryId = openInquiryId;
    if (!applyEnabled) return;
    clearTimeout(openIdBurstTimer);
    openIdBurstTimer = setTimeout(() => burstScan(), 200);
  });

  function syncWatchState() {
    const active =
      applyEnabled && cachedReplies && Object.keys(cachedReplies).length > 0;
    if (active) ensureClickWatching();
    else teardownWatching();
  }

  function ensureClickWatching() {
    if (clickWatchAttached) return;
    document.addEventListener('click', onDocumentClick, true);
    window.addEventListener('popstate', onPopState);
    clickWatchAttached = true;
  }

  function teardownWatching() {
    if (clickWatchAttached) {
      document.removeEventListener('click', onDocumentClick, true);
      window.removeEventListener('popstate', onPopState);
      clickWatchAttached = false;
    }
    clearTimeout(scanTimer);
    clearTimeout(openIdBurstTimer);
    scanTimer = null;
    openIdBurstTimer = null;
  }

  function onPopState() {
    scheduleScan(100);
  }

  function burstScan() {
    if (!applyEnabled) return;
    [0, 250, 700, 1400].forEach((delay) => {
      setTimeout(scanTargets, delay);
    });
  }

  function onDocumentClick(event) {
    if (!applyEnabled) return;

    const target = event.target;
    const replyTrigger = target.closest?.('button, a, [role="button"]');
    if (!replyTrigger) return;

    const label = (replyTrigger.innerText || replyTrigger.textContent || '').replace(/\s+/g, ' ').trim();
    if (/템플릿/.test(label)) return;
    if (label !== '답글' && label !== '답변') return;

    const row = findInquiryRow(replyTrigger);
    if (row) {
      const id = resolveInquiryId(row);
      if (id) activeInquiryId = id;
    }

    refreshOpenInquiryId();
    burstScan();
  }

  function scheduleScan(delay) {
    if (!applyEnabled) return;
    if (delay <= 0) {
      clearTimeout(scanTimer);
      scanTimer = setTimeout(scanTargets, 0);
      return;
    }
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanTargets, delay);
  }

  function refreshOpenInquiryId() {
    readOpenInquiryId().then((id) => {
      if (id) {
        openInquiryId = id;
        activeInquiryId = id;
        scheduleScan(0);
      }
    });
  }

  function scanTargets() {
    if (!applyEnabled) return;
    if (!cachedReplies || !Object.keys(cachedReplies).length) return;
    if (isScanning) return;

    const now = Date.now();
    if (now - lastScanAt < MIN_SCAN_INTERVAL_MS) {
      scheduleScan(MIN_SCAN_INTERVAL_MS - (now - lastScanAt));
      return;
    }

    isScanning = true;
    lastScanAt = now;

    try {
      const knownId = activeInquiryId || openInquiryId;
      if (knownId && lookupReply(knownId)) {
        fillOpenReplyTextareas(knownId);
      }

      const roots = collectScanRoots();
      for (const root of roots) {
        tryFillRoot(root);
      }

      tryFillVisibleReplyTextareas();
    } finally {
      isScanning = false;
    }
  }

  function fillOpenReplyTextareas(inquiryId) {
    const id = normalizeId(inquiryId);
    const reply = lookupReply(id);
    if (!reply) return;

    const textareas = getVisibleReplyTextareas().filter((ta) => !String(ta.value || ta.textContent || '').trim());
    if (!textareas.length) return;

    for (const textarea of textareas) {
      tryFillTextarea(textarea, id, findInquiryRow(textarea) || textarea.parentElement);
    }
  }

  function getVisibleReplyTextareas() {
    return [...document.querySelectorAll('textarea, [contenteditable="true"]')].filter(
      (el) => isVisible(el) && isReplyField(el)
    );
  }

  function collectScanRoots() {
    const selectors = [
      '[role="dialog"]',
      '.modal',
      '.popup',
      '.layer_popup',
      '[class*="modal"]',
      '[class*="Modal"]',
      '[class*="popup"]',
      '[class*="Popup"]',
      '[class*="layer"]',
      '[class*="Layer"]',
      '[class*="dialog"]',
      '[class*="Dialog"]',
    ];

    const found = new Set();
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach((el) => {
        if (isVisible(el) && looksLikeInquiryBlock(el)) found.add(el);
      });
    }

    return [...found];
  }

  function looksLikeInquiryBlock(el) {
    const text = (el.innerText || '').slice(0, 500);
    return /미답변|답변완료|상품문의|답글을 입력|문의내용/.test(text);
  }

  function tryFillVisibleReplyTextareas() {
    const textareas = document.querySelectorAll('textarea, [contenteditable="true"]');
    for (const textarea of textareas) {
      if (!isVisible(textarea)) continue;
      if (textarea.getAttribute(FILLED_ATTR) === '1') continue;
      if (!isReplyField(textarea)) continue;

      const row = findInquiryRow(textarea);
      const inquiryId =
        resolveInquiryId(row) || activeInquiryId || openInquiryId || extractInquiryId(row || document.body);

      if (!inquiryId) continue;

      tryFillTextarea(textarea, inquiryId, row || textarea.parentElement || document.body);
    }
  }

  function tryFillRoot(root) {
    const inquiryId =
      resolveInquiryId(root) || activeInquiryId || openInquiryId || extractInquiryId(root);
    if (!inquiryId) return;

    const textarea = findReplyTextarea(root);
    if (!textarea || !isVisible(textarea)) return;

    tryFillTextarea(textarea, inquiryId, root);
  }

  function tryFillTextarea(textarea, inquiryId, markRoot) {
    const id = normalizeId(inquiryId);
    const root = markRoot || textarea.closest('tr, li, article, div, section') || document.body;

    if (
      textarea.getAttribute(FILLED_ATTR) === '1' &&
      textarea.getAttribute(FILLED_ID_ATTR) === id
    ) {
      return;
    }

    const reply = lookupReply(id);
    if (!reply) {
      if (!warnedIds.has(id)) {
        warnedIds.add(id);
        showToast(`문의번호 ${id} 저장 답변 없음`, 'warn');
      }
      return;
    }

    if (String(textarea.value || textarea.textContent || '').trim() === reply.trim()) {
      textarea.setAttribute(FILLED_ATTR, '1');
      textarea.setAttribute(FILLED_ID_ATTR, id);
      return;
    }

    textarea.setAttribute(FILLED_ATTR, '1');
    textarea.setAttribute(FILLED_ID_ATTR, id);
    setTextareaValue(textarea, reply);
    if (root?.setAttribute) {
      root.setAttribute(FILLED_ATTR, '1');
      root.setAttribute(FILLED_ID_ATTR, id);
    }
    showToast(`문의번호 ${id} 답변 자동 입력 완료`, 'ok');
  }

  function resolveInquiryId(root) {
    if (!root) return activeInquiryId || openInquiryId || null;

    const fromDom = extractInquiryId(root);
    if (fromDom) return fromDom;

    const content = extractInquiryContentFromRow(root);
    if (content) {
      const byContent = findInquiryIdByContent(content);
      if (byContent) return byContent;
    }

    return activeInquiryId || openInquiryId || null;
  }

  function findInquiryIdByContent(content) {
    const target = normalizeContent(content);
    if (!target || target.length < 4) return null;

    for (const row of cachedInquiryRows) {
      const candidate = normalizeContent(row.content);
      if (!candidate) continue;
      if (candidate === target) return normalizeId(row.id);
      if (target.includes(candidate) || candidate.includes(target)) return normalizeId(row.id);
    }

    for (const [id, reply] of Object.entries(cachedReplies || {})) {
      void reply;
      const cached = cachedInquiryRows.find((r) => normalizeId(r.id) === normalizeId(id));
      if (!cached) continue;
      const candidate = normalizeContent(cached.content);
      if (candidate === target || target.includes(candidate) || candidate.includes(target)) {
        return normalizeId(id);
      }
    }

    return null;
  }

  function extractInquiryContentFromRow(root) {
    if (!root) return '';

    const blocks = root.querySelectorAll(
      'p, span, div, td, dd, pre, [class*="content"], [class*="Content"], [class*="text"], [class*="Text"]'
    );

    let best = '';
    for (const el of blocks) {
      if (el.closest('textarea, [contenteditable="true"], button, [role="button"]')) continue;
      const text = normalizeContent(el.innerText || el.textContent || '');
      if (text.length < 8) continue;
      if (/답글을 입력|답글 템플릿|등록|취소|0\s*\/\s*1000/.test(text)) continue;
      if (/미답변|답변완료|비밀글|상품문의/.test(text) && text.length < 20) continue;
      if (text.length > best.length) best = text;
    }

    if (best) return best;

    const raw = normalizeContent(root.innerText || '');
    const lines = raw
      .split('\n')
      .map((l) => l.trim())
      .filter(
        (l) =>
          l.length >= 8 &&
          !/^답글|^등록$|^취소$|^미답변$|^답변완료$/.test(l) &&
          !/답글을 입력/.test(l)
      );
    return lines.sort((a, b) => b.length - a.length)[0] || '';
  }

  function findInquiryRow(el) {
    let node = el;
    for (let depth = 0; node && depth < 18; depth += 1, node = node.parentElement) {
      const text = (node.innerText || '').slice(0, 800);
      if (/미답변|답변완료|상품문의/.test(text) && text.length > 20) return node;
      if (node.querySelector?.('textarea') && text.length > 30) return node;
      if (node.tagName === 'TR' || node.tagName === 'LI' || node.tagName === 'ARTICLE') {
        if (text.length > 30) return node;
      }
    }
    return el?.parentElement || null;
  }

  function extractInquiryId(root) {
    if (!root) return null;

    const text = root.innerText || '';
    const patterns = [
      /문의\s*(?:글)?\s*번호\s*[:：]?\s*(\d{6,})/i,
      /문의\s*번호\s*[:：]?\s*(\d{6,})/i,
      /comment\s*(?:no|id|#)?\s*[:：]?\s*(\d{6,})/i,
    ];

    for (const re of patterns) {
      const m = text.match(re);
      if (m) return normalizeId(m[1]);
    }

    const dataEls = root.querySelectorAll(
      '[data-comment-id], [data-inquiry-id], [data-id], [data-contents-id], [id*="comment"], [id*="inquiry"]'
    );
    for (const dataEl of dataEls) {
      const raw =
        dataEl.dataset?.commentId ||
        dataEl.dataset?.inquiryId ||
        dataEl.dataset?.contentsId ||
        dataEl.dataset?.id ||
        dataEl.id;
      const id = normalizeId(raw);
      if (id.length >= 6) return id;
    }

    const html = root.innerHTML || '';
    const htmlMatch = html.match(/comments\/(\d{6,})/);
    if (htmlMatch) return normalizeId(htmlMatch[1]);

    return null;
  }

  function lookupReply(inquiryId) {
    const id = normalizeId(inquiryId);
    return cachedReplies[inquiryId] || cachedReplies[id] || cachedReplies[String(inquiryId)] || null;
  }

  function isReplyField(el) {
    const ph = (el.placeholder || '').toLowerCase();
    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
    if (/답글|답변/.test(ph) || /답글|답변/.test(aria)) return true;

    const row = findInquiryRow(el);
    if (!row) return false;

    const rowText = (row.innerText || '').slice(0, 400);
    return /답글을 입력|답글 템플릿|0\s*\/\s*\d{3,4}/.test(rowText);
  }

  function findReplyTextarea(root) {
    const preferred =
      root.querySelector('textarea[placeholder*="답글"], textarea[placeholder*="답변"]') ||
      findTextareaNearText(root, '답글을 입력') ||
      findTextareaNearText(root, '판매자답변') ||
      findTextareaNearText(root, '판매자 답변') ||
      findTextareaNearText(root, '답변 내용') ||
      findTextareaNearText(root, '답글 내용');
    if (preferred && isVisible(preferred)) return preferred;

    const candidates = [
      ...root.querySelectorAll('textarea'),
      ...root.querySelectorAll('[contenteditable="true"]'),
    ];
    const scored = candidates
      .filter(isVisible)
      .map((el) => ({ el, score: scoreReplyField(el, root) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored[0]?.el || null;
  }

  function scoreReplyField(el, root) {
    let score = 1;
    const ph = (el.placeholder || '').toLowerCase();
    const name = (el.name || '').toLowerCase();
    const id = (el.id || '').toLowerCase();
    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
    const labelText = findAssociatedLabel(el, root).toLowerCase();
    const keywords = ['답변', '답글', 'reply', 'comment', '판매자', '문의', '입력'];

    for (const kw of keywords) {
      if (ph.includes(kw) || name.includes(kw) || id.includes(kw) || aria.includes(kw) || labelText.includes(kw)) {
        score += 5;
      }
    }

    if (el.tagName === 'TEXTAREA') score += 2;
    if ((el.value || '').length === 0) score += 1;
    return score;
  }

  function findAssociatedLabel(el, root) {
    if (el.id) {
      const label = root.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return label.innerText;
    }
    const wrap = el.closest('label, .form-group, .input-group, tr, dl, td, th, div, section');
    return wrap ? wrap.innerText.slice(0, 120) : '';
  }

  function findTextareaNearText(root, labelText) {
    const nodes = root.querySelectorAll('div, p, span, strong, label, td, th');
    for (const node of nodes) {
      const text = (node.innerText || '').replace(/\s+/g, ' ').trim();
      if (!text.includes(labelText)) continue;

      const sameBlock = node.parentElement;
      if (sameBlock) {
        const localTextarea = sameBlock.querySelector('textarea');
        if (localTextarea) return localTextarea;
      }

      let next = node.nextElementSibling;
      while (next) {
        const localTextarea = next.querySelector?.('textarea') || (next.tagName === 'TEXTAREA' ? next : null);
        if (localTextarea) return localTextarea;
        next = next.nextElementSibling;
      }
    }
    return null;
  }

  function setTextareaValue(el, value) {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const proto =
        el.tagName === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
      el.focus();
      el.select?.();
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      return;
    }

    if (el.isContentEditable) {
      el.focus();
      el.textContent = value;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
    }
  }

  function readOpenInquiryId() {
    return new Promise((resolve) => {
      const handler = (event) => {
        if (event.source !== window || event.data?.type !== 'SS_INQUIRY_OPEN_ID') return;
        window.removeEventListener('message', handler);
        resolve(event.data.id ? normalizeId(event.data.id) : null);
      };
      window.addEventListener('message', handler);
      window.postMessage({ type: 'SS_INQUIRY_GET_OPEN_ID' }, '*');
      setTimeout(() => {
        window.removeEventListener('message', handler);
        resolve(null);
      }, 300);
    });
  }

  function normalizeContent(text) {
    return String(text ?? '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function normalizeId(id) {
    return String(id ?? '').replace(/[^\d]/g, '');
  }

  function showToast(message, type = 'ok') {
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement('div');
      toast.id = TOAST_ID;
      Object.assign(toast.style, {
        position: 'fixed',
        bottom: '24px',
        left: '24px',
        zIndex: '2147483647',
        padding: '10px 14px',
        borderRadius: '8px',
        fontSize: '13px',
        fontFamily: 'sans-serif',
        boxShadow: '0 4px 16px rgba(0,0,0,.15)',
        maxWidth: '320px',
        lineHeight: '1.4',
        transition: 'opacity .3s',
      });
      document.body.appendChild(toast);
    }

    toast.textContent = `[문의답글] ${message}`;
    toast.style.background = type === 'ok' ? '#eef8f2' : '#fff4e5';
    toast.style.color = type === 'ok' ? '#0a7a3f' : '#9a6700';
    toast.style.border = `1px solid ${type === 'ok' ? '#b8e6cc' : '#f0d9a8'}`;
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
      toast.style.opacity = '0';
    }, 3500);
    toast.style.opacity = '1';
  }
})();
