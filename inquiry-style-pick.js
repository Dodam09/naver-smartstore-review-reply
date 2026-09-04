const els = {
  daysSelect: document.getElementById('daysSelect'),
  reloadBtn: document.getElementById('reloadBtn'),
  searchInput: document.getElementById('searchInput'),
  selectAllBtn: document.getElementById('selectAllBtn'),
  clearBtn: document.getElementById('clearBtn'),
  banner: document.getElementById('banner'),
  list: document.getElementById('list'),
  totalCount: document.getElementById('totalCount'),
  readableCount: document.getElementById('readableCount'),
  selectedCount: document.getElementById('selectedCount'),
  footerCount: document.getElementById('footerCount'),
  analyzeBtn: document.getElementById('analyzeBtn'),
  progressPanel: document.getElementById('progressPanel'),
  progressFill: document.getElementById('progressFill'),
  progressLabel: document.getElementById('progressLabel'),
  progressPct: document.getElementById('progressPct'),
  stepList: document.getElementById('stepList'),
  stepAnalyze: document.getElementById('stepAnalyze'),
  stepDone: document.getElementById('stepDone'),
};

let catalog = [];
let selectedIds = new Set();
let filterText = '';
let isLoading = false;
let isAnalyzing = false;
let analyzeTick = null;
let analyzePct = 70;

init();

async function init() {
  renderLookupDayOptions(els.daysSelect, { includeLong: true, selected: 7 });
  for (const item of [
    { value: 14, label: '2주일' },
    { value: 30, label: '1개월' },
    { value: 90, label: '3개월' },
  ]) {
    const opt = document.createElement('option');
    opt.value = String(item.value);
    opt.textContent = item.label;
    els.daysSelect.appendChild(opt);
  }

  els.reloadBtn.addEventListener('click', loadCatalog);
  els.daysSelect.addEventListener('change', loadCatalog);
  els.searchInput.addEventListener('input', () => {
    filterText = els.searchInput.value.trim().toLowerCase();
    renderList();
  });
  els.selectAllBtn.addEventListener('click', selectAllReadable);
  els.clearBtn.addEventListener('click', clearSelection);
  els.analyzeBtn.addEventListener('click', onAnalyzeSelected);
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'INQUIRY_CATALOG_PROGRESS_UI') {
      applyCatalogProgress(message.payload || {});
    }
  });
}

function setProgress(percent, label, stage) {
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  if (els.progressPanel) els.progressPanel.classList.add('visible');
  if (els.progressFill) els.progressFill.style.width = `${pct}%`;
  if (els.progressPct) els.progressPct.textContent = `${pct}%`;
  if (els.progressLabel && label) els.progressLabel.textContent = label;
  const mark = (el, name) => {
    if (!el) return;
    el.classList.toggle('active', stage === name);
    el.classList.toggle(
      'done',
      (name === 'list' && (stage === 'analyze' || stage === 'done')) ||
        (name === 'analyze' && stage === 'done') ||
        (name === 'done' && stage === 'done')
    );
  };
  mark(els.stepList, 'list');
  mark(els.stepAnalyze, 'analyze');
  mark(els.stepDone, 'done');
}

function hideProgress() {
  if (els.progressPanel) els.progressPanel.classList.remove('visible');
}

function applyCatalogProgress(payload) {
  const stage = payload.stage || 'list';
  const current = Number(payload.current) || 0;
  const total = Math.max(1, Number(payload.total) || 1);
  if (stage === 'list') {
    const pct = 5 + (current / total) * 35;
    setProgress(pct, payload.label || `문의 목록 검색 중 ${current}/${total}`, 'list');
    return;
  }
  if (stage === 'enrich') {
    const pct = 40 + (current / total) * 30;
    setProgress(pct, payload.label || `답변 본문 읽는 중 ${current}/${total}`, 'list');
  }
}

function startAnalyzeProgress(count) {
  stopAnalyzeProgress();
  analyzePct = 70;
  setProgress(analyzePct, `${count}건 답변으로 지침서 작성 중...`, 'analyze');
  analyzeTick = setInterval(() => {
    if (analyzePct < 94) analyzePct += 1;
    setProgress(analyzePct, `${count}건 답변으로 지침서 작성 중...`, 'analyze');
  }, 800);
}

function stopAnalyzeProgress() {
  if (analyzeTick) {
    clearInterval(analyzeTick);
    analyzeTick = null;
  }
}

function getAnswerText(item) {
  return String(item.answer || item.reply || '').trim();
}

function hasReadableAnswer(item) {
  return !!item.hasAnswer && getAnswerText(item).length >= 8;
}

async function loadCatalog() {
  if (isLoading) return;
  isLoading = true;
  els.reloadBtn.disabled = true;
  els.reloadBtn.textContent = '불러오는 중...';
  setBanner('판매자센터에서 답변 완료 상품문의를 불러오는 중...', 'info');
  setProgress(4, '판매자센터 연결 중...', 'list');

  const days = clampLookupDays(els.daysSelect.value, { min: 0, max: 365, fallback: 7 });

  try {
    const response = await sendRuntimeMessage({
      type: 'FETCH_INQUIRY_REPLY_CATALOG_JOB',
      payload: { days, maxItems: 100 },
    });

    catalog = (response.catalog || []).map((item) => ({
      ...item,
      id: String(item.id),
      hasAnswer: hasReadableAnswer(item) || !!getAnswerText(item),
    }));
    selectedIds.clear();

    const readable = catalog.filter((item) => hasReadableAnswer(item));
    if (readable.length >= 2) {
      readable.forEach((item) => selectedIds.add(item.id));
    }

    setBanner(
      `답변 완료 ${catalog.length}건 · 분석 가능 ${readable.length}건 (${formatLookupDaysLabel(days)})\n` +
        (readable.length
          ? '불러온 문의/답변으로 응대 지침서를 만듭니다.'
          : `${formatLookupDaysLabel(days)} 내 답변 완료 문의가 없습니다.\n상품문의 페이지에서 답변 완료 목록을 연 뒤 다시 시도하세요.`),
      readable.length ? 'success' : 'warn'
    );
    renderList();
    if (readable.length >= 2) {
      onAnalyzeSelected();
    } else {
      hideProgress();
    }
  } catch (err) {
    catalog = [];
    selectedIds.clear();
    renderList();
    setBanner(formatFetchError(err.message), 'error');
    hideProgress();
  } finally {
    isLoading = false;
    els.reloadBtn.disabled = false;
    els.reloadBtn.textContent = '답글 목록 불러오기';
  }
}

function renderList() {
  const rows = getFilteredRows();
  els.totalCount.textContent = String(catalog.length);
  els.readableCount.textContent = String(catalog.filter((item) => hasReadableAnswer(item)).length);
  updateCounts();

  if (!catalog.length) {
    els.list.innerHTML =
      '<div class="empty">답글 목록이 없습니다.<br>[답글 목록 불러오기]를 눌러 주세요.</div>';
    return;
  }

  if (!rows.length) {
    els.list.innerHTML = '<div class="empty">검색 결과가 없습니다.</div>';
    return;
  }

  els.list.innerHTML = rows
    .map((item) => {
      const selected = selectedIds.has(item.id);
      const disabled = !hasReadableAnswer(item);
      const question = item.question || item.content || '';
      const answer = getAnswerText(item);
      return `
        <article class="card ${selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}" data-id="${escapeHtml(item.id)}">
          <input type="checkbox" class="card-check" data-id="${escapeHtml(item.id)}" ${selected ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
          <div class="card-body">
            <div class="card-top">
              <div class="card-id">#${escapeHtml(item.id)}</div>
            </div>
            ${item.product ? `<div class="product">${escapeHtml(item.product)}</div>` : ''}
            <div class="q-label">고객 문의</div>
            <div class="q-text">${escapeHtml(question)}</div>
            <div class="reply-label">판매자 답변</div>
            <div class="reply-text">${escapeHtml(disabled ? '답변 본문을 사용할 수 없습니다.' : answer)}</div>
          </div>
        </article>`;
    })
    .join('');

  els.list.querySelectorAll('.card:not(.disabled)').forEach((card) => {
    card.addEventListener('click', (event) => {
      if (event.target.classList.contains('card-check')) return;
      toggleId(card.dataset.id);
    });
  });

  els.list.querySelectorAll('.card-check:not(:disabled)').forEach((cb) => {
    cb.addEventListener('click', (event) => event.stopPropagation());
    cb.addEventListener('change', () => toggleId(cb.dataset.id, cb.checked));
  });
}

function getFilteredRows() {
  if (!filterText) return catalog;
  return catalog.filter((item) => {
    const hay = `${getAnswerText(item)} ${item.question || item.content || ''} ${item.product || ''} ${item.id}`.toLowerCase();
    return hay.includes(filterText);
  });
}

function toggleId(id, forceChecked) {
  const item = catalog.find((row) => row.id === id);
  if (!hasReadableAnswer(item)) return;

  if (forceChecked === true) selectedIds.add(id);
  else if (forceChecked === false) selectedIds.delete(id);
  else if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);

  renderList();
}

function selectAllReadable() {
  getFilteredRows()
    .filter((item) => hasReadableAnswer(item))
    .forEach((item) => selectedIds.add(item.id));
  renderList();
}

function clearSelection() {
  selectedIds.clear();
  renderList();
}

function updateCounts() {
  const selectedReadable = catalog.filter((item) => selectedIds.has(item.id) && hasReadableAnswer(item));
  const uniqueCount = normalizeSamples(selectedReadable.map((item) => getAnswerText(item))).length;
  els.selectedCount.textContent = String(selectedReadable.length);
  els.footerCount.textContent =
    uniqueCount < selectedReadable.length
      ? `${selectedReadable.length}개 선택 · 고유 ${uniqueCount}개`
      : `${selectedReadable.length}개 선택`;
  els.analyzeBtn.disabled = isAnalyzing || uniqueCount < 2;
  els.analyzeBtn.textContent = isAnalyzing
    ? '지침서 만드는 중...'
    : `선택한 ${selectedReadable.length}개로 지침서 만들기`;
}

async function onAnalyzeSelected() {
  if (isAnalyzing) return;

  const selected = catalog.filter((item) => selectedIds.has(item.id) && hasReadableAnswer(item));
  const pairs = selected.map((item) => ({
    question: item.question || item.content || '',
    answer: getAnswerText(item),
  }));
  const samples = normalizeSamples(pairs.map((item) => item.answer));
  if (samples.length < 2 && pairs.length < 2) {
    setBanner(
      selected.length >= 2
        ? '선택한 답글 내용이 너무 비슷합니다. 표현이 다른 답글을 2개 이상 골라 주세요.'
        : '답변 본문이 있는 항목을 2개 이상 선택해 주세요.',
      'warn'
    );
    return;
  }

  const settings = (await storageGet([CONFIG.SETTINGS_KEY]))[CONFIG.SETTINGS_KEY] || {};
  const apiKey = settings.apiKey || CONFIG.GEMINI_API_KEY || '';
  if (!(await hasAiCredentialsAsync(apiKey))) {
    setBanner('AI 연결이 필요해요.\n[계정]에서 로그인하거나 API 키를 확인해 주세요.', 'warn');
    return;
  }

  isAnalyzing = true;
  updateCounts();
  setBanner(`불러온 ${pairs.length}건 문의/답변으로 응대 지침서를 만드는 중...`, 'info');
  startAnalyzeProgress(pairs.length);

  try {
    const response = await sendRuntimeMessage({
      type: 'ANALYZE_TONE_SAMPLES_JOB',
      payload: {
        apiKey,
        samples,
        pairs,
        model: CONFIG.GEMINI_MODEL,
        context: 'inquiry',
        skipPersist: true,
      },
    });

    const sampleText = samples.join('\n\n---\n\n');
    const analyzedFingerprint = samples.map((s) => s.slice(0, 120)).join('\n---\n');
    const existing = (await storageGet([CONFIG.SETTINGS_KEY]))[CONFIG.SETTINGS_KEY] || {};
    const flowPatch = {
      inquirySampleReplies: sampleText,
      inquirySampleFlow: {
        ...(existing.inquirySampleFlow || {}),
        source: 'seller-pick',
        sourceLabel: `판매자센터 문의 지침서 (${pairs.length}건)`,
        loadedAt: Date.now(),
        loadedCount: samples.length,
        analyzedAt: Date.now(),
        analyzedCount: response.sampleCount || samples.length,
        analyzedFingerprint,
        fetching: false,
        analyzing: false,
        lastError: '',
      },
    };

    const confirm = await confirmAndApplyLearnedStyle(existing, 'inquiry', response, flowPatch);
    if (!confirm.applied) {
      stopAnalyzeProgress();
      setProgress(100, '지침서는 만들었지만 적용하지 않았습니다.', 'done');
      setBanner(
        confirm.choice === 'keep'
          ? '분석은 완료했지만 기존 스타일을 유지했습니다.'
          : '새 스타일 적용을 취소했습니다.',
        'warn'
      );
      return;
    }

    await storageSet({ [CONFIG.SETTINGS_KEY]: confirm.patch });

    stopAnalyzeProgress();
    setProgress(100, `지침서 저장 완료 · ${response.sampleCount || pairs.length}건 반영`, 'done');
    setBanner(
      `✓ 응대 지침서 저장 · ${response.sampleCount || pairs.length}건 실제 답변을 반영했습니다.\n` +
        '[문의 답글 작업]에서 바로 답변 생성하면 이 지침이 적용됩니다.',
      'success'
    );
  } catch (err) {
    setBanner(`분석 오류: ${err.message}`, 'error');
    stopAnalyzeProgress();
    hideProgress();
  } finally {
    isAnalyzing = false;
    updateCounts();
  }
}

function setBanner(message, variant) {
  els.banner.textContent = message;
  els.banner.className = `banner ${variant || 'info'}`;
}

function formatFetchError(message) {
  const msg = String(message || '가져오기 실패');
  if (/Receiving end does not exist|Could not establish connection|message port closed/i.test(msg)) {
    return (
      '판매자센터 페이지와 연결되지 않았습니다.\n\n' +
      '1. [상품문의] 페이지(sell.smartstore.naver.com)에서 F5\n' +
      '2. chrome://extensions 에서 확장 프로그램 [새로고침]\n' +
      '3. 다시 시도'
    );
  }
  return msg;
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
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

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(data) {
  return new Promise((resolve) => chrome.storage.local.set(data, resolve));
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
