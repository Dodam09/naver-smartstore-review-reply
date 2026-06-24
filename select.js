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
  applyStatBox: document.getElementById('applyStatBox'),
  footerCount: document.getElementById('footerCount'),
  footerSelect: document.getElementById('footerSelect'),
  footerReview: document.getElementById('footerReview'),
  reviewSummary: document.getElementById('reviewSummary'),
  generateBtn: document.getElementById('generateBtn'),
  stopBtn: document.getElementById('stopBtn'),
  saveDraftBtn: document.getElementById('saveDraftBtn'),
  confirmBtn: document.getElementById('confirmBtn'),
  bulkSubmitBtn: document.getElementById('bulkSubmitBtn'),
  genProgress: document.getElementById('genProgress'),
  genStatusText: document.getElementById('genStatusText'),
  genCountText: document.getElementById('genCountText'),
  genProgressFill: document.getElementById('genProgressFill'),
  genSubText: document.getElementById('genSubText'),
  searchInput: document.getElementById('searchInput'),
  selectAllBtn: document.getElementById('selectAllBtn'),
  selectNoneBtn: document.getElementById('selectNoneBtn'),
  selectVisibleBtn: document.getElementById('selectVisibleBtn'),
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
let isBulkSubmitting = false;
let submittedIds = new Set();

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
  els.bulkSubmitBtn.addEventListener('click', onBulkSubmit);

  chrome.storage.onChanged.addListener(onStorageChanged);
  await loadData();
  refreshJobStatus();
  setInterval(refreshJobStatus, 2000);

  if (location.hash === '#review') {
    switchTab('review');
  }
}

function switchTab(tab) {
  activeTab = tab;
  const isSelect = tab === 'select';

  els.tabSelect.classList.toggle('active', isSelect);
  els.tabReview.classList.toggle('active', !isSelect);
  els.tabSelect.setAttribute('aria-selected', String(isSelect));
  els.tabReview.setAttribute('aria-selected', String(!isSelect));

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
}

async function loadData() {
  const data = await storageGet([
    CONFIG.PARSE_CACHE_KEY,
    CONFIG.SETTINGS_KEY,
    CONFIG.DRAFT_KEY,
    CONFIG.APPLY_ENABLED_KEY,
  ]);
  const cache = data[CONFIG.PARSE_CACHE_KEY];

  draftItems = data[CONFIG.DRAFT_KEY]?.items || [];
  applyEnabled = !!data[CONFIG.APPLY_ENABLED_KEY];
  updateReviewBadge();

  if (!cache?.parsedRows?.length) {
    els.selectList.innerHTML =
      '<div class="empty">업로드된 리뷰가 없습니다.<br>확장 팝업에서 <strong>판매자센터 가져오기</strong> 또는 엑셀 업로드를 하세요.</div>';
    updateSelectCounts();
    return;
  }

  parsedRows = cache.parsedRows;
  parseMeta = {
    fileName: cache.fileName || '',
    skippedReplied: cache.skippedReplied || 0,
  };
  selectedIds = new Set(cache.selectedIds || []);
  renderSelect();
}

async function loadDraftAndRender() {
  const data = await storageGet([CONFIG.DRAFT_KEY, CONFIG.APPLY_ENABLED_KEY]);
  draftItems = data[CONFIG.DRAFT_KEY]?.items || [];
  submittedIds = new Set(data[CONFIG.DRAFT_KEY]?.submittedIds || []);
  applyEnabled = !!data[CONFIG.APPLY_ENABLED_KEY];
  updateReviewBadge();
  renderReview();
}

function getFilteredRows() {
  if (!filterText) return parsedRows;
  return parsedRows.filter((row) => {
    const haystack = [row.id, row.content, row.product, row.writer, row.reviewType, row.rating]
      .join(' ')
      .toLowerCase();
    return haystack.includes(filterText);
  });
}

function renderSelect() {
  const rows = getFilteredRows();

  if (!parsedRows.length) {
    els.selectList.innerHTML =
      '<div class="empty">업로드된 리뷰가 없습니다.<br>확장 팝업에서 <strong>판매자센터 가져오기</strong> 또는 엑셀 업로드를 하세요.</div>';
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
                ${row.rating ? `<span class="badge rating">★ ${escapeHtml(row.rating)}</span>` : ''}
                ${row.reviewType ? `<span class="badge">${escapeHtml(row.reviewType)}</span>` : ''}
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
      '<div class="empty">생성된 답글이 없습니다.<br>「1. 리뷰 선택」 탭에서 답변을 생성하세요.</div>';
    els.confirmBtn.disabled = true;
    els.bulkSubmitBtn.disabled = true;
    updateReviewStats();
    return;
  }

  els.reviewList.innerHTML = draftItems
    .map((item) => {
      const isSubmitted = submittedIds.has(String(item.id));
      return `
    <article class="card review-card ${isSubmitted ? 'submitted' : ''}" data-id="${escapeHtml(item.id)}">
      <div class="card-top">
        <div class="card-id">#${escapeHtml(item.id)}</div>
        <div class="card-badges">
          ${isSubmitted ? '<span class="badge done">등록됨</span>' : ''}
          ${item.rating ? `<span class="badge rating">★ ${escapeHtml(item.rating)}</span>` : ''}
          ${item.reviewType ? `<span class="badge">${escapeHtml(item.reviewType)}</span>` : ''}
        </div>
      </div>
      ${item.product ? `<div class="card-product">${escapeHtml(item.product)}</div>` : ''}
      <div class="review-box">${escapeHtml(item.reviewContent || '')}</div>
      <div class="reply-label">판매자 답글</div>
      <textarea class="reply-input" data-id="${escapeHtml(item.id)}" maxlength="1000" ${isSubmitted ? 'disabled' : ''}>${escapeHtml(item.reply || '')}</textarea>
      <div class="char-count">${(item.reply || '').length} / 1000</div>
    </article>`;
    })
    .join('');

  els.reviewList.querySelectorAll('.reply-input').forEach((ta) => {
    ta.addEventListener('input', () => {
      const card = ta.closest('.card');
      card.querySelector('.char-count').textContent = `${ta.value.length} / 1000`;
      scheduleSaveDraft();
      updateReviewStatsFromUi();
    });
  });

  els.confirmBtn.disabled = false;
  updateReviewStats();
  updateReviewBanner();
}

function getPendingSubmitItems() {
  const items = els.reviewList.querySelectorAll('.reply-input').length
    ? collectItemsFromUi()
    : draftItems;
  return items.filter(
    (item) => item.reply?.trim() && !submittedIds.has(String(item.id))
  );
}

function toggleId(id, forceChecked) {
  const shouldSelect =
    forceChecked !== undefined ? forceChecked : !selectedIds.has(id);
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
  els.fileName.textContent = parseMeta.fileName
    ? parseMeta.fileName.length > 18
      ? parseMeta.fileName.slice(0, 16) + '…'
      : parseMeta.fileName
    : '-';
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
  const registered = submittedIds.size;
  const pending = getPendingSubmitItems().length;

  els.draftTotal.textContent = String(total);
  els.draftFilled.textContent = String(filled);
  els.applyStatus.textContent = registered ? `${registered}건 등록` : '0건';
  els.applyStatus.style.color = registered ? '#0a7a3f' : '#333';
  els.applyStatBox.classList.toggle('selected', registered > 0);

  if (isBulkSubmitting) {
    els.reviewSummary.textContent = '판매자센터에 답글을 등록하는 중...';
  } else if (registered === total && total > 0) {
    els.reviewSummary.textContent = '모든 답글이 등록되었습니다.';
  } else if (pending > 0) {
    els.reviewSummary.textContent = `${pending}건 일괄 등록 가능 · 판매자센터 탭 필요`;
  } else {
    els.reviewSummary.textContent = '답글을 작성한 뒤 [판매자센터에 일괄 등록]을 누르세요.';
  }

  els.bulkSubmitBtn.disabled = isBulkSubmitting || pending === 0;
  els.bulkSubmitBtn.textContent =
    pending > 0 ? `판매자센터에 일괄 등록 (${pending}건)` : '판매자센터에 일괄 등록';
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
    if (map.has(id)) {
      map.get(id).reply = ta.value.trim();
    }
  });
  return [...map.values()];
}

async function saveDraft(showMessage = false) {
  if (!draftItems.length) return;
  draftItems = collectItemsFromUi();
  const updates = {
    [CONFIG.DRAFT_KEY]: {
      items: draftItems,
      submittedIds: [...submittedIds],
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
  updateReviewStats();
  updateReviewBadge();

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
    [CONFIG.DRAFT_KEY]: {
      items: draftItems,
      submittedIds: [...submittedIds],
      updatedAt: Date.now(),
    },
    [CONFIG.APPLY_ENABLED_KEY]: true,
  });

  applyEnabled = true;
  updateReviewStats();
  showBanner(
    `${draftItems.length}건 자동 입력 모드 활성화. 답글 팝업을 열면 textarea에 채워집니다. (일괄 등록은 [판매자센터에 일괄 등록] 사용)`,
    'info'
  );
}

async function onBulkSubmit() {
  draftItems = collectItemsFromUi();
  const pending = getPendingSubmitItems();

  if (!pending.length) {
    showBanner('등록할 답글이 없습니다. 답글을 작성하거나 미등록 항목을 확인하세요.', 'warn');
    return;
  }

  const empty = draftItems.filter((item) => !item.reply?.trim());
  if (empty.length) {
    showBanner(`답글이 비어 있는 항목이 ${empty.length}건 있습니다.`, 'warn');
    return;
  }

  isBulkSubmitting = true;
  updateReviewStats();
  showSubmitProgress(0, pending.length, '일괄 등록 준비 중...');

  try {
    const response = await sendTabMessage(null, {
      type: 'BULK_SUBMIT_REPLIES',
      payload: {
        items: pending.map((item) => ({ id: item.id, reply: item.reply.trim() })),
      },
    });

    if (!response?.ok) {
      throw new Error(response?.error || '일괄 등록 실패');
    }

    for (const id of response.success || []) {
      submittedIds.add(String(id));
    }

    await storageSet({
      [CONFIG.DRAFT_KEY]: {
        items: draftItems,
        submittedIds: [...submittedIds],
        updatedAt: Date.now(),
      },
      [CONFIG.APPLY_ENABLED_KEY]: false,
    });
    applyEnabled = false;

    renderReview();

    const ok = (response.success || []).length;
    const fail = (response.failed || []).length;
    let msg = `${ok}건 등록 완료`;
    if (fail > 0) {
      const firstErr = response.failed[0]?.error || '';
      msg += ` · 실패 ${fail}건${firstErr ? `\n${firstErr}` : ''}`;
    }
    showBanner(msg, fail > 0 && ok === 0 ? 'warn' : 'success');
    showSubmitProgress(ok + fail, pending.length, msg, fail > 0 && ok === 0);
  } catch (err) {
    const msg = err.message || String(err);
    if (/Receiving end does not exist|Could not establish connection/i.test(msg)) {
      showBanner('판매자센터 페이지를 새로고침(F5)한 뒤 다시 시도하세요.', 'warn');
    } else {
      showBanner(msg, 'warn');
    }
    showSubmitProgress(0, pending.length, msg, true);
  } finally {
    isBulkSubmitting = false;
    updateReviewStats();
  }
}

function sendTabMessage(_tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: 'RELAY_SELLER_TAB',
        payload: {
          messageType: message.type,
          payload: message.payload || {},
        },
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response?.ok) {
          reject(new Error(response?.error || '요청 실패'));
          return;
        }
        resolve(response);
      }
    );
  });
}

function showSubmitProgress(current, total, message, isError = false) {
  els.genProgress.classList.remove('hidden', 'success', 'error', 'stopped');
  if (isError) els.genProgress.classList.add('error');
  else els.genProgress.classList.add('success');

  els.genStatusText.textContent = '일괄 등록';
  els.genCountText.textContent = total ? `${current} / ${total}` : '';
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  els.genProgressFill.style.width = `${pct}%`;
  els.genSubText.textContent = message;
}

function updateReviewBanner() {
  if (activeTab !== 'review') return;
  if (submittedIds.size === draftItems.length && draftItems.length) {
    showBanner('모든 답글이 판매자센터에 등록되었습니다.', 'success');
  } else if (applyEnabled) {
    showBanner('자동 입력 모드 — 답글 팝업을 열면 textarea에 채워집니다.', 'info');
  } else if (draftItems.length) {
    showBanner(
      '답글 확인 후 [판매자센터에 일괄 등록]을 누르면 하나씩 열지 않고 등록됩니다. (최초 1회는 판매자센터에서 답글 1건을 직접 등록해야 API를 학습합니다)',
      'info'
    );
  }
}

function showBanner(message, type = 'info') {
  els.banner.hidden = false;
  els.banner.className = `banner ${type}`;
  els.banner.textContent = message;
}

async function saveSelection() {
  const data = await storageGet(CONFIG.PARSE_CACHE_KEY);
  const cache = data[CONFIG.PARSE_CACHE_KEY];
  if (!cache) return;
  await storageSet({
    [CONFIG.PARSE_CACHE_KEY]: {
      ...cache,
      selectedIds: [...selectedIds],
    },
  });
}

async function onGenerate() {
  const selectedRows = parsedRows.filter((row) => selectedIds.has(row.id));
  if (!selectedRows.length) return;

  const settingsData = await storageGet(CONFIG.SETTINGS_KEY);
  const settings = settingsData[CONFIG.SETTINGS_KEY] || {};
  const apiKey = settings.apiKey || CONFIG.GEMINI_API_KEY;

  if (!apiKey || apiKey.includes('YOUR_GEMINI_API_KEY')) {
    showProgress('Gemini API 키가 없습니다. 확장 팝업에서 API 키를 입력하세요.', true);
    return;
  }

  const job = await getJobStatus();
  if (job?.status === 'running') {
    showRunningProgress(
      job.current || 0,
      job.total || 0,
      job.currentId || '',
      job.message || '이미 생성 중입니다.'
    );
    return;
  }

  isGenerating = true;
  updateSelectCounts();
  showRunningProgress(0, selectedRows.length, '', '답변 생성을 시작합니다...');

  chrome.runtime.sendMessage(
    {
      type: 'START_GENERATE',
      payload: {
        rows: selectedRows,
        apiKey,
        systemPrompt: settings.systemPrompt || '',
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
  els.genSubText.textContent = '현재 항목 처리 후 중지합니다. 완료된 답글은 저장됩니다.';

  chrome.runtime.sendMessage({ type: 'STOP_GENERATE' }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      els.stopBtn.disabled = false;
      els.stopBtn.textContent = '생성 중지';
      showProgress(response?.error || chrome.runtime.lastError?.message || '중지 실패', true);
      return;
    }
    refreshJobStatus();
  });
}

function refreshJobStatus() {
  chrome.runtime.sendMessage({ type: 'GET_JOB_STATUS' }, async (response) => {
    if (chrome.runtime.lastError) return;
    const job = response?.job;
    if (!job) {
      isGenerating = false;
      updateSelectCounts();
      return;
    }

    if (job.status === 'running') {
      isGenerating = true;
      const current = job.current || 0;
      const total = job.total || 0;
      showRunningProgress(
        current,
        total,
        job.currentId || '',
        job.message || '답변 생성 중...'
      );
      els.generateBtn.textContent = `생성 중 (${current}/${total})`;
      els.generateBtn.disabled = true;
      els.stopBtn.hidden = false;
      els.stopBtn.disabled = false;
      els.stopBtn.textContent = '생성 중지';
      return;
    }

    isGenerating = false;
    els.stopBtn.hidden = true;
    els.stopBtn.disabled = false;
    els.stopBtn.textContent = '생성 중지';
    updateSelectCounts();

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
  if (changes[CONFIG.PARSE_CACHE_KEY]) {
    loadData();
  }
  if (changes[CONFIG.DRAFT_KEY] || changes[CONFIG.APPLY_ENABLED_KEY]) {
    loadDraftAndRender();
    if (activeTab === 'review') {
      renderReview();
    }
  }
  if (changes[CONFIG.PROGRESS_KEY]) {
    refreshJobStatus();
  }
}

function showRunningProgress(current, total, currentId, message) {
  els.genProgress.classList.remove('hidden', 'success', 'error', 'stopped');
  els.genStatusText.textContent = '답변 생성 중';
  els.genCountText.textContent = `${current} / ${total}`;

  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  els.genProgressFill.style.width = `${pct}%`;

  els.genSubText.textContent = currentId
    ? `글번호 ${currentId} 처리 중...`
    : message;
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
  const success = job.success ?? 0;
  const failed = job.failed ?? 0;
  const total = job.total ?? 0;
  const processed = job.current ?? success + failed;

  els.genProgress.classList.remove('hidden', 'error', 'success');
  els.genProgress.classList.add('stopped');
  els.genStatusText.textContent = '생성 중지됨';
  els.genCountText.textContent = `${success} / ${total}`;
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
  els.genProgressFill.style.width = `${pct}%`;
  els.genSubText.textContent =
    failed > 0
      ? `저장 ${success}건 · 실패 ${failed}건 · 검토 탭에서 확인하세요`
      : `저장된 ${success}건 — 검토 탭에서 확인·수정할 수 있습니다`;
}

function showProgress(message, isError = false) {
  els.genProgress.classList.remove('hidden', 'success', 'error', 'stopped');
  if (isError) els.genProgress.classList.add('error');
  else els.genProgress.classList.add('success');

  els.genStatusText.textContent = isError ? '오류' : '알림';
  els.genCountText.textContent = '';
  els.genProgressFill.style.width = isError ? '0%' : '100%';
  els.genSubText.textContent = message;
}

function getJobStatus() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_JOB_STATUS' }, (response) => {
      resolve(response?.job || null);
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
