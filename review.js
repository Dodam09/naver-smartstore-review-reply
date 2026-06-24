const els = {
  list: document.getElementById('list'),
  statText: document.getElementById('statText'),
  banner: document.getElementById('banner'),
  saveDraftBtn: document.getElementById('saveDraftBtn'),
  confirmBtn: document.getElementById('confirmBtn'),
};

let draftItems = [];
let applyEnabled = false;
let saveTimer = null;

init();

async function init() {
  els.saveDraftBtn.addEventListener('click', () => saveDraft(true));
  els.confirmBtn.addEventListener('click', onConfirmAll);
  chrome.storage.onChanged.addListener(onStorageChanged);
  await loadAndRender();
}

async function loadAndRender() {
  const data = await storageGet([CONFIG.DRAFT_KEY, CONFIG.APPLY_ENABLED_KEY]);
  const draft = data[CONFIG.DRAFT_KEY];
  draftItems = draft?.items || [];
  applyEnabled = !!data[CONFIG.APPLY_ENABLED_KEY];

  if (!draftItems.length) {
    els.list.innerHTML =
      '<div class="empty">검토할 답글이 없습니다.<br>팝업에서 엑셀 업로드 후 답변 생성을 실행하세요.</div>';
    els.statText.textContent = '답글 0건';
    els.confirmBtn.disabled = true;
    showBanner('생성된 답글이 없습니다.', 'warn');
    return;
  }

  renderList();
  updateStat();
  updateBanner();
}

function renderList() {
  els.list.innerHTML = draftItems
    .map(
      (item, idx) => `
    <article class="card" data-idx="${idx}">
      <div class="card-head">
        <div class="card-id">리뷰글번호 ${escapeHtml(item.id)}</div>
        <div class="card-meta">
          ${item.rating ? `★ ${escapeHtml(item.rating)} · ` : ''}
          ${item.reviewType ? escapeHtml(item.reviewType) : ''}
        </div>
      </div>
      ${item.product ? `<div class="card-meta" style="text-align:left;margin-bottom:8px;">${escapeHtml(item.product)}</div>` : ''}
      <div class="review-box">${escapeHtml(item.reviewContent || '')}</div>
      <div class="reply-label">판매자 답글</div>
      <textarea class="reply-input" data-id="${escapeHtml(item.id)}" maxlength="1000">${escapeHtml(item.reply || '')}</textarea>
      <div class="char-count">${(item.reply || '').length} / 1000</div>
    </article>`
    )
    .join('');

  els.list.querySelectorAll('.reply-input').forEach((ta) => {
    ta.addEventListener('input', () => {
      const card = ta.closest('.card');
      const countEl = card.querySelector('.char-count');
      countEl.textContent = `${ta.value.length} / 1000`;
      scheduleSaveDraft();
    });
  });

  els.confirmBtn.disabled = false;
}

function collectItemsFromUi() {
  const map = new Map(draftItems.map((item) => [String(item.id), { ...item }]));
  els.list.querySelectorAll('.reply-input').forEach((ta) => {
    const id = ta.dataset.id;
    if (map.has(id)) {
      map.get(id).reply = ta.value.trim();
    }
  });
  return [...map.values()];
}

async function saveDraft(showMessage = false) {
  draftItems = collectItemsFromUi();
  const updates = {
    [CONFIG.DRAFT_KEY]: {
      items: draftItems,
      updatedAt: Date.now(),
    },
  };

  if (applyEnabled) {
    updates[CONFIG.APPLY_ENABLED_KEY] = false;
    applyEnabled = false;
    if (!showMessage) {
      showBanner('답글을 수정했습니다. 다시 [일괄 확인]을 눌러 적용하세요.', 'warn');
    }
  }

  await storageSet(updates);
  updateStat();

  if (showMessage) {
    showBanner('임시 저장했습니다.', 'info');
  }
}

function scheduleSaveDraft() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveDraft(false), 500);
}

async function onConfirmAll() {
  draftItems = collectItemsFromUi();

  const empty = draftItems.filter((item) => !item.reply?.trim());
  if (empty.length) {
    showBanner(
      `답글이 비어 있는 항목이 ${empty.length}건 있습니다. 모두 작성하거나 해당 항목을 수정하세요.`,
      'warn'
    );
    return;
  }

  const short = draftItems.filter((item) => item.reply.trim().length < 5);
  if (short.length) {
    showBanner(
      `답글이 5자 미만인 항목이 ${short.length}건 있습니다. 스마트스토어 최소 글자 수를 맞춰주세요.`,
      'warn'
    );
    return;
  }

  const replies = {};
  for (const item of draftItems) {
    replies[item.id] = item.reply.trim();
    replies[normalizeId(item.id)] = item.reply.trim();
  }

  await storageSet({
    [CONFIG.STORAGE_KEY]: replies,
    [CONFIG.DRAFT_KEY]: { items: draftItems, updatedAt: Date.now() },
    [CONFIG.APPLY_ENABLED_KEY]: true,
  });

  applyEnabled = true;
  updateStat();
  showBanner(
    `${draftItems.length}건 일괄 확인 완료. 이제 스마트스토어에서 리뷰 답글 팝업을 열면 자동으로 채워집니다.`,
    'success'
  );
}

function updateStat() {
  const total = draftItems.length;
  const filled = draftItems.filter((i) => i.reply?.trim()).length;
  const applyLabel = applyEnabled ? ' · 적용 활성화됨' : ' · 아직 미확인';
  els.statText.innerHTML = `총 <strong>${total}</strong>건 · 작성됨 ${filled}건${applyLabel}`;
}

function updateBanner() {
  if (applyEnabled) {
    showBanner('적용이 활성화되어 있습니다. 판매자센터 답글창에서 자동 입력됩니다.', 'success');
  } else {
    showBanner('답글을 검토·수정한 뒤 하단 [일괄 확인 및 적용 활성화]를 눌러주세요.', 'info');
  }
}

function onStorageChanged(changes, area) {
  if (area !== 'local') return;
  if (changes[CONFIG.DRAFT_KEY] || changes[CONFIG.APPLY_ENABLED_KEY]) {
    loadAndRender();
  }
}

function showBanner(message, type = 'info') {
  els.banner.hidden = false;
  els.banner.className = `banner ${type}`;
  els.banner.textContent = message;
}

function normalizeId(id) {
  return String(id).replace(/[^\d]/g, '');
}

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(data) {
  return new Promise((resolve) => chrome.storage.local.set(data, resolve));
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
