const PARSE_CACHE_KEY = CONFIG.INQUIRY_PARSE_CACHE_KEY || 'smartstoreInquiryParseCache';
const DRAFT_KEY = CONFIG.INQUIRY_DRAFT_KEY || 'smartstoreInquiryDraft';
const STORAGE_KEY = CONFIG.INQUIRY_STORAGE_KEY || 'smartstoreInquiryReplies';
const APPLY_KEY = CONFIG.INQUIRY_APPLY_ENABLED_KEY || 'smartstoreInquiryApplyEnabled';
const PROGRESS_KEY = CONFIG.INQUIRY_PROGRESS_KEY || 'smartstoreInquiryJobProgress';
const REFERENCE_CACHE_KEY = CONFIG.INQUIRY_REFERENCE_CACHE_KEY || 'smartstoreInquiryReferenceCache';
const SETTINGS_KEY = CONFIG.SETTINGS_KEY;

const els = {
  tabSelect: document.getElementById('tabSelect'),
  tabReview: document.getElementById('tabReview'),
  reviewBadge: document.getElementById('reviewBadge'),
  panelSelect: document.getElementById('panelSelect'),
  panelReview: document.getElementById('panelReview'),
  selectToolbar: document.getElementById('selectToolbar'),
  reviewToolbar: document.getElementById('reviewToolbar'),
  selectList: document.getElementById('selectList'),
  reviewList: document.getElementById('reviewList'),
  banner: document.getElementById('banner'),
  totalCount: document.getElementById('totalCount'),
  selectedCount: document.getElementById('selectedCount'),
  fileName: document.getElementById('fileName'),
  draftTotal: document.getElementById('draftTotal'),
  draftFilled: document.getElementById('draftFilled'),
  applyStatus: document.getElementById('applyStatus'),
  footerCount: document.getElementById('footerCount'),
  footerSelect: document.getElementById('footerSelect'),
  footerReview: document.getElementById('footerReview'),
  reviewSummary: document.getElementById('reviewSummary'),
  generateBtn: document.getElementById('generateBtn'),
  stopBtn: document.getElementById('stopBtn'),
  saveDraftBtn: document.getElementById('saveDraftBtn'),
  confirmBtn: document.getElementById('confirmBtn'),
  genProgress: document.getElementById('genProgress'),
  genStatusText: document.getElementById('genStatusText'),
  genCountText: document.getElementById('genCountText'),
  genProgressFill: document.getElementById('genProgressFill'),
  genSubText: document.getElementById('genSubText'),
  searchInput: document.getElementById('searchInput'),
  selectAllBtn: document.getElementById('selectAllBtn'),
  selectNoneBtn: document.getElementById('selectNoneBtn'),
  selectVisibleBtn: document.getElementById('selectVisibleBtn'),
  useReferenceToggle: document.getElementById('useReferenceToggle'),
  referenceCount: document.getElementById('referenceCount'),
  referenceDaysSelect: document.getElementById('referenceDaysSelect'),
  refreshReferenceBtn: document.getElementById('refreshReferenceBtn'),
  referencePanel: document.getElementById('referencePanel'),
  referenceSearchInput: document.getElementById('referenceSearchInput'),
  referenceSelectAllBtn: document.getElementById('referenceSelectAllBtn'),
  referenceSelectNoneBtn: document.getElementById('referenceSelectNoneBtn'),
  referenceList: document.getElementById('referenceList'),
  referenceSelectedCount: document.getElementById('referenceSelectedCount'),
  referenceTotalCount: document.getElementById('referenceTotalCount'),
};

let parsedRows = [];
let selectedIds = new Set();
let parseMeta = {};
let filterText = '';
let isGenerating = false;
let lastHandledFinishedAt = null;
let draftItems = [];
let applyEnabled = false;
let saveTimer = null;
let activeTab = 'select';
let referenceCount = 0;
let referenceCatalog = [];
let selectedReferenceIds = new Set();
let referenceFilterText = '';
let generationPending = false;
let generationPendingTotal = 0;
let lastReferenceHintCount = null;

init();

async function init() {
  els.selectAllBtn.addEventListener('click', () => {
    selectedIds = new Set(parsedRows.map((r) => r.id));
    renderSelect();
    saveSelection();
  });
  els.selectNoneBtn.addEventListener('click', () => {
    selectedIds.clear();
    renderSelect();
    saveSelection();
  });
  els.selectVisibleBtn.addEventListener('click', () => {
    getFilteredRows().forEach((row) => selectedIds.add(row.id));
    renderSelect();
    saveSelection();
  });
  els.searchInput.addEventListener('input', () => {
    filterText = els.searchInput.value.trim().toLowerCase();
    renderSelect();
  });
  els.generateBtn.addEventListener('click', onGenerate);
  els.stopBtn.addEventListener('click', onStopGenerate);
  els.tabSelect.addEventListener('click', () => switchTab('select'));
  els.tabReview.addEventListener('click', () => switchTab('review'));
  els.saveDraftBtn.addEventListener('click', () => saveDraft(true));
  els.confirmBtn.addEventListener('click', onConfirmAll);
  els.useReferenceToggle.addEventListener('change', () => {
    saveReferencePreference();
    syncReferencePanelVisibility();
  });
  els.referenceDaysSelect.addEventListener('change', saveReferencePreference);
  els.refreshReferenceBtn.addEventListener('click', onRefreshReference);
  els.referenceSearchInput.addEventListener('input', () => {
    referenceFilterText = els.referenceSearchInput.value.trim().toLowerCase();
    renderReferenceList();
  });
  els.referenceSelectAllBtn.addEventListener('click', () => {
    referenceCatalog.forEach((item) => selectedReferenceIds.add(String(item.id)));
    saveReferenceCache();
    renderReferenceList();
  });
  els.referenceSelectNoneBtn.addEventListener('click', () => {
    selectedReferenceIds.clear();
    saveReferenceCache();
    renderReferenceList();
  });

  chrome.storage.onChanged.addListener(onStorageChanged);
  await loadReferenceCount();
  await loadData();
  refreshJobStatus();
  setInterval(refreshJobStatus, 2000);

  if (location.hash === '#review') switchTab('review');
}

function switchTab(tab) {
  activeTab = tab;
  const isSelect = tab === 'select';

  els.tabSelect.classList.toggle('active', isSelect);
  els.tabReview.classList.toggle('active', !isSelect);
  els.panelSelect.classList.toggle('active', isSelect);
  els.panelReview.classList.toggle('active', !isSelect);
  els.selectToolbar.hidden = !isSelect;
  els.reviewToolbar.hidden = isSelect;
  els.footerSelect.classList.toggle('hidden', !isSelect);
  els.footerReview.classList.toggle('active', !isSelect);
  els.banner.hidden = isSelect;

  if (isSelect) {
    location.hash = '';
    renderSelect();
  } else {
    location.hash = 'review';
    loadDraftAndRender();
  }
  syncReferencePanelVisibility();
}

async function loadData() {
  const data = await storageGet([
    PARSE_CACHE_KEY,
    SETTINGS_KEY,
    DRAFT_KEY,
    APPLY_KEY,
    REFERENCE_CACHE_KEY,
  ]);
  const cache = data[PARSE_CACHE_KEY];
  const settings = data[SETTINGS_KEY] || {};

  draftItems = data[DRAFT_KEY]?.items || [];
  applyEnabled = !!data[APPLY_KEY];
  els.useReferenceToggle.checked = settings.inquiryUseReference !== false;
  renderLookupDayOptions(els.referenceDaysSelect, {
    includeLong: true,
    selected: settings.inquiryReferenceDays ?? 7,
  });
  updateReviewBadge();
  applyReferenceCache(data[REFERENCE_CACHE_KEY]);
  syncReferencePanelVisibility();

  if (!cache?.inquiryRows?.length) {
    els.selectList.innerHTML =
      '<div class="empty">가져온 상품문의가 없습니다.<br>확장 팝업 <strong>문의</strong> 탭에서 <strong>판매자센터 가져오기</strong>를 하세요.</div>';
    updateSelectCounts();
    return;
  }

  parsedRows = cache.inquiryRows;
  parseMeta = {
    fileName: cache.sourceLabel || cache.statusMessage || '판매자센터',
  };
  selectedIds = new Set(cache.selectedIds || parsedRows.map((r) => r.id));
  renderSelect();
}

async function loadDraftAndRender() {
  const data = await storageGet([DRAFT_KEY, APPLY_KEY]);
  draftItems = data[DRAFT_KEY]?.items || [];
  applyEnabled = !!data[APPLY_KEY];
  updateReviewBadge();
  renderReview();
}

async function loadReferenceCount() {
  const data = await storageGet([REFERENCE_CACHE_KEY]);
  applyReferenceCache(data[REFERENCE_CACHE_KEY]);
  syncReferencePanelVisibility();
}

function applyReferenceCache(cache) {
  referenceCatalog = Array.isArray(cache?.catalog) ? cache.catalog : [];
  const validIds = new Set(referenceCatalog.map((item) => String(item.id)));
  const savedIds = (cache?.selectedIds || []).map(String).filter((id) => validIds.has(id));

  if (savedIds.length) {
    selectedReferenceIds = new Set(savedIds);
  } else if (referenceCatalog.length) {
    selectedReferenceIds = new Set(referenceCatalog.map((item) => String(item.id)));
  } else {
    selectedReferenceIds = new Set();
  }

  updateReferenceCountLabel(cache);
  renderReferenceList();
}

function syncReferencePanelVisibility() {
  const visible =
    !!els.useReferenceToggle.checked && referenceCatalog.length > 0 && activeTab === 'select';
  els.referencePanel.hidden = !visible;
}

function updateReferenceCountLabel(cache) {
  const total = referenceCatalog.length || cache?.catalog?.length || cache?.withAnswerCount || 0;
  const selected = selectedReferenceIds.size;
  referenceCount = selected;
  els.referenceCount.textContent =
    total > 0 ? `참고 ${selected}/${total}건 선택` : '참고 답변 0건';
  if (els.referenceSelectedCount) els.referenceSelectedCount.textContent = String(selected);
  if (els.referenceTotalCount) els.referenceTotalCount.textContent = String(total);
}

async function saveReferenceCache() {
  const data = await storageGet([REFERENCE_CACHE_KEY]);
  const cache = data[REFERENCE_CACHE_KEY] || {};
  const nextCache = {
    ...cache,
    catalog: referenceCatalog,
    selectedIds: [...selectedReferenceIds],
    withAnswerCount: referenceCatalog.length,
  };
  await storageSet({ [REFERENCE_CACHE_KEY]: nextCache });
  updateReferenceCountLabel(nextCache);
}

function getFilteredReferenceRows() {
  if (!referenceFilterText) return referenceCatalog;
  return referenceCatalog.filter((item) => {
    const haystack = [
      item.id,
      item.product,
      item.question,
      item.content,
      item.answer,
      item.reply,
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(referenceFilterText);
  });
}

function toggleReferenceId(id, checked) {
  const key = String(id);
  const shouldSelect = typeof checked === 'boolean' ? checked : !selectedReferenceIds.has(key);
  if (shouldSelect) selectedReferenceIds.add(key);
  else selectedReferenceIds.delete(key);
  saveReferenceCache();
  renderReferenceList();
}

function renderReferenceList() {
  if (!els.referenceList) return;

  const rows = getFilteredReferenceRows();
  els.referenceSelectedCount.textContent = String(selectedReferenceIds.size);
  els.referenceTotalCount.textContent = String(referenceCatalog.length);

  if (!referenceCatalog.length) {
    els.referenceList.innerHTML =
      '<div class="ref-empty">[기존 답변 불러오기]를 눌러 참고 목록을 가져오세요.</div>';
    return;
  }

  if (!rows.length) {
    els.referenceList.innerHTML = '<div class="ref-empty">검색 결과가 없습니다.</div>';
    return;
  }

  els.referenceList.innerHTML = rows
    .map((item) => {
      const id = String(item.id);
      const selected = selectedReferenceIds.has(id);
      const question = item.question || item.content || '';
      const answer = item.answer || item.reply || '';
      return `
        <article class="ref-card ${selected ? 'selected' : ''}" data-id="${escapeHtml(id)}">
          <input type="checkbox" class="ref-card-check" data-id="${escapeHtml(id)}" ${selected ? 'checked' : ''} />
          <div class="ref-card-body">
            <div class="ref-card-top">
              <div class="ref-card-id">#${escapeHtml(id)}</div>
            </div>
            ${item.product ? `<div class="ref-card-product">${escapeHtml(item.product)}</div>` : ''}
            <div class="ref-q"><span class="ref-q-label">문의</span>${escapeHtml(question)}</div>
            <div class="ref-a"><span class="ref-a-label">답변</span>${escapeHtml(answer)}</div>
          </div>
        </article>`;
    })
    .join('');

  els.referenceList.querySelectorAll('.ref-card').forEach((card) => {
    card.addEventListener('click', (event) => {
      if (event.target.classList.contains('ref-card-check')) return;
      toggleReferenceId(card.dataset.id);
    });
  });

  els.referenceList.querySelectorAll('.ref-card-check').forEach((cb) => {
    cb.addEventListener('click', (event) => event.stopPropagation());
    cb.addEventListener('change', () => toggleReferenceId(cb.dataset.id, cb.checked));
  });
}

async function saveReferencePreference() {
  const existing = (await storageGet([SETTINGS_KEY]))[SETTINGS_KEY] || {};
  await storageSet({
    [SETTINGS_KEY]: {
      ...existing,
      inquiryUseReference: !!els.useReferenceToggle.checked,
      inquiryReferenceDays: clampLookupDays(els.referenceDaysSelect.value, {
        min: 0,
        max: 365,
        fallback: 7,
      }),
    },
  });
}

function getReferenceDays() {
  return clampLookupDays(els.referenceDaysSelect.value, { min: 0, max: 365, fallback: 7 });
}

async function onRefreshReference() {
  els.refreshReferenceBtn.disabled = true;
  els.refreshReferenceBtn.textContent = '불러오는 중...';
  try {
    const days = getReferenceDays();
    const response = await sendRuntimeMessage({
      type: 'FETCH_INQUIRY_REPLY_CATALOG_JOB',
      payload: { days, maxItems: 80 },
    });
    referenceCatalog = response.catalog || [];
    selectedReferenceIds = new Set(referenceCatalog.map((item) => String(item.id)));
    await saveReferenceCache();
    syncReferencePanelVisibility();
    showBanner(
      `${formatLookupDaysLabel(days)} 기존 답변 문의 ${referenceCatalog.length}건을 불러왔습니다. 참고할 항목을 선택하세요.`,
      'success'
    );
  } catch (err) {
    showBanner(`기존 답변 불러오기 실패: ${err.message}`, 'warn');
  } finally {
    els.refreshReferenceBtn.disabled = false;
    els.refreshReferenceBtn.textContent = '기존 답변 불러오기';
  }
}

function getFilteredRows() {
  if (!filterText) return parsedRows;
  return parsedRows.filter((row) => {
    const haystack = [row.id, row.content, row.product, row.writer].join(' ').toLowerCase();
    return haystack.includes(filterText);
  });
}

function renderSelect() {
  const rows = getFilteredRows();

  if (!parsedRows.length) {
    els.selectList.innerHTML =
      '<div class="empty">가져온 상품문의가 없습니다.<br>확장 팝업 <strong>문의</strong> 탭에서 가져오기를 하세요.</div>';
    updateSelectCounts();
    return;
  }

  if (!rows.length) {
    els.selectList.innerHTML = '<div class="empty">검색 결과가 없습니다.</div>';
    updateSelectCounts();
    return;
  }

  els.selectList.innerHTML = rows
    .map((row) => {
      const selected = selectedIds.has(row.id);
      return `
        <article class="card selectable ${selected ? 'selected' : ''}" data-id="${escapeHtml(row.id)}">
          <input type="checkbox" class="card-check" data-id="${escapeHtml(row.id)}" ${selected ? 'checked' : ''} />
          <div class="card-body">
            <div class="card-top">
              <div class="card-id">#${escapeHtml(row.id)}</div>
              <div class="card-badges">
                ${row.secret ? '<span class="badge secret">비밀</span>' : ''}
                ${row.writer ? `<span class="badge">${escapeHtml(row.writer)}</span>` : ''}
              </div>
            </div>
            ${row.product ? `<div class="card-product">${escapeHtml(row.product)}</div>` : ''}
            <div class="card-content">${escapeHtml(row.content)}</div>
          </div>
        </article>`;
    })
    .join('');

  els.selectList.querySelectorAll('.card').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('card-check')) return;
      toggleId(card.dataset.id);
    });
  });

  els.selectList.querySelectorAll('.card-check').forEach((cb) => {
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', () => toggleId(cb.dataset.id, cb.checked));
  });

  updateSelectCounts();
}

function renderReview() {
  if (!draftItems.length) {
    els.reviewList.innerHTML =
      '<div class="empty">생성된 답글이 없습니다.<br>「1. 문의 선택」 탭에서 답변을 생성하세요.</div>';
    els.confirmBtn.disabled = true;
    updateReviewStats();
    return;
  }

  els.reviewList.innerHTML = draftItems
    .map((item) => {
      const refHint =
        item.referenceIds?.length > 0
          ? `<div class="ref-hint">기존 답변 문의 ${item.referenceIds.length}건을 참고해 생성됨</div>`
          : '';
      return `
    <article class="card review-card" data-id="${escapeHtml(item.id)}">
      <div class="card-top">
        <div class="card-id">#${escapeHtml(item.id)}</div>
        <div class="card-badges">
          ${item.secret ? '<span class="badge secret">비밀</span>' : ''}
        </div>
      </div>
      ${item.product ? `<div class="card-product">${escapeHtml(item.product)}</div>` : ''}
      <div class="inquiry-box">${escapeHtml(item.inquiryContent || '')}</div>
      ${refHint}
      <div class="reply-label">판매자 답글</div>
      <textarea class="reply-input" data-id="${escapeHtml(item.id)}" maxlength="2000">${escapeHtml(item.reply || '')}</textarea>
      <div class="char-count">${(item.reply || '').length} / 2000</div>
    </article>`;
    })
    .join('');

  els.reviewList.querySelectorAll('.reply-input').forEach((ta) => {
    ta.addEventListener('input', () => {
      ta.closest('.card').querySelector('.char-count').textContent = `${ta.value.length} / 2000`;
      scheduleSaveDraft();
      updateReviewStatsFromUi();
    });
  });

  els.confirmBtn.disabled = false;
  updateReviewStats();
  updateReviewBanner();
}

function toggleId(id, forceChecked) {
  const shouldSelect = forceChecked !== undefined ? forceChecked : !selectedIds.has(id);
  if (shouldSelect) selectedIds.add(id);
  else selectedIds.delete(id);
  renderSelect();
  saveSelection();
}

function updateSelectCounts() {
  const selected = selectedIds.size;
  els.totalCount.textContent = String(parsedRows.length);
  els.selectedCount.textContent = String(selected);
  els.footerCount.textContent = String(selected);
  els.fileName.textContent =
    parseMeta.fileName && parseMeta.fileName.length > 18
      ? `${parseMeta.fileName.slice(0, 16)}…`
      : parseMeta.fileName || '-';
  els.generateBtn.textContent = `선택한 ${selected}건 답변 생성`;
  els.generateBtn.disabled = isGenerating || selected === 0;
  els.stopBtn.hidden = !isGenerating;
  els.stopBtn.disabled = !isGenerating;
}

function updateReviewBadge() {
  const count = draftItems.length;
  els.reviewBadge.textContent = String(count);
  els.reviewBadge.hidden = count === 0;
}

function updateReviewStats() {
  const total = draftItems.length;
  const filled = draftItems.filter((i) => i.reply?.trim()).length;
  els.draftTotal.textContent = String(total);
  els.draftFilled.textContent = String(filled);
  els.applyStatus.textContent = applyEnabled ? '활성화됨' : '미활성';
  els.applyStatus.style.color = applyEnabled ? '#0a7a3f' : '#333';

  if (applyEnabled) {
    els.reviewSummary.textContent = '자동 입력 모드 — 판매자센터에서 [답글]을 누르면 textarea에 채워집니다.';
  } else if (filled === total && total > 0) {
    els.reviewSummary.textContent = '답글 확인 후 [자동 입력 모드 활성화]를 누르세요.';
  } else {
    els.reviewSummary.textContent = '답글을 확인·수정한 뒤 자동 입력을 활성화하세요.';
  }
}

function updateReviewStatsFromUi() {
  const inputs = els.reviewList.querySelectorAll('.reply-input');
  const filled = [...inputs].filter((ta) => ta.value.trim()).length;
  els.draftFilled.textContent = String(filled);
}

function collectItemsFromUi() {
  const map = new Map(draftItems.map((item) => [String(item.id), { ...item }]));
  els.reviewList.querySelectorAll('.reply-input').forEach((ta) => {
    const id = ta.dataset.id;
    if (map.has(id)) map.get(id).reply = ta.value.trim();
  });
  return [...map.values()];
}

async function saveDraft(showMessage = false) {
  if (!draftItems.length) return;
  draftItems = collectItemsFromUi();
  const replies = {};
  for (const item of draftItems) {
    replies[item.id] = item.reply || '';
    replies[normalizeId(item.id)] = item.reply || '';
  }

  const updates = {
    [DRAFT_KEY]: { items: draftItems, updatedAt: Date.now() },
    [STORAGE_KEY]: replies,
  };

  if (applyEnabled) {
    updates[APPLY_KEY] = false;
    applyEnabled = false;
    if (!showMessage) {
      showBanner('답글을 수정했습니다. 다시 [자동 입력 모드 활성화]를 눌러주세요.', 'warn');
    }
  }

  await storageSet(updates);
  updateReviewStats();
  updateReviewBadge();
  if (showMessage) showBanner('임시 저장했습니다.', 'info');
}

function scheduleSaveDraft() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveDraft(false), 500);
}

async function onConfirmAll() {
  draftItems = collectItemsFromUi();

  const empty = draftItems.filter((item) => !item.reply?.trim());
  if (empty.length) {
    showBanner(`답글이 비어 있는 항목이 ${empty.length}건 있습니다.`, 'warn');
    return;
  }

  const replies = {};
  for (const item of draftItems) {
    replies[item.id] = item.reply.trim();
    replies[normalizeId(item.id)] = item.reply.trim();
  }

  await storageSet({
    [STORAGE_KEY]: replies,
    [DRAFT_KEY]: { items: draftItems, updatedAt: Date.now() },
    [APPLY_KEY]: true,
  });

  applyEnabled = true;
  updateReviewStats();
  showBanner(
    `${draftItems.length}건 자동 입력 모드 활성화.\n판매자센터 상품문의에서 [답글]을 누르면 textarea에 채워집니다.`,
    'info'
  );
}

function updateReviewBanner() {
  if (activeTab !== 'review') return;
  if (applyEnabled) {
    showBanner('자동 입력 모드 — [답글] 클릭 시 textarea에 채워집니다.', 'info');
  } else if (draftItems.length) {
    showBanner('답글 확인 후 [자동 입력 모드 활성화]를 누르세요.', 'info');
  }
}

function showBanner(message, type = 'info') {
  els.banner.hidden = false;
  els.banner.className = `banner ${type}`;
  els.banner.textContent = message;
}

async function saveSelection() {
  const data = await storageGet(PARSE_CACHE_KEY);
  const cache = data[PARSE_CACHE_KEY];
  if (!cache) return;
  await storageSet({
    [PARSE_CACHE_KEY]: {
      ...cache,
      selectedIds: [...selectedIds],
    },
  });
}

async function onGenerate() {
  const selectedRows = parsedRows.filter((row) => selectedIds.has(row.id));
  if (!selectedRows.length) return;

  const settingsData = await storageGet(SETTINGS_KEY);
  const settings = settingsData[SETTINGS_KEY] || {};
  const apiKey = settings.apiKey || CONFIG.GEMINI_API_KEY;

  if (!apiKey || apiKey.includes('YOUR_GEMINI')) {
    showProgress('Gemini API 키가 없습니다. 확장 팝업 [설정] 탭에서 입력하세요.', true);
    return;
  }

  if (els.useReferenceToggle.checked && referenceCatalog.length && selectedReferenceIds.size === 0) {
    showBanner('참고할 기존 답변을 1건 이상 선택하세요.', 'warn');
    return;
  }

  const job = await getJobStatus();
  if (job?.status === 'running') {
    showRunningProgress(job.current || 0, job.total || 0, job.currentId || '', job.message || '이미 생성 중입니다.');
    return;
  }

  isGenerating = true;
  generationPending = true;
  generationPendingTotal = selectedRows.length;
  lastReferenceHintCount = null;
  updateSelectCounts();
  showRunningProgress(0, selectedRows.length, '', '답변 생성을 시작합니다...');

  chrome.runtime.sendMessage(
    {
      type: 'START_GENERATE_INQUIRIES',
      payload: {
        rows: selectedRows,
        apiKey,
        systemPrompt: settings.inquirySystemPrompt || '',
        model: CONFIG.GEMINI_MODEL,
        useReference: !!els.useReferenceToggle.checked,
        referenceDays: getReferenceDays(),
        referenceSelectedIds: [...selectedReferenceIds],
      },
    },
    (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
        generationPending = false;
        isGenerating = false;
        updateSelectCounts();
        showProgress(response?.error || chrome.runtime.lastError?.message || '시작 실패', true);
        return;
      }
      refreshJobStatus();
    }
  );
}

function onStopGenerate() {
  if (!isGenerating) return;
  els.stopBtn.disabled = true;
  els.stopBtn.textContent = '중지 중...';
  chrome.runtime.sendMessage({ type: 'STOP_GENERATE_INQUIRIES' }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      els.stopBtn.disabled = false;
      els.stopBtn.textContent = '생성 중지';
      showProgress(response?.error || chrome.runtime.lastError?.message || '중지 실패', true);
      return;
    }
    refreshJobStatus();
  });
}

function resetGenProgressUi() {
  els.genProgress.classList.add('hidden');
  els.genProgress.classList.remove('success', 'error', 'stopped');
  els.genStatusText.textContent = '답변 생성 중';
  els.genCountText.textContent = '0 / 0';
  els.genProgressFill.style.width = '0%';
  els.genSubText.textContent = '';
}

function refreshJobStatus() {
  chrome.runtime.sendMessage({ type: 'GET_INQUIRY_JOB_STATUS' }, async (response) => {
    if (chrome.runtime.lastError) return;
    const job = response?.job;
    const activelyRunning = response?.isRunning;

    if (job?.status === 'running' && activelyRunning) {
      generationPending = false;
      isGenerating = true;
      showRunningProgress(
        job.current || 0,
        job.total || 0,
        job.currentId || '',
        job.message || '답변 생성 중...'
      );
      if (job.referenceCount != null && els.useReferenceToggle.checked) {
        if (lastReferenceHintCount !== job.referenceCount) {
          lastReferenceHintCount = job.referenceCount;
          const base = job.currentId
            ? `문의번호 ${job.currentId} 처리 중...`
            : job.message || '답변 생성 중...';
          els.genSubText.textContent = `${base}\n선택한 참고 답변 ${job.referenceCount}건 사용`;
        }
      }
      els.generateBtn.textContent = `생성 중 (${job.current || 0}/${job.total || '?'})`;
      els.generateBtn.disabled = true;
      els.stopBtn.hidden = false;
      return;
    }

    if (generationPending && (!job || job.status !== 'running')) {
      isGenerating = true;
      showRunningProgress(
        0,
        generationPendingTotal,
        '',
        '답변 생성 준비 중...'
      );
      els.generateBtn.disabled = true;
      els.stopBtn.hidden = false;
      return;
    }

    generationPending = false;
    lastReferenceHintCount = null;
    isGenerating = false;
    resetGenProgressUi();
    els.stopBtn.hidden = true;
    els.stopBtn.disabled = false;
    els.stopBtn.textContent = '생성 중지';
    updateSelectCounts();

    if (!job) return;

    if (job.status === 'done' || job.status === 'stopped') {
      if (job.finishedAt !== lastHandledFinishedAt) {
        lastHandledFinishedAt = job.finishedAt;
        if (job.status === 'stopped') showStoppedProgress(job);
        else showDoneProgress(job);
        await loadDraftAndRender();
        switchTab('review');
      }
    } else if (job.status === 'error') {
      if (job.finishedAt !== lastHandledFinishedAt) {
        lastHandledFinishedAt = job.finishedAt;
        showProgress(job.message || '오류가 발생했습니다.', true);
      }
    }
  });
}

function onStorageChanged(changes, area) {
  if (area !== 'local') return;
  if (changes[PARSE_CACHE_KEY]) loadData();
  if (changes[DRAFT_KEY] || changes[APPLY_KEY]) {
    loadDraftAndRender();
    if (activeTab === 'review') renderReview();
  }
  if (changes[REFERENCE_CACHE_KEY]) {
    applyReferenceCache(changes[REFERENCE_CACHE_KEY].newValue);
    syncReferencePanelVisibility();
  }
  if (changes[PROGRESS_KEY]) refreshJobStatus();
}

function showRunningProgress(current, total, currentId, message) {
  els.genProgress.classList.remove('hidden', 'success', 'error', 'stopped');
  els.genStatusText.textContent = '답변 생성 중';
  els.genCountText.textContent = `${current} / ${total}`;
  els.genProgressFill.style.width = `${total > 0 ? Math.round((current / total) * 100) : 0}%`;
  els.genSubText.textContent = currentId ? `문의번호 ${currentId} 처리 중...` : message;
}

function showDoneProgress(job) {
  els.genProgress.classList.remove('hidden', 'error', 'stopped');
  els.genProgress.classList.add('success');
  els.genStatusText.textContent = '생성 완료';
  els.genCountText.textContent = `${job.success ?? 0} / ${job.total ?? 0}`;
  els.genProgressFill.style.width = '100%';
  els.genSubText.textContent = `${job.success ?? 0}건 완료 · 검토 탭에서 확인·수정하세요`;
}

function showStoppedProgress(job) {
  els.genProgress.classList.remove('hidden', 'error', 'success');
  els.genProgress.classList.add('stopped');
  els.genStatusText.textContent = '생성 중지됨';
  els.genCountText.textContent = `${job.success ?? 0} / ${job.total ?? 0}`;
  els.genSubText.textContent = `저장 ${job.success ?? 0}건 — 검토 탭에서 확인하세요`;
}

function showProgress(message, isError = false) {
  els.genProgress.classList.remove('hidden', 'success', 'error', 'stopped');
  els.genProgress.classList.add(isError ? 'error' : 'success');
  els.genStatusText.textContent = isError ? '오류' : '알림';
  els.genCountText.textContent = '';
  els.genProgressFill.style.width = isError ? '0%' : '100%';
  els.genSubText.textContent = message;
}

function getJobStatus() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_INQUIRY_JOB_STATUS' }, (response) => {
      resolve(response?.job || null);
    });
  });
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        const raw = chrome.runtime.lastError.message || '';
        if (/message port closed/i.test(raw)) {
          reject(
            new Error(
              '확장 프로그램과 판매자센터 탭 연결이 끊어졌습니다.\n' +
                'chrome://extensions 에서 확장 새로고침 → 상품문의 페이지 F5 후 다시 시도하세요.'
            )
          );
          return;
        }
        reject(new Error(raw));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || '요청 실패'));
        return;
      }
      resolve(response);
    });
  });
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
