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

async function loadCatalog() {
  if (isLoading) return;
  isLoading = true;
  els.reloadBtn.disabled = true;
  els.reloadBtn.textContent = '불러오는 중...';
  setBanner('판매자센터에서 답글 등록 리뷰를 불러오는 중...', 'info');

  const days = Number(els.daysSelect.value) || 90;

  try {
    const response = await sendRuntimeMessage({
      type: 'FETCH_SELLER_REPLY_CATALOG_JOB',
      payload: { days, maxItems: 100 },
    });

    catalog = response.catalog || [];
    selectedIds.clear();

    const readable = catalog.filter((item) => item.hasBody);
    if (readable.length >= 2) {
      readable.slice(0, Math.min(5, readable.length)).forEach((item) => selectedIds.add(item.id));
    }

    setBanner(
      `답글 등록 ${catalog.length}건 · 본문 ${response.withBodyCount || readable.length}건 (최근 ${days}일)\n` +
        '원하는 답글 2개 이상을 선택한 뒤 [선택한 답글로 스타일 분석]을 누르세요.',
      'success'
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
  els.readableCount.textContent = String(catalog.filter((item) => item.hasBody).length);
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
      const disabled = !item.hasBody;
      return `
        <article class="card ${selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}" data-id="${escapeHtml(item.id)}">
          <input type="checkbox" class="card-check" data-id="${escapeHtml(item.id)}" ${selected ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
          <div class="card-body">
            <div class="card-top">
              <div class="card-id">#${escapeHtml(item.id)}</div>
              <div class="badges">
                ${item.reviewScore ? `<span class="badge rating">★ ${escapeHtml(item.reviewScore)}</span>` : ''}
                ${disabled ? '<span class="badge missing">본문 없음</span>' : ''}
              </div>
            </div>
            ${item.productName ? `<div class="product">${escapeHtml(item.productName)}</div>` : ''}
            <div class="reply-text">${escapeHtml(item.comment || '(답글 본문을 API에서 읽지 못했습니다)')}</div>
            ${item.reviewPreview ? `<div class="review-preview">고객 리뷰: ${escapeHtml(item.reviewPreview)}</div>` : ''}
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
    const hay = `${item.comment} ${item.productName} ${item.reviewPreview} ${item.id}`.toLowerCase();
    return hay.includes(filterText);
  });
}

function toggleId(id, forceChecked) {
  const item = catalog.find((row) => row.id === id);
  if (!item?.hasBody) return;

  if (forceChecked === true) selectedIds.add(id);
  else if (forceChecked === false) selectedIds.delete(id);
  else if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);

  renderList();
}

function selectAllReadable() {
  getFilteredRows()
    .filter((item) => item.hasBody)
    .forEach((item) => selectedIds.add(item.id));
  renderList();
}

function clearSelection() {
  selectedIds.clear();
  renderList();
}

function updateCounts() {
  const selectedReadable = catalog.filter((item) => selectedIds.has(item.id) && item.hasBody);
  els.selectedCount.textContent = String(selectedReadable.length);
  els.footerCount.textContent = String(selectedReadable.length);
  els.analyzeBtn.disabled = isAnalyzing || selectedReadable.length < 2;
  els.analyzeBtn.textContent = isAnalyzing
    ? '분석 중...'
    : `선택한 ${selectedReadable.length}개로 스타일 분석`;
}

async function onAnalyzeSelected() {
  if (isAnalyzing) return;

  const selected = catalog.filter((item) => selectedIds.has(item.id) && item.hasBody);
  if (selected.length < 2) {
    setBanner('답글 본문이 있는 항목을 2개 이상 선택해 주세요.', 'warn');
    return;
  }

  const settings = (await storageGet([CONFIG.SETTINGS_KEY]))[CONFIG.SETTINGS_KEY] || {};
  const apiKey = settings.apiKey || CONFIG.GEMINI_API_KEY || '';
  if (!apiKey || apiKey.includes('YOUR_GEMINI')) {
    setBanner('Gemini API 키가 없습니다.\n확장 팝업 [설정] 탭에서 API 키를 입력해 주세요.', 'warn');
    return;
  }

  isAnalyzing = true;
  updateCounts();
  setBanner(`선택한 ${selected.length}개 답글 스타일을 Gemini가 분석하는 중...`, 'info');

  try {
    const samples = selected.map((item) => item.comment);
    const response = await sendRuntimeMessage({
      type: 'ANALYZE_TONE_SAMPLES_JOB',
      payload: {
        apiKey,
        samples,
        model: CONFIG.GEMINI_MODEL,
      },
    });

    const sampleText = samples.join('\n\n---\n\n');
    const existing = (await storageGet([CONFIG.SETTINGS_KEY]))[CONFIG.SETTINGS_KEY] || {};
    await storageSet({
      [CONFIG.SETTINGS_KEY]: {
        ...existing,
        sampleReplies: sampleText,
        sampleFlow: {
          ...(existing.sampleFlow || {}),
          source: 'seller-pick',
          sourceLabel: `판매자센터 선택 (${selected.length}개)`,
          loadedAt: Date.now(),
          loadedCount: selected.length,
          analyzedAt: Date.now(),
          analyzedCount: response.sampleCount || selected.length,
          fetching: false,
          analyzing: false,
          lastError: '',
        },
      },
    });

    setBanner(
      `✓ 분석 완료 · 선택 ${response.sampleCount || selected.length}개로 「내 스타일」 프리셋을 만들었습니다.\n` +
        '확장 팝업 [스타일] 탭에서 확인하거나, [리뷰 답글 작업]으로 돌아가 답변을 생성하세요.',
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
  if (/Receiving end does not exist|Could not establish connection/i.test(msg)) {
    return '판매자센터 페이지와 연결되지 않았습니다.\n리뷰 관리 페이지를 새로고침(F5)한 뒤 다시 시도하세요.';
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
