/**
 * First-run spotlight tour for the side panel.
 */
const ONBOARDING_TOUR_KEY = 'smartstoreOnboardingTourV1';

function storageGetTour(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (data) => resolve(data || {}));
  });
}

function storageSetTour(obj) {
  return new Promise((resolve) => {
    chrome.storage.local.set(obj, () => resolve());
  });
}

async function isOnboardingTourDone() {
  const data = await storageGetTour([ONBOARDING_TOUR_KEY]);
  return !!(data[ONBOARDING_TOUR_KEY]?.done);
}

async function markOnboardingTourDone() {
  await storageSetTour({
    [ONBOARDING_TOUR_KEY]: { done: true, finishedAt: Date.now() },
  });
}

async function resetOnboardingTour() {
  await storageSetTour({ [ONBOARDING_TOUR_KEY]: { done: false } });
}

function ensureOnboardingTourStyles() {
  let style = document.getElementById('onboarding-tour-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'onboarding-tour-style';
    document.head.appendChild(style);
  }
  style.textContent = `
.ob-root {
  position: fixed; inset: 0; z-index: 99999;
  pointer-events: none;
}
.ob-backdrop {
  position: absolute; inset: 0;
  background: transparent;
  pointer-events: none;
}
.ob-hole {
  position: absolute;
  border-radius: 4px;
  box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.48);
  outline: 1px solid #03c75a;
  outline-offset: 1px;
  pointer-events: none;
  transition: top .15s ease, left .15s ease, width .15s ease, height .15s ease;
}
.ob-card {
  position: absolute;
  width: min(268px, calc(100vw - 24px));
  background: #fff;
  color: #0f172a;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  padding: 12px 12px 10px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18);
  pointer-events: auto;
  z-index: 2;
}
.ob-step { margin: 0 0 4px; font-size: 11px; font-weight: 600; color: #64748b; letter-spacing: 0.02em; }
.ob-title { margin: 0 0 6px; font-size: 14px; font-weight: 700; line-height: 1.35; }
.ob-body { margin: 0 0 12px; font-size: 12px; line-height: 1.5; color: #475569; }
.ob-actions { display: flex; gap: 8px; align-items: center; }
.ob-actions .spacer { flex: 1; }
.ob-btn {
  border: 1px solid #cbd5e1; background: #fff; color: #0f172a;
  border-radius: 4px; padding: 7px 10px; font-size: 12px; font-weight: 600; cursor: pointer;
}
.ob-btn.primary { border-color: #03c75a; background: #03c75a; color: #fff; }
.ob-btn.ghost { border: none; background: transparent; color: #64748b; padding-left: 0; padding-right: 0; }
.ob-target-pulse {
  position: relative !important;
  z-index: 100000 !important;
  pointer-events: auto !important;
}
body.ob-tour-lock {
  overflow: hidden !important;
}
`;
}

function getOnboardingTourSteps() {
  return [
    {
      id: 'welcome',
      tab: 'work',
      panelMode: 'work',
      panelStep: 'fetch',
      selector: '[data-tour="tabs"]',
      title: '스마트스토어 AI 자동답글',
      body: '리뷰·상품문의 답글을 가져와, 내 말투로 AI가 작성합니다.',
      nextLabel: '시작',
    },
    {
      id: 'style',
      tab: 'work',
      panelMode: 'work',
      panelStep: 'fetch',
      selector: '[data-tour="review-style"]',
      title: '① 내 말투부터 만들기',
      body: '기존 답글로 말투를 분석하거나, 지침을 직접 작성할 수 있습니다.',
      nextLabel: '다음',
      requireClick: true,
      allowAction: true,
      clickHint: '「답변 스타일 설정」을 누르세요',
    },
    {
      id: 'fetch',
      tab: 'work',
      panelMode: 'work',
      panelStep: 'fetch',
      selector: '[data-tour="review-fetch"]',
      title: '② 답변할 리뷰 가져오기',
      body: '판매자센터 리뷰 관리를 연 뒤 가져오기를 누르면 목록이 들어옵니다.',
      nextLabel: '다음',
      requireClick: true,
      allowAction: true,
      waitFor: 'review-compose',
      clickHint: '「가져오기」를 누르세요',
      waitingHint: '리뷰를 가져오는 중… 완료되면 다음 단계로 이동합니다.',
    },
    {
      id: 'compose',
      tab: 'work',
      panelMode: 'work',
      panelStep: 'compose',
      selector: '[data-tour="review-compose"]',
      title: '③ 답글 만들기',
      body: '가져온 리뷰로 답글 작업 화면을 엽니다.',
      nextLabel: '다음',
      requireClick: true,
      allowAction: true,
      clickHint: '「답글 만들기 시작」을 누르세요',
    },
    {
      id: 'inquiry',
      tab: 'inquiry',
      panelMode: 'work',
      panelStep: 'fetch',
      selector: '[data-tour="inquiry-tab"]',
      title: '상품문의도 같은 흐름',
      body: '가져오기 → 말투/지침 → 답글 만들기 순서로 진행합니다.',
      nextLabel: '다음',
    },
    {
      id: 'login',
      tab: 'work',
      panelMode: 'work',
      panelStep: 'fetch',
      selector: '[data-tour="login-promo"], [data-tour="account-tab"]',
      title: '가입하면 10건 무료',
      body: 'AI 답글·말투 분석은 로그인 후 이용합니다. 카카오 가입 시 답글 10건·말투 분석 1회 무료.',
      nextLabel: '완료',
    },
  ];
}

function pickTourTarget(selector) {
  const parts = String(selector || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const part of parts) {
    const el = document.querySelector(part);
    if (!isTourTargetVisible(el)) continue;
    return el;
  }
  return null;
}

function isTourTargetVisible(el) {
  if (!el) return false;
  if (el.hidden) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const panel = el.closest('.panel');
  if (panel && !panel.classList.contains('active')) return false;
  const modePanel = el.closest('.mode-panel');
  if (modePanel && !modePanel.classList.contains('active')) return false;
  const step = el.closest('.panel-step');
  if (step && !step.classList.contains('active')) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  return true;
}

function scrollTourPanelsToTop() {
  document.querySelectorAll('.panel').forEach((panel) => {
    try {
      panel.scrollTop = 0;
    } catch (_) {}
  });
  try {
    window.scrollTo(0, 0);
  } catch (_) {}
}

function prepareTourHome() {
  if (typeof switchTab === 'function') switchTab('work');
  if (typeof setReviewPanelMode === 'function') setReviewPanelMode('work');
  if (typeof setReviewPanelStep === 'function') setReviewPanelStep('fetch');
  if (typeof setInquiryPanelMode === 'function') setInquiryPanelMode('work');
  if (typeof setInquiryPanelStep === 'function') setInquiryPanelStep('fetch');
  scrollTourPanelsToTop();
}

function applyTourStepContext(step) {
  if (!step) return;
  if (typeof switchTab === 'function' && step.tab) {
    switchTab(step.tab);
  }
  if (step.tab === 'work' || !step.tab) {
    if (typeof setReviewPanelMode === 'function') {
      setReviewPanelMode(step.panelMode || 'work');
    }
    if (typeof setReviewPanelStep === 'function' && step.panelStep) {
      setReviewPanelStep(step.panelStep);
    }
  }
  if (step.tab === 'inquiry') {
    if (typeof setInquiryPanelMode === 'function') {
      setInquiryPanelMode(step.panelMode || 'work');
    }
    if (typeof setInquiryPanelStep === 'function' && step.panelStep) {
      setInquiryPanelStep(step.panelStep);
    }
  }
  scrollTourPanelsToTop();
}

function revealTourTarget(el) {
  if (!el) return;
  try {
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
  } catch (_) {
    try {
      el.scrollIntoView(true);
    } catch (__) {}
  }
  const panel = el.closest('.panel');
  if (panel) {
    const panelRect = panel.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    if (elRect.top < panelRect.top || elRect.bottom > panelRect.bottom) {
      const delta = elRect.top - panelRect.top - panel.clientHeight / 3;
      panel.scrollTop += delta;
    }
  }
}

function waitTourLayout() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(resolve);
    });
  });
}

function placeTourCard(card, targetRect) {
  const pad = 12;
  const cardRect = card.getBoundingClientRect();
  let top = targetRect.bottom + 10;
  let left = Math.min(
    Math.max(pad, targetRect.left),
    window.innerWidth - cardRect.width - pad
  );
  if (top + cardRect.height > window.innerHeight - pad) {
    top = Math.max(pad, targetRect.top - cardRect.height - 10);
  }
  card.style.top = `${Math.round(top)}px`;
  card.style.left = `${Math.round(left)}px`;
}

function startOnboardingTour(options = {}) {
  ensureOnboardingTourStyles();
  const force = options.force === true;
  const steps = getOnboardingTourSteps();
  let index = 0;
  let root = null;
  let hole = null;
  let card = null;
  let currentTarget = null;
  let currentStep = null;
  let guardHandler = null;
  let resizeHandler = null;
  let renderToken = 0;
  let waitingForAction = false;
  let waitObserver = null;
  let waitTimer = null;

  document.querySelectorAll('.ob-root').forEach((el) => el.remove());

  function isHighlightedTarget(node) {
    return !!(
      currentTarget &&
      node &&
      (currentTarget === node || currentTarget.contains(node))
    );
  }

  function clearWaitWatch() {
    waitingForAction = false;
    if (waitObserver) {
      waitObserver.disconnect();
      waitObserver = null;
    }
    if (waitTimer) {
      clearInterval(waitTimer);
      waitTimer = null;
    }
  }

  function isWaitConditionMet(step) {
    if (!step?.waitFor) return true;
    if (step.waitFor === 'review-compose') {
      const el = document.querySelector('[data-tour="review-compose"]');
      return !!(el && isTourTargetVisible(el) && !el.disabled);
    }
    return false;
  }

  function showWaitingCard(step) {
    if (!card || !hole) return;
    hole.style.opacity = '0';
    card.innerHTML = `
      <div class="ob-step">${index + 1} / ${steps.length}</div>
      <div class="ob-title">${step.title}</div>
      <div class="ob-body">${step.waitingHint || '진행 중…'}</div>
      <div class="ob-actions">
        <button type="button" class="ob-btn ghost" data-ob="skip">건너뛰기</button>
        <span class="spacer"></span>
        <button type="button" class="ob-btn" data-ob="next-soft">다음</button>
      </div>
    `;
    card.style.top = '40%';
    card.style.left = '50%';
    card.style.transform = 'translate(-50%, -50%)';
    card.querySelector('[data-ob="skip"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      finish();
    });
    card.querySelector('[data-ob="next-soft"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      clearWaitWatch();
      index += 1;
      renderStep();
    });
  }

  function beginWaitForStep(step) {
    if (waitingForAction) return;
    waitingForAction = true;
    showWaitingCard(step);

    const finishWait = (ok) => {
      if (!waitingForAction) return;
      clearWaitWatch();
      if (ok) {
        index += 1;
        renderStep();
      } else {
        renderStep({ layoutOnly: true });
      }
    };

    if (isWaitConditionMet(step)) {
      finishWait(true);
      return;
    }

    waitObserver = new MutationObserver(() => {
      if (isWaitConditionMet(step)) finishWait(true);
    });
    waitObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });

    const started = Date.now();
    let sawFetchBusy = false;
    waitTimer = setInterval(() => {
      const fetchBtn = document.querySelector('[data-tour="review-fetch"]');
      if (fetchBtn?.disabled) sawFetchBusy = true;

      if (isWaitConditionMet(step)) {
        finishWait(true);
        return;
      }

      // 가져오기 실패/취소: 버튼이 다시 켜졌는데 compose로 안 넘어간 경우
      if (sawFetchBusy && fetchBtn && !fetchBtn.disabled && Date.now() - started > 600) {
        finishWait(false);
        return;
      }

      if (Date.now() - started > 90000) {
        finishWait(false);
      }
    }, 200);
  }

  function advanceFromTargetClick() {
    setTimeout(() => {
      index += 1;
      renderStep();
    }, 120);
  }

  function blockOutside(event) {
    if (waitingForAction) {
      const onCard = card && (card === event.target || card.contains(event.target));
      if (onCard) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }

    const onCard = card && (card === event.target || card.contains(event.target));
    const onTarget = isHighlightedTarget(event.target);

    if (onCard) return;

    if (onTarget && currentStep?.requireClick) {
      const allowAction = currentStep.allowAction !== false;
      if (!allowAction) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (event.type === 'click') advanceFromTargetClick();
        return;
      }
      if (event.type === 'click') {
        if (currentStep.waitFor) {
          beginWaitForStep(currentStep);
        } else {
          advanceFromTargetClick();
        }
      }
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function bindGuard() {
    unbindGuard();
    guardHandler = blockOutside;
    const types = [
      'click',
      'mousedown',
      'mouseup',
      'pointerdown',
      'pointerup',
      'touchstart',
      'touchend',
      'keydown',
      'contextmenu',
    ];
    types.forEach((type) => document.addEventListener(type, guardHandler, true));
  }

  function unbindGuard() {
    if (!guardHandler) return;
    const types = [
      'click',
      'mousedown',
      'mouseup',
      'pointerdown',
      'pointerup',
      'touchstart',
      'touchend',
      'keydown',
      'contextmenu',
    ];
    types.forEach((type) => document.removeEventListener(type, guardHandler, true));
    guardHandler = null;
  }

  function cleanupTarget() {
    if (currentTarget) currentTarget.classList.remove('ob-target-pulse');
    currentTarget = null;
    currentStep = null;
  }

  function destroy() {
    renderToken += 1;
    clearWaitWatch();
    cleanupTarget();
    unbindGuard();
    if (resizeHandler) {
      window.removeEventListener('resize', resizeHandler);
      resizeHandler = null;
    }
    document.body.classList.remove('ob-tour-lock');
    root?.remove();
    root = null;
  }

  async function finish() {
    await markOnboardingTourDone();
    destroy();
  }

  async function renderStep(opts = {}) {
    const layoutOnly = opts.layoutOnly === true;
    const token = ++renderToken;
    clearWaitWatch();
    cleanupTarget();
    const step = steps[index];
    if (!step) {
      finish();
      return;
    }
    currentStep = step;

    if (!layoutOnly) {
      applyTourStepContext(step);
      await waitTourLayout();
      if (token !== renderToken) return;
    }

    // Compose step needs imported rows; skip if unavailable.
    if (step.id === 'compose') {
      let composeBtn = document.querySelector('[data-tour="review-compose"]');
      if ((!composeBtn || composeBtn.disabled) && typeof parsedRows !== 'undefined' && parsedRows?.length) {
        if (typeof setReviewPanelStep === 'function') setReviewPanelStep('compose');
        await waitTourLayout();
        if (token !== renderToken) return;
        composeBtn = document.querySelector('[data-tour="review-compose"]');
      }
      if (!composeBtn || composeBtn.disabled || !isTourTargetVisible(composeBtn)) {
        index += 1;
        renderStep();
        return;
      }
    }

    // If fetch already done, jump straight to compose.
    if (step.id === 'fetch' && isWaitConditionMet({ waitFor: 'review-compose' })) {
      index += 1;
      renderStep();
      return;
    }

    let target = pickTourTarget(step.selector);
    if (!target) {
      index += 1;
      renderStep();
      return;
    }

    revealTourTarget(target);
    await waitTourLayout();
    if (token !== renderToken) return;

    target = pickTourTarget(step.selector) || target;
    if (!isTourTargetVisible(target)) {
      index += 1;
      renderStep();
      return;
    }

    currentTarget = target;
    target.classList.add('ob-target-pulse');
    const rect = target.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) {
      index += 1;
      renderStep();
      return;
    }

    if (hole) hole.style.opacity = '1';
    if (card) card.style.transform = '';

    const pad = 6;
    hole.style.top = `${Math.max(0, rect.top - pad)}px`;
    hole.style.left = `${Math.max(0, rect.left - pad)}px`;
    hole.style.width = `${rect.width + pad * 2}px`;
    hole.style.height = `${rect.height + pad * 2}px`;

    card.innerHTML = `
      <div class="ob-step">${index + 1} / ${steps.length}</div>
      <div class="ob-title">${step.title}</div>
      <div class="ob-body">${step.requireClick ? step.clickHint || step.body : step.body}</div>
      <div class="ob-actions">
        <button type="button" class="ob-btn ghost" data-ob="skip">건너뛰기</button>
        <span class="spacer"></span>
        <button type="button" class="ob-btn primary" data-ob="${step.requireClick ? 'next-soft' : 'next'}">${step.nextLabel || '다음'}</button>
      </div>
    `;
    placeTourCard(card, rect);

    card.querySelector('[data-ob="skip"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      finish();
    });
    card.querySelector('[data-ob="next"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      index += 1;
      renderStep();
    });
    card.querySelector('[data-ob="next-soft"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      index += 1;
      renderStep();
    });
  }

  return (async () => {
    if (!force && (await isOnboardingTourDone())) return false;

    destroy();
    prepareTourHome();
    await waitTourLayout();

    document.body.classList.add('ob-tour-lock');
    root = document.createElement('div');
    root.className = 'ob-root active';
    root.innerHTML = `
      <div class="ob-backdrop" aria-hidden="true"></div>
      <div class="ob-hole" aria-hidden="true"></div>
      <div class="ob-card" role="dialog" aria-modal="true"></div>
    `;
    document.body.appendChild(root);
    hole = root.querySelector('.ob-hole');
    card = root.querySelector('.ob-card');
    bindGuard();
    resizeHandler = () => {
      if (waitingForAction) return;
      renderStep({ layoutOnly: true });
    };
    window.addEventListener('resize', resizeHandler);
    await renderStep();
    return true;
  })();
}

async function startOnboardingTourIfNeeded() {
  try {
    return await startOnboardingTour({ force: false });
  } catch (err) {
    console.warn('온보딩 투어 실패:', err);
    return false;
  }
}
