const PARSE_CACHE_KEY = CONFIG.INQUIRY_PARSE_CACHE_KEY || 'smartstoreInquiryParseCache';
const DRAFT_KEY = CONFIG.INQUIRY_DRAFT_KEY || 'smartstoreInquiryDraft';
const STORAGE_KEY = CONFIG.INQUIRY_STORAGE_KEY || 'smartstoreInquiryReplies';
const APPLY_KEY = CONFIG.INQUIRY_APPLY_ENABLED_KEY || 'smartstoreInquiryApplyEnabled';
const PROGRESS_KEY = CONFIG.INQUIRY_PROGRESS_KEY || 'smartstoreInquiryJobProgress';
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
  inquiryStyleLabel: document.getElementById('inquiryStyleLabel'),
  inquiryStyleHint: document.getElementById('inquiryStyleHint'),
  inquiryStyleRow: document.getElementById('inquiryStyleRow'),
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

  chrome.storage.onChanged.addListener(onStorageChanged);
  await loadData();
  refreshJobStatus();
  setInterval(refreshJobStatus, 2000);

  if (location.hash === '#review' && draftItems.length) switchTab('review');
  else els.tabReview.classList.toggle('locked', !draftItems.length);
}

function switchTab(tab) {
  if (tab === 'review' && !draftItems.length) {
    showBanner('먼저 ①에서 문의를 고르고 「AI로 답글 만들기」를 누르세요.', 'warn');
    return;
  }

  activeTab = tab;
  const isSelect = tab === 'select';

  els.tabSelect.classList.toggle('active', isSelect);
  els.tabReview.classList.toggle('active', !isSelect);
  els.tabReview.classList.toggle('locked', !draftItems.length);
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
    loadDraftAndRender().then(() => updateReviewBanner());
  }
}

async function loadData() {
  const data = await storageGet([PARSE_CACHE_KEY, SETTINGS_KEY, DRAFT_KEY, APPLY_KEY]);
  const cache = data[PARSE_CACHE_KEY];
  const settings = data[SETTINGS_KEY] || {};

  draftItems = data[DRAFT_KEY]?.items || [];
  applyEnabled = !!data[APPLY_KEY];
  updateReviewBadge();
  els.tabReview.classList.toggle('locked', !draftItems.length);
  updateInquiryStyleLabel(settings);

  if (!cache?.inquiryRows?.length) {
    els.selectList.innerHTML =
      '<div class="empty">아직 문의가 없어요.<br>확장 아이콘 → <strong>상품문의</strong> 탭에서 「가져오기」를 먼저 하세요.</div>';
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
  els.tabReview.classList.toggle('locked', !draftItems.length);
  renderReview();
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
      '<div class="empty">아직 문의가 없어요.<br>확장 아이콘 → <strong>상품문의</strong> 탭에서 「가져오기」를 먼저 하세요.</div>';
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
      '<div class="empty">아직 만든 답글이 없어요.<br>① 「AI로 답글 만들기」를 먼저 누르세요.</div>';
    els.confirmBtn.disabled = true;
    updateReviewStats();
    return;
  }

  els.reviewList.innerHTML = draftItems
    .map((item) => {
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
  els.generateBtn.textContent = selected > 0 ? `AI로 답글 만들기 (${selected}건)` : 'AI로 답글 만들기';
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
  els.applyStatus.textContent = applyEnabled ? '준비됨' : '아직';
  els.applyStatus.style.color = applyEnabled ? '#0a7a3f' : '#333';

  if (applyEnabled) {
    els.reviewSummary.textContent = '준비됐어요. 판매자센터 상품문의에서 [답글]만 누르면 자동으로 채워집니다.';
  } else if (filled === total && total > 0) {
    els.reviewSummary.textContent = '답글 확인이 끝났어요. 아래 「판매자센터에 넣기 준비」를 누르세요.';
  } else {
    els.reviewSummary.textContent = '답글을 읽고 필요하면 고친 뒤, 넣기 준비를 하세요.';
  }

  updateConfirmButton(filled, total);
}

function updateConfirmButton(filled, total) {
  if (!els.confirmBtn) return;
  if (applyEnabled) {
    els.confirmBtn.disabled = true;
    els.confirmBtn.textContent = '✓ 넣기 준비됨';
    els.confirmBtn.classList.add('is-ready');
    return;
  }
  els.confirmBtn.classList.remove('is-ready');
  const ready = total > 0 && filled === total;
  els.confirmBtn.disabled = !ready;
  els.confirmBtn.textContent = '판매자센터에 넣기 준비';
}

function updateReviewStatsFromUi() {
  const inputs = els.reviewList.querySelectorAll('.reply-input');
  const filled = [...inputs].filter((ta) => ta.value.trim()).length;
  els.draftFilled.textContent = String(filled);
  updateConfirmButton(filled, draftItems.length);
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
      showBanner('답글을 고쳤어요. 다시 「판매자센터에 넣기 준비」를 눌러 주세요.', 'warn');
    }
  }

  await storageSet(updates);
  updateReviewStats();
  updateReviewBadge();
  if (showMessage) showBanner('잠깐 저장했어요.', 'info');
}

function scheduleSaveDraft() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveDraft(false), 500);
}

async function syncInquiryApplyFromDraft() {
  const data = await storageGet([DRAFT_KEY]);
  const items = data[DRAFT_KEY]?.items || draftItems;
  if (!items.length) return;

  const replies = {};
  for (const item of items) {
    const text = String(item.reply || '').trim();
    if (!text) continue;
    replies[item.id] = text;
    replies[normalizeId(item.id)] = text;
  }
  if (!Object.keys(replies).length) return;

  await storageSet({
    [STORAGE_KEY]: replies,
    [APPLY_KEY]: true,
  });
  applyEnabled = true;
  updateReviewStats();
}

async function onConfirmAll() {
  draftItems = collectItemsFromUi();

  const empty = draftItems.filter((item) => !item.reply?.trim());
  if (empty.length) {
    showBanner(`답글이 비어 있는 항목이 ${empty.length}건 있습니다.`, 'warn');
    return;
  }

  await storageSet({
    [DRAFT_KEY]: { items: draftItems, updatedAt: Date.now() },
  });
  await syncInquiryApplyFromDraft();
  updateReviewStats();
  showBanner(
    `${draftItems.length}건 준비됐어요.\n판매자센터 상품문의에서 [답글]을 누르면 자동으로 채워집니다.`,
    'info'
  );
}

function updateReviewBanner() {
  if (activeTab !== 'review') return;
  if (applyEnabled) {
    showBanner('준비됐어요. 판매자센터에서 [답글]만 누르면 자동으로 채워집니다.', 'info');
  } else if (draftItems.length) {
    showBanner('답글 확인 후 「판매자센터에 넣기 준비」를 누르세요.', 'info');
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

  if (!(await hasAiCredentialsAsync(apiKey))) {
    showProgress('AI 연결이 필요해요. [설정]에서 로그인하거나 API 키를 넣어 주세요.', true);
    return;
  }

  const jobResponse = await getInquiryJobStatus();
  if (jobResponse?.job?.status === 'running' && jobResponse?.isRunning) {
    const job = jobResponse.job;
    showRunningProgress(job.current || 0, job.total || 0, job.currentId || '', job.message || '이미 생성 중입니다.');
    return;
  }

  isGenerating = true;
  updateSelectCounts();
  showRunningProgress(0, selectedRows.length, '', '답글 만들기 시작…');

  const systemPrompt = resolveInquirySystemPrompt(settings);

  chrome.runtime.sendMessage(
    {
      type: 'START_GENERATE_INQUIRIES',
      payload: {
        rows: selectedRows,
        apiKey,
        systemPrompt,
        model: CONFIG.GEMINI_MODEL,
      },
    },
    (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
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
      els.stopBtn.textContent = '멈추기';
      showProgress(response?.error || chrome.runtime.lastError?.message || '중지 실패', true);
      return;
    }
    refreshJobStatus();
  });
}

function resetGenProgressUi() {
  els.genProgress.classList.add('hidden');
  els.genProgress.classList.remove('success', 'error', 'stopped');
  els.genStatusText.textContent = '답글 만드는 중';
  els.genCountText.textContent = '0 / 0';
  els.genProgressFill.style.width = '0%';
  els.genSubText.textContent = '';
}

function refreshJobStatus() {
  chrome.runtime.sendMessage({ type: 'GET_INQUIRY_JOB_STATUS' }, async (response) => {
    if (chrome.runtime.lastError) return;
    const job = response?.job;
    const activelyRunning = response?.isRunning;

    if (!job) {
      if (!isGenerating) updateSelectCounts();
      return;
    }

    if (job.status === 'running' && activelyRunning) {
      isGenerating = true;
      showRunningProgress(
        job.current || 0,
        job.total || 0,
        job.currentId || '',
        job.message || '답글 만드는 중...'
      );
      els.generateBtn.textContent = `생성 중 (${job.current || 0}/${job.total || '?'})`;
      els.generateBtn.disabled = true;
      els.stopBtn.hidden = false;
      els.stopBtn.disabled = false;
      return;
    }

    if (job.status === 'running' && !activelyRunning) {
      isGenerating = false;
      updateSelectCounts();
      if (job.finishedAt !== lastHandledFinishedAt) {
        lastHandledFinishedAt = job.finishedAt;
        showProgress(job.message || '생성 작업이 중단되었습니다. 다시 시도해 주세요.', true);
      }
      return;
    }

    isGenerating = false;
    els.stopBtn.hidden = true;
    els.stopBtn.disabled = false;
    els.stopBtn.textContent = '멈추기';
    updateSelectCounts();

    if (job.status === 'done' || job.status === 'stopped') {
      if (job.finishedAt !== lastHandledFinishedAt) {
        lastHandledFinishedAt = job.finishedAt;
        const success = job.success ?? 0;
        const failed = job.failed ?? 0;

        if (job.status === 'stopped') {
          showStoppedProgress(job);
          if (success > 0) {
            await loadDraftAndRender();
            await syncInquiryApplyFromDraft();
            switchTab('review');
          }
          return;
        }

        if (success === 0 && failed > 0) {
          showProgress(job.message || job.lastError || '답글 만들기에 실패했어요.', true);
          return;
        }

        showDoneProgress(job);
        await loadDraftAndRender();
        await syncInquiryApplyFromDraft();
        switchTab('review');
      }
    } else if (job.status === 'error') {
      if (job.finishedAt !== lastHandledFinishedAt) {
        lastHandledFinishedAt = job.finishedAt;
        showProgress(job.message || job.lastError || '오류가 발생했습니다.', true);
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
  if (changes[PROGRESS_KEY]) refreshJobStatus();
  if (changes[SETTINGS_KEY]) {
    const settings = changes[SETTINGS_KEY].newValue || {};
    updateInquiryStyleLabel(settings);
  }
}

function showRunningProgress(current, total, currentId, message) {
  els.genProgress.classList.remove('hidden', 'success', 'error', 'stopped');
  els.genStatusText.textContent = '답글 만드는 중';
  els.genCountText.textContent = `${current} / ${total}`;
  els.genProgressFill.style.width = `${total > 0 ? Math.round((current / total) * 100) : 0}%`;
  els.genSubText.textContent = currentId ? `문의번호 ${currentId} 처리 중...` : message;
}

function showDoneProgress(job) {
  const success = job.success ?? 0;
  const failed = job.failed ?? 0;
  const total = job.total ?? 0;

  els.genProgress.classList.remove('hidden', 'error', 'stopped');
  els.genProgress.classList.add('success');
  els.genStatusText.textContent = '생성 완료';
  els.genCountText.textContent = `${success} / ${total}`;
  els.genProgressFill.style.width = '100%';
  els.genSubText.textContent =
    failed > 0
      ? `성공 ${success}건 · 실패 ${failed}건 · 검토 탭으로 이동합니다`
      : `${success}건 완료 · 검토 탭에서 확인·수정하세요`;
}

function showStoppedProgress(job) {
  els.genProgress.classList.remove('hidden', 'error', 'success');
  els.genProgress.classList.add('stopped');
  els.genStatusText.textContent = '멈추기됨';
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

function getInquiryJobStatus() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_INQUIRY_JOB_STATUS' }, (response) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(response);
    });
  });
}

function resolveInquirySystemPrompt(settings = {}) {
  const saved = String(settings.inquirySystemPrompt || '').trim();
  if (saved) return saved;

  const presetId = settings.inquiryTonePresetId || 'default';
  const customPresets = settings.inquiryCustomPresets || [];
  if (presetId === CUSTOM_PRESET_ID) {
    return BUILTIN_INQUIRY_TONE_PRESETS[0]?.prompt || saved;
  }

  const preset = findInquiryPreset(presetId, customPresets);
  if (preset?.prompt) return preset.prompt;

  return BUILTIN_INQUIRY_TONE_PRESETS[0]?.prompt || '';
}

function getInquiryStyleLabel(settings = {}) {
  const presetId = settings.inquiryTonePresetId || 'default';
  if (presetId === CUSTOM_PRESET_ID) return '직접 입력';
  if (presetId === INQUIRY_LEARNED_PRESET_ID) return '내 스타일 (학습)';

  const preset = findInquiryPreset(presetId, settings.inquiryCustomPresets || []);
  return preset?.name || BUILTIN_INQUIRY_TONE_PRESETS[0]?.name || '기본 (친절·안내)';
}

function isInquiryStyleConfigured(settings = {}) {
  const presetId = settings.inquiryTonePresetId || 'default';
  if (presetId === INQUIRY_LEARNED_PRESET_ID || presetId === CUSTOM_PRESET_ID) return true;
  if (presetId !== 'default') return true;

  const saved = String(settings.inquirySystemPrompt || '').trim();
  if (!saved) return false;

  const defaultPrompt = String(BUILTIN_INQUIRY_TONE_PRESETS[0]?.prompt || '').trim();
  return saved !== defaultPrompt;
}

function getInquiryStyleHint(settings = {}) {
  if (isInquiryStyleConfigured(settings)) return '';
  return '확장 아이콘 → 「설정」에서 말투를 정해 주세요';
}

function updateInquiryStyleLabel(settings = {}) {
  if (!els.inquiryStyleLabel) return;
  els.inquiryStyleLabel.textContent = getInquiryStyleLabel(settings);
  if (els.inquiryStyleHint) {
    const hint = getInquiryStyleHint(settings);
    els.inquiryStyleHint.textContent = hint;
    els.inquiryStyleHint.hidden = !hint;
  }
  if (els.inquiryStyleRow) {
    els.inquiryStyleRow.classList.toggle('is-ready', isInquiryStyleConfigured(settings));
  }
}

function getJobStatus() {
  return getInquiryJobStatus().then((response) => response?.job || null);
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
