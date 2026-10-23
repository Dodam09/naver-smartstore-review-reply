/**
 * 답변란 자동 채우기 안내 — 반복 데모 + 판매자센터에서 누를 버튼 표시.
 */
(function initSellerFillGuide() {
  const ROOT_ID = 'ss-fill-howto-root';
  const TOAST_ID = 'ss-fill-guide-toast';
  const STYLE_ID = 'ss-fill-guide-style';
  const HINT_KEY = 'uxGuideHintsDismissed';
  const PULSE_CLASS = 'ss-fill-confirm-pulse';
  const REPLY_PULSE_CLASS = 'ss-fill-reply-pulse';

  let replyPulseTimer = null;
  let demoTimer = null;

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${ROOT_ID} { position: fixed; inset: 0; z-index: 2147483646; }
      .ss-howto-back { position: absolute; inset: 0; background: rgba(15,23,42,.5); }
      .ss-howto-card {
        position: absolute; left: 50%; top: 8%; transform: translateX(-50%);
        width: min(440px, calc(100% - 20px)); max-height: calc(100% - 24px); overflow: auto;
        background: #fff; color: #0f172a; border-radius: 16px;
        box-shadow: 0 20px 50px rgba(15,23,42,.3);
        padding: 16px 16px 14px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .ss-howto-kicker { margin: 0 0 4px; font-size: 11px; font-weight: 800; color: #047857; letter-spacing: .04em; }
      .ss-howto-title { margin: 0 0 8px; font-size: 18px; font-weight: 800; line-height: 1.35; }
      .ss-howto-body { margin: 0 0 12px; font-size: 13px; line-height: 1.55; color: #475569; }
      .ss-howto-demo {
        background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 14px;
        padding: 12px; margin: 0 0 12px; min-height: 168px; position: relative; overflow: hidden;
      }
      .ss-howto-stage { height: 118px; position: relative; }
      .ss-howto-frame {
        position: absolute; inset: 0; opacity: 0; pointer-events: none;
        transition: opacity .25s ease;
        display: flex; flex-direction: column; justify-content: center; gap: 8px;
      }
      .ss-howto-demo[data-frame="0"] .f0,
      .ss-howto-demo[data-frame="1"] .f1,
      .ss-howto-demo[data-frame="2"] .f2 { opacity: 1; }
      .ss-howto-row {
        display: flex; align-items: center; justify-content: space-between; gap: 8px;
        background: #fff; border: 1px solid #dbe3ee; border-radius: 10px; padding: 10px 12px;
      }
      .ss-howto-row .meta { font-size: 12px; color: #64748b; }
      .ss-howto-chip {
        border: 0; border-radius: 8px; padding: 6px 12px; font-size: 13px; font-weight: 800;
        background: #03c75a; color: #fff;
      }
      .ss-howto-chip.ghost { background: #e2e8f0; color: #334155; }
      .ss-howto-review-link {
        color: #2b6cb0; font-size: 13px; font-weight: 700; text-decoration: underline;
        text-underline-offset: 2px; max-width: 58%; overflow: hidden; white-space: nowrap;
      }
      .ss-howto-col {
        font-size: 11px; font-weight: 800; color: #64748b; padding: 0 4px 4px;
      }
      .ss-howto-dialog {
        background: #fff; border: 1px solid #dbe3ee; border-radius: 12px; padding: 10px;
      }
      .ss-howto-ta {
        min-height: 52px; border: 1px solid #cbd5e1; border-radius: 8px;
        padding: 8px; font-size: 12px; color: #94a3b8; background: #f8fafc;
      }
      .ss-howto-ta.filled { color: #0f172a; background: #ecfdf5; border-color: #86efac; }
      .ss-howto-actions-row { display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px; }
      .ss-howto-cursor {
        position: absolute; width: 16px; height: 16px; border-radius: 50% 50% 50% 0;
        background: #0f172a; transform: rotate(-20deg) scale(0.9);
        box-shadow: 0 2px 6px rgba(0,0,0,.25);
        animation: ssCursorTap 1.6s ease-in-out infinite;
      }
      .ss-howto-demo[data-frame="0"][data-kind="inquiry"] .ss-howto-cursor { right: 28px; top: 38px; }
      .ss-howto-demo[data-frame="0"][data-kind="review"] .ss-howto-cursor { right: 72px; top: 44px; }
      .ss-howto-demo[data-frame="1"] .ss-howto-cursor { display: none; }
      .ss-howto-demo[data-frame="2"] .ss-howto-cursor { right: 36px; bottom: 18px; }
      @keyframes ssCursorTap {
        0%, 100% { transform: rotate(-20deg) scale(.9); }
        50% { transform: rotate(-20deg) scale(1.15); }
      }
      .ss-howto-cap { margin: 8px 0 0; font-size: 13px; font-weight: 800; color: #0f172a; text-align: center; }
      .ss-howto-steps { margin: 0 0 12px; padding: 0; list-style: none; }
      .ss-howto-steps li {
        display: flex; gap: 8px; align-items: flex-start;
        font-size: 13px; line-height: 1.5; color: #334155; margin: 0 0 6px;
      }
      .ss-howto-num {
        flex: 0 0 22px; height: 22px; border-radius: 999px; background: #03c75a; color: #fff;
        font-size: 12px; font-weight: 800; display: flex; align-items: center; justify-content: center;
      }
      .ss-howto-alt {
        margin: 0 0 12px; padding: 10px 12px; background: #eff6ff; border: 1px solid #bfdbfe;
        border-radius: 12px; font-size: 13px; line-height: 1.5; color: #1e3a8a;
      }
      .ss-howto-alt.warn {
        background: #fff7ed; border-color: #fdba74; color: #9a3412;
      }
      .ss-howto-card.warn .ss-howto-kicker { color: #c2410c; }
      .ss-howto-danger { background: #c2410c; color: #fff; }
      .ss-howto-btns { display: flex; flex-wrap: wrap; gap: 8px; }
      .ss-howto-btns button {
        border: 0; border-radius: 10px; padding: 10px 14px; font-size: 14px; font-weight: 800; cursor: pointer;
      }
      .ss-howto-primary { background: #03c75a; color: #fff; }
      .ss-howto-secondary { background: #e2e8f0; color: #334155; }
      .ss-howto-mute { background: transparent; color: #64748b; font-weight: 600; }
      #${TOAST_ID} {
        position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
        z-index: 2147483647; width: min(420px, calc(100% - 24px));
        background: #0f172a; color: #fff; border: 2px solid #03c75a;
        border-radius: 14px; padding: 14px 16px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow: 0 12px 32px rgba(15,23,42,.35);
      }
      #${TOAST_ID} .ss-fill-title { margin: 0 0 4px; font-size: 15px; font-weight: 800; }
      #${TOAST_ID} .ss-fill-body { margin: 0; font-size: 13px; line-height: 1.5; color: #cbd5e1; }
      .${PULSE_CLASS}, .${REPLY_PULSE_CLASS} {
        outline: 3px solid #03c75a !important;
        box-shadow: 0 0 0 6px rgba(3,199,90,.35) !important;
        animation: ssFillPulse 1s ease-in-out infinite;
        position: relative; z-index: 2147483000 !important;
      }
      .ss-fill-tip {
        position: absolute; left: 50%; bottom: calc(100% + 8px); transform: translateX(-50%);
        background: #0f172a; color: #fff; font-size: 12px; font-weight: 800;
        padding: 6px 8px; border-radius: 8px; white-space: nowrap; pointer-events: none;
        z-index: 2147483647;
      }
      @keyframes ssFillPulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.06); }
      }
    `;
    document.documentElement.appendChild(style);
  }

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
    const data = await storageGet([HINT_KEY]);
    return !!(data[HINT_KEY] || {})[hintId];
  }

  async function dismissHint(hintId) {
    if (!hintId) return;
    const data = await storageGet([HINT_KEY]);
    const map = { ...(data[HINT_KEY] || {}) };
    map[hintId] = Date.now();
    await storageSet({ [HINT_KEY]: map });
  }

  function isVisible(el) {
    if (!el?.getBoundingClientRect) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function clearHowto() {
    if (demoTimer) {
      clearInterval(demoTimer);
      demoTimer = null;
    }
    document.getElementById(ROOT_ID)?.remove();
  }

  function startDemo(card) {
    const demo = card.querySelector('.ss-howto-demo');
    const cap = card.querySelector('.ss-howto-cap');
    const isInquiry = demo?.dataset.kind === 'inquiry';
    const caps = [
      isInquiry ? '1. 목록에서 [답글]을 눌러요' : '1. 파란 「리뷰내용」을 눌러요',
      '2. 답변란이 자동으로 채워져요',
      '3. [확인]을 눌러야 등록돼요',
    ];
    let i = 0;
    const tick = () => {
      if (!demo.isConnected) return;
      demo.dataset.frame = String(i);
      if (cap) cap.textContent = caps[i];
      i = (i + 1) % 3;
    };
    tick();
    demoTimer = setInterval(tick, 1700);
  }

  async function showFillHowto(options = {}) {
    ensureStyle();
    const {
      channel = 'review',
      count = 0,
      hasBulk = false,
      onOpenSeller = null,
      onBulk = null,
      hintId = channel === 'inquiry' ? 'fill-howto-inquiry' : 'fill-howto-review',
    } = options;
    if (hintId && (await isHintDismissed(hintId))) {
      if (typeof onOpenSeller === 'function') onOpenSeller();
      return;
    }

    clearHowto();
    const host = document.createElement('div');
    host.id = ROOT_ID;
    const isInquiry = channel === 'inquiry';
    host.innerHTML = `
      <div class="ss-howto-back"></div>
      <div class="ss-howto-card">
        <p class="ss-howto-kicker">이렇게 하면 답변이 올라갑니다</p>
        <h2 class="ss-howto-title"></h2>
        <p class="ss-howto-body"></p>
        <div class="ss-howto-demo" data-frame="0" data-kind="${isInquiry ? 'inquiry' : 'review'}">
          <div class="ss-howto-stage">
            <div class="ss-howto-frame f0">
              ${
                isInquiry
                  ? `<div class="ss-howto-row">
                <span class="meta">상품문의 · 미답변</span>
                <span class="ss-howto-chip">답글</span>
              </div>`
                  : `<div class="ss-howto-col">리뷰내용 ← 여기를 눌러 창이 열려요</div>
              <div class="ss-howto-row">
                <span class="meta">★★★★★ 5</span>
                <span class="ss-howto-review-link">사용하기 편하고 만족합니다</span>
              </div>`
              }
            </div>
            <div class="ss-howto-frame f1">
              <div class="ss-howto-dialog">
                <div class="meta" style="font-size:12px;color:#64748b;margin-bottom:6px;">판매자 답글</div>
                <div class="ss-howto-ta filled">안녕하세요. 소중한 후기 감사합니다…</div>
              </div>
            </div>
            <div class="ss-howto-frame f2">
              <div class="ss-howto-dialog">
                <div class="ss-howto-ta filled">안녕하세요. 소중한 후기 감사합니다…</div>
                <div class="ss-howto-actions-row">
                  <span class="ss-howto-chip ghost">취소</span>
                  <span class="ss-howto-chip">확인</span>
                </div>
              </div>
            </div>
            <div class="ss-howto-cursor"></div>
          </div>
          <p class="ss-howto-cap">${isInquiry ? '1. 목록에서 [답글]을 눌러요' : '1. 파란 「리뷰내용」을 눌러요'}</p>
        </div>
        <ol class="ss-howto-steps">
          <li><span class="ss-howto-num">1</span><span>${
            isInquiry
              ? '상품문의 목록에서 해당 글의 <strong>[답글]</strong>을 누릅니다.'
              : '리뷰 목록에서 파란색 <strong>리뷰내용</strong>을 누릅니다. 그래야 답변 창이 열립니다.'
          }</span></li>
          <li><span class="ss-howto-num">2</span><span>답변란이 자동으로 채워집니다. 내용만 확인하세요.</span></li>
          <li><span class="ss-howto-num">3</span><span><strong>[확인]</strong>을 눌러야 판매자센터에 답변이 등록됩니다. 채우기만 하고 닫으면 올라가지 않습니다.</span></li>
        </ol>
        <div class="ss-howto-alt" ${hasBulk ? '' : 'hidden'}></div>
        <div class="ss-howto-btns">
          <button type="button" class="ss-howto-primary" data-act="seller">판매자센터 열기</button>
          <button type="button" class="ss-howto-secondary" data-act="bulk" ${hasBulk ? '' : 'hidden'}>한 번에 올리기</button>
          <button type="button" class="ss-howto-mute" data-act="mute">다시 안 보기</button>
        </div>
      </div>
    `;
    const title = host.querySelector('.ss-howto-title');
    const body = host.querySelector('.ss-howto-body');
    title.textContent = count
      ? `판매자센터에서 직접 올리기 · ${count}건`
      : '판매자센터에서 직접 올리는 방법';
    body.textContent = isInquiry
      ? '아직 등록된 게 아닙니다. 상품문의에서 [답글] → 내용 확인 → [확인] 순서로 올립니다.'
      : '아직 등록된 게 아닙니다. 목록의 파란 「리뷰내용」을 눌러 창을 연 뒤, 채워진 글을 보고 [확인]을 눌러야 올라갑니다.';
    const alt = host.querySelector('.ss-howto-alt');
    if (hasBulk && alt) {
      alt.hidden = false;
      alt.classList.add('warn');
      alt.textContent =
        '한 번에 올리기는 확인한 글이 바로 등록됩니다. 각 답글을 보고 난 뒤에만 쓰세요.';
    }

    const finish = (next) => {
      clearHowto();
      if (typeof next === 'function') next();
    };
    host.querySelector('.ss-howto-back').addEventListener('click', () => finish(onOpenSeller));
    host.querySelector('[data-act="seller"]').addEventListener('click', () => finish(onOpenSeller));
    host.querySelector('[data-act="bulk"]')?.addEventListener('click', () => finish(onBulk));
    host.querySelector('[data-act="mute"]').addEventListener('click', async () => {
      await dismissHint(hintId);
      finish(onOpenSeller);
    });

    document.documentElement.appendChild(host);
    startDemo(host);
  }

  function showBulkConfirm(options = {}) {
    const { count = 0, onConfirm = null, onCancel = null } = options;
    ensureStyle();
    clearHowto();
    const host = document.createElement('div');
    host.id = ROOT_ID;
    const n = Math.max(0, Number(count) || 0);
    host.innerHTML = `
      <div class="ss-howto-back"></div>
      <div class="ss-howto-card warn">
        <p class="ss-howto-kicker">한 번에 올리기 · 확인 필수</p>
        <h2 class="ss-howto-title"></h2>
        <p class="ss-howto-body"></p>
        <div class="ss-howto-alt warn">다시 안 보기 없이, 올릴 때마다 이 확인을 거칩니다.</div>
        <div class="ss-howto-btns">
          <button type="button" class="ss-howto-danger" data-act="go"></button>
          <button type="button" class="ss-howto-secondary" data-act="no">취소</button>
        </div>
      </div>
    `;
    host.querySelector('.ss-howto-title').textContent = `${n}건이 바로 등록됩니다`;
    host.querySelector('.ss-howto-body').textContent =
      '각 답글을 확인·수정한 뒤에만 올리세요. 확인하지 않은 초안이 고객에게 그대로 보일 수 있습니다. 올린 뒤에는 판매자센터에서 고쳐야 합니다.';
    host.querySelector('[data-act="go"]').textContent = `확인했고 ${n}건 올리기`;
    const finish = (next) => {
      clearHowto();
      if (typeof next === 'function') next();
    };
    host.querySelector('.ss-howto-back').addEventListener('click', () => finish(onCancel));
    host.querySelector('[data-act="no"]').addEventListener('click', () => finish(onCancel));
    host.querySelector('[data-act="go"]').addEventListener('click', () => finish(onConfirm));
    document.documentElement.appendChild(host);
  }

  function showFillToast(options = {}) {
    ensureStyle();
    const { title = '', body = '', tone = 'ok', ms = 8000 } = options;
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement('div');
      toast.id = TOAST_ID;
      document.documentElement.appendChild(toast);
    }
    toast.className = tone === 'warn' ? 'warn' : '';
    toast.innerHTML = `
      <p class="ss-fill-title"></p>
      <p class="ss-fill-body"></p>
    `;
    toast.querySelector('.ss-fill-title').textContent = title;
    toast.querySelector('.ss-fill-body').textContent = body;
    toast.style.opacity = '1';
    clearTimeout(showFillToast._timer);
    showFillToast._timer = setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, ms);
  }

  function clearButtonPulses() {
    document.querySelectorAll(`.${PULSE_CLASS}, .${REPLY_PULSE_CLASS}`).forEach((el) => {
      el.classList.remove(PULSE_CLASS, REPLY_PULSE_CLASS);
      el.querySelector('.ss-fill-tip')?.remove();
    });
  }

  function addTip(el, text) {
    el.querySelector('.ss-fill-tip')?.remove();
    const tip = document.createElement('span');
    tip.className = 'ss-fill-tip';
    tip.textContent = text;
    const style = window.getComputedStyle(el);
    if (style.position === 'static') el.style.position = 'relative';
    el.appendChild(tip);
  }

  function controlText(el) {
    return `${el.innerText || ''} ${el.value || ''} ${el.getAttribute('aria-label') || ''}`
      .replace(/\s+/g, ' ')
      .trim();
  }

  function highlightConfirmButton(root) {
    ensureStyle();
    const scope = root?.querySelectorAll ? root : document;
    const nodes = [
      ...scope.querySelectorAll('button, [role="button"], a, input[type="button"], input[type="submit"]'),
    ];
    const ranked = [];
    for (const el of nodes) {
      if (!isVisible(el)) continue;
      const text = controlText(el);
      if (!text || /취소|닫기|삭제|템플릿|이전/.test(text)) continue;
      let score = 0;
      if (/^(확인|등록|저장|답글 등록)$/.test(text)) score = 20;
      else if (/확인|등록/.test(text) && text.length <= 12) score = 8;
      if (score) ranked.push({ el, score });
    }
    ranked.sort((a, b) => b.score - a.score);
    const target = ranked[0]?.el;
    if (!target) return;
    document.querySelectorAll(`.${REPLY_PULSE_CLASS}`).forEach((el) => {
      el.classList.remove(REPLY_PULSE_CLASS);
      el.querySelector('.ss-fill-tip')?.remove();
    });
    target.classList.add(PULSE_CLASS);
    addTip(target, '여기를 눌러야 답변이 등록돼요');
    target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    setTimeout(() => {
      target.classList.remove(PULSE_CLASS);
      target.querySelector('.ss-fill-tip')?.remove();
    }, 8000);
  }

  function sellerPageChannel() {
    const hay = `${location.hash} ${location.pathname} ${location.href}`;
    if (/comment|inquiry|상품문의/i.test(hay) && !/review/i.test(location.hash || '')) return 'inquiry';
    if (/review/i.test(hay)) return 'review';
    if (/comment|inquiry/i.test(hay)) return 'inquiry';
    return 'review';
  }

  function isReplyOpenControl(el) {
    const text = controlText(el).replace(/\s+/g, '');
    if (!text || text.length > 8) return false;
    if (/템플릿|관리|설정|취소|삭제|작성/.test(text)) return false;
    return text === '답글' || text === '답글쓰기' || text === '답변수정' || text === '답변하기';
  }

  function headerLabel(el) {
    return (el.innerText || '').replace(/\s+/g, '');
  }

  function pickClickable(cell) {
    const link = cell.querySelector?.('a, button, [role="button"]');
    if (link && isVisible(link)) return link;
    return cell;
  }

  function findReviewContentTargets() {
    const tables = [...document.querySelectorAll('table')];
    for (const table of tables) {
      const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
      if (!headerRow) continue;
      const headerCells = [...headerRow.children];
      const colIndex = headerCells.findIndex((th) => headerLabel(th).includes('리뷰내용'));
      if (colIndex < 0) continue;
      const bodyRows = table.querySelectorAll('tbody tr');
      const rows = bodyRows.length ? bodyRows : [...table.querySelectorAll('tr')].slice(1);
      const hits = [];
      for (const row of rows) {
        const cell = row.children[colIndex];
        if (!cell || !isVisible(cell)) continue;
        const target = pickClickable(cell);
        const text = (target.innerText || '').trim();
        if (!text || text === '-') continue;
        const rect = target.getBoundingClientRect();
        if (rect.width < 8 || rect.height < 8) continue;
        if (rect.top < 70 || rect.bottom > window.innerHeight - 24) continue;
        hits.push(target);
        if (hits.length >= 5) break;
      }
      if (hits.length) return hits;
    }
    return findTargetsUnderHeader('리뷰내용');
  }

  function findTargetsUnderHeader(label) {
    const compact = String(label || '').replace(/\s+/g, '');
    const header = [...document.querySelectorAll('th, [role="columnheader"], thead td, thead div, thead span')].find(
      (el) => isVisible(el) && headerLabel(el).includes(compact)
    );
    if (!header) return [];
    const hr = header.getBoundingClientRect();
    if (hr.width < 24 || hr.height > 80) return [];
    const hits = [];
    const seen = new Set();
    const candidates = document.querySelectorAll('td a, td, [role="gridcell"] a, [role="gridcell"]');
    for (const el of candidates) {
      if (!isVisible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.top < hr.bottom + 2) continue;
      if (r.top < 70 || r.bottom > window.innerHeight - 24) continue;
      const cx = r.left + r.width / 2;
      if (cx < hr.left - 10 || cx > hr.right + 10) continue;
      const text = (el.innerText || '').trim();
      if (!text || text === '-' || text.length < 2) continue;
      const target = pickClickable(el);
      if (seen.has(target)) continue;
      seen.add(target);
      hits.push(target);
      if (hits.length >= 5) break;
    }
    return hits;
  }

  function highlightReplyOpenButtons() {
    ensureStyle();
    if (document.querySelector(`.${PULSE_CLASS}`)) return;
    const dialogOpen = [...document.querySelectorAll('[role="dialog"], .modal, [class*="Modal"], textarea')].some(
      (el) => {
        if (!isVisible(el)) return false;
        if (el.tagName === 'TEXTAREA' || el.getAttribute?.('contenteditable') === 'true') {
          const rect = el.getBoundingClientRect();
          return rect.height > 40;
        }
        return !!el.querySelector?.('textarea, [contenteditable="true"]');
      }
    );
    if (dialogOpen) return;

    clearButtonPulses();
    const channel = sellerPageChannel();
    if (channel === 'review') {
      const hits = findReviewContentTargets();
      hits.forEach((el, i) => {
        el.classList.add(REPLY_PULSE_CLASS);
        if (i === 0) addTip(el, '이 리뷰내용을 누르세요');
      });
      return;
    }

    const nodes = [...document.querySelectorAll('button, a, [role="button"], span, em')];
    const hits = [];
    for (const el of nodes) {
      if (!isVisible(el) || !isReplyOpenControl(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.top < 80 || rect.bottom > window.innerHeight - 40) continue;
      hits.push(el);
      if (hits.length >= 4) break;
    }
    hits.forEach((el, i) => {
      el.classList.add(REPLY_PULSE_CLASS);
      if (i === 0) addTip(el, '이 글의 [답글]을 누르세요');
    });
  }

  function startReplyPulseWatch() {
    stopReplyPulseWatch();
    highlightReplyOpenButtons();
    replyPulseTimer = setInterval(highlightReplyOpenButtons, 1800);
  }

  function stopReplyPulseWatch() {
    if (replyPulseTimer) {
      clearInterval(replyPulseTimer);
      replyPulseTimer = null;
    }
    document.querySelectorAll(`.${REPLY_PULSE_CLASS}`).forEach((el) => {
      el.classList.remove(REPLY_PULSE_CLASS);
      el.querySelector('.ss-fill-tip')?.remove();
    });
  }

  window.ssShowFillHowto = showFillHowto;
  window.ssHideFillHowto = clearHowto;
  window.ssConfirmBulkUpload = showBulkConfirm;
  window.ssShowFillBanner = (opts) =>
    showFillHowto({
      channel: opts?.channel || 'review',
      count: opts?.count || 0,
      hasBulk: false,
    });
  window.ssShowFillToast = showFillToast;
  window.ssHighlightConfirmButton = highlightConfirmButton;
  window.ssStartReplyPulseWatch = startReplyPulseWatch;
  window.ssStopReplyPulseWatch = stopReplyPulseWatch;
})();
