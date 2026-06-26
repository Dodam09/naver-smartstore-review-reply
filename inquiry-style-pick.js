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
};

let catalog = [];
let selectedIds = new Set();
let filterText = '';
let isLoading = false;
let isAnalyzing = false;

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
      readable.slice(0, Math.min(5, readable.length)).forEach((item) => selectedIds.add(item.id));
    }

    setBanner(
      `답변 완료 ${catalog.length}건 · 분석 가능 ${readable.length}건 (${formatLookupDaysLabel(days)})\n` +
        (readable.length
          ? '원하는 판매자 답글 2개 이상을 선택한 뒤 [선택한 답글로 스타일 분석]을 누르세요.'
          : `${formatLookupDaysLabel(days)} 내 답변 완료 문의가 없습니다.\n상품문의 페이지에서 답변 완료 목록을 연 뒤 다시 시도하세요.`),
      readable.length ? 'success' : 'warn'
    );
    renderList();
  } catch (err) {
    catalog = [];
    selectedIds.clear();
    renderList();
    setBanner(formatFetchError(err.message), 'error');
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
      ? `${selectedReadable.length}개 선택 · 고유 ${uniqueCount}개 (2개 이상 필요)`
      : `${selectedReadable.length}개 선택 · 2개 이상 필요`;
  els.analyzeBtn.disabled = isAnalyzing || uniqueCount < 2;
  els.analyzeBtn.textContent = isAnalyzing
    ? '분석 중...'
    : `선택한 ${uniqueCount}개로 스타일 분석`;
}

async function onAnalyzeSelected() {
  if (isAnalyzing) return;

  const selected = catalog.filter((item) => selectedIds.has(item.id) && hasReadableAnswer(item));
  const samples = normalizeSamples(selected.map((item) => getAnswerText(item)));
  if (samples.length < 2) {
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
  if (!apiKey || apiKey.includes('YOUR_GEMINI')) {
    setBanner('API 키가 없습니다.\n확장 팝업 [설정] 탭에서 API 키를 입력해 주세요.', 'warn');
    return;
  }

  isAnalyzing = true;
  updateCounts();
  setBanner(`선택한 ${samples.length}개 문의 답글 스타일을 분석하는 중...`, 'info');

  try {
    const response = await sendRuntimeMessage({
      type: 'ANALYZE_TONE_SAMPLES_JOB',
      payload: {
        apiKey,
        samples,
        model: CONFIG.GEMINI_MODEL,
        context: 'inquiry',
        skipPersist: true,
      },
    });

    const sampleText = samples.join('\n\n---\n\n');
    const existing = (await storageGet([CONFIG.SETTINGS_KEY]))[CONFIG.SETTINGS_KEY] || {};
    const flowPatch = {
      inquirySampleReplies: sampleText,
      inquirySampleFlow: {
        ...(existing.inquirySampleFlow || {}),
        source: 'seller-pick',
        sourceLabel: `판매자센터 문의 선택 (${samples.length}개)`,
        loadedAt: Date.now(),
        loadedCount: samples.length,
        analyzedAt: Date.now(),
        analyzedCount: response.sampleCount || samples.length,
        fetching: false,
        analyzing: false,
        lastError: '',
      },
    };

    const confirm = await confirmAndApplyLearnedStyle(existing, 'inquiry', response, flowPatch);
    if (!confirm.applied) {
      setBanner(
        confirm.choice === 'keep'
          ? '분석은 완료했지만 기존 스타일을 유지했습니다.'
          : '새 스타일 적용을 취소했습니다.',
        'warn'
      );
      return;
    }

    await storageSet({ [CONFIG.SETTINGS_KEY]: confirm.patch });

    setBanner(
      `✓ 새 스타일 적용 · 선택 ${response.sampleCount || samples.length}개로 「내 스타일」이 저장되었습니다.\n` +
        '[문의 답글 작업]에서 바로 답변 생성하면 자동 적용됩니다.',
      'success'
    );
  } catch (err) {
    setBanner(`분석 오류: ${err.message}`, 'error');
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
