/**
 * 스마트스토어 판매자센터 리뷰 상세/답글 팝업에서
 * 글번호를 인식해 chrome.storage 에 저장된 답변을 textarea 에 채웁니다.
 */
(function () {
  if (globalThis.__ssReviewContentLoaded) return;
  globalThis.__ssReviewContentLoaded = true;

  const STORAGE_KEY = 'smartstoreReviewReplies';
  const APPLY_ENABLED_KEY = 'smartstoreReviewApplyEnabled';
  const FILLED_ATTR = 'data-ss-reply-filled';
  const FILLED_ID_ATTR = 'data-ss-reply-id';
  const TOAST_ID = 'ss-review-reply-toast';

  let cachedReplies = null;
  let applyEnabled = false;
  let scanTimer = null;
  let clickWatchAttached = false;

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[STORAGE_KEY]) {
      cachedReplies = changes[STORAGE_KEY].newValue || {};
    }
    if (changes[APPLY_ENABLED_KEY]) {
      applyEnabled = !!changes[APPLY_ENABLED_KEY].newValue;
    }
    syncWatchState();
  });

  chrome.storage.local.get([STORAGE_KEY, APPLY_ENABLED_KEY], (data) => {
    cachedReplies = data[STORAGE_KEY] || {};
    applyEnabled = !!data[APPLY_ENABLED_KEY];
    syncWatchState();
  });

  function syncWatchState() {
    const active =
      applyEnabled && cachedReplies && Object.keys(cachedReplies).length > 0;
    if (active) {
      ensureClickWatching();
    } else {
      teardownWatching();
    }
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
    scanTimer = null;
  }

  function onPopState() {
    scheduleScan(300);
  }

  function scheduleScan(delay) {
    if (!applyEnabled) return;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanPopups, delay);
  }

  function onDocumentClick() {
    scheduleScan(200);
    setTimeout(scanPopups, 500);
    setTimeout(scanPopups, 1200);
  }

  function scanPopups() {
    if (!applyEnabled) return;
    if (!cachedReplies || !Object.keys(cachedReplies).length) return;

    const roots = collectPopupRoots();
    for (const root of roots) {
      tryFill(root);
    }
  }

  function collectPopupRoots() {
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
        if (isVisible(el)) found.add(el);
      });
    }

    if (found.size === 0) {
      found.add(document.body);
    }

    return [...found];
  }

  function tryFill(root) {
    const reviewId = extractReviewId(root);
    if (!reviewId) return;

    if (
      root.getAttribute(FILLED_ATTR) === '1' &&
      root.getAttribute(FILLED_ID_ATTR) === reviewId
    ) {
      return;
    }

    const reply = lookupReply(reviewId);
    if (!reply) {
      showToast(`글번호 ${reviewId} 저장 답변 없음`, 'warn');
      return;
    }

    const textarea = findReplyTextarea(root);
    if (!textarea) return;

    if (textarea.value.trim() === reply.trim()) {
      root.setAttribute(FILLED_ATTR, '1');
      root.setAttribute(FILLED_ID_ATTR, reviewId);
      return;
    }

    setTextareaValue(textarea, reply);
    root.setAttribute(FILLED_ATTR, '1');
    root.setAttribute(FILLED_ID_ATTR, reviewId);
    showToast(`글번호 ${reviewId} 답변 자동 입력 완료`, 'ok');
  }

  function extractReviewId(root) {
    const text = root.innerText || '';
    const patterns = [
      /리뷰\s*글번호\s*[:：]?\s*(\d+)/i,
      /리뷰\s*글\s*번\s*호\s*[:：]?\s*(\d+)/i,
      /글\s*번\s*호\s*[:：]?\s*(\d+)/i,
      /리뷰\s*번\s*호\s*[:：]?\s*(\d+)/i,
      /review\s*(?:no|id|#)?\s*[:：]?\s*(\d+)/i,
    ];

    for (const re of patterns) {
      const m = text.match(re);
      if (m) return normalizeId(m[1]);
    }

    const candidates = root.querySelectorAll(
      'th, dt, label, span, strong, div, p, li, td, [class*="label"], [class*="title"]'
    );
    for (const el of candidates) {
      const blockText = (el.innerText || '').trim();
      if (!blockText || !/글|번호|리뷰/i.test(blockText)) continue;
      const num = blockText.match(/(\d{8,})/);
      if (num) return normalizeId(num[1]);
    }

    const dataEl = root.querySelector(
      '[data-review-id], [data-review-no], [data-id][class*="review"]'
    );
    if (dataEl) {
      const raw =
        dataEl.dataset.reviewId ||
        dataEl.dataset.reviewNo ||
        dataEl.dataset.id;
      if (raw) return normalizeId(raw);
    }

    return null;
  }

  function lookupReply(reviewId) {
    const id = normalizeId(reviewId);
    return (
      cachedReplies[reviewId] ||
      cachedReplies[id] ||
      cachedReplies[String(reviewId)] ||
      null
    );
  }

  function findReplyTextarea(root) {
    const preferred =
      root.querySelector('textarea[placeholder*="정성"], textarea[title*="답글"]') ||
      findTextareaNearText(root, '판매자답글') ||
      findTextareaNearText(root, '답글 내용') ||
      findTextareaNearText(root, '답글내용');
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

    const keywords = ['답글', '답변', '댓글', 'reply', 'comment', '판매자'];
    for (const kw of keywords) {
      if (
        ph.includes(kw) ||
        name.includes(kw) ||
        id.includes(kw) ||
        aria.includes(kw) ||
        labelText.includes(kw)
      ) {
        score += 5;
      }
    }

    if (el.tagName === 'TEXTAREA') score += 2;
    if (el.closest('form')) score += 1;
    if ((el.value || '').includes('반복적인 답글이 아닌')) score += 6;

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
      if (setter) {
        setter.call(el, value);
      } else {
        el.value = value;
      }
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

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function normalizeId(id) {
    return String(id).replace(/[^\d]/g, '');
  }

  function showToast(message, type = 'ok') {
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement('div');
      toast.id = TOAST_ID;
      Object.assign(toast.style, {
        position: 'fixed',
        bottom: '24px',
        right: '24px',
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

    toast.textContent = `[리뷰답글] ${message}`;
    toast.style.background = type === 'ok' ? '#e8f8ef' : '#fff4e5';
    toast.style.color = type === 'ok' ? '#0a7a3f' : '#9a6700';
    toast.style.border = `1px solid ${type === 'ok' ? '#b8e6cc' : '#f0d9a8'}`;
    toast.style.opacity = '1';

    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
      toast.style.opacity = '0';
    }, 3500);
  }
})();
