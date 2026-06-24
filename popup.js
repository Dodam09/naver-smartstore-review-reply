const COLUMN_ALIASES = {
  id: ['리뷰글번호', '글번호', '리뷰 글번호', '리뷰번호', 'review_id', 'reviewid', 'review no'],
  content: ['리뷰상세내용', '리뷰내용', '구매평', '리뷰', '리뷰 본문', 'review', 'review_content', 'comment'],
  rating: ['구매자평점', '평점', '별점', 'rating', 'score'],
  product: ['상품명', '상품', 'product', 'product_name'],
  reviewType: ['리뷰구분', 'review_type'],
  replyStatus: ['답글여부', '답글 여부', 'reply_status'],
  option: ['옵션', 'option'],
  writer: ['등록자', '작성자', '구매자id', '구매자', 'writer', 'user'],
};

const DEFAULT_SYSTEM_PROMPT =
  '당신은 네이버 스마트스토어 판매자입니다. 고객 리뷰에 감사하고 진정성 있는 판매자 답글을 한국어로 작성하세요. 2~4문장, 복붙 느낌 없이 리뷰 내용에 구체적으로 반응하세요.';

const els = {
  apiKey: document.getElementById('apiKey'),
  systemPrompt: document.getElementById('systemPrompt'),
  xlsxFile: document.getElementById('xlsxFile'),
  generateBtn: document.getElementById('generateBtn'),
  reviewBtn: document.getElementById('reviewBtn'),
  clearBtn: document.getElementById('clearBtn'),
  status: document.getElementById('status'),
  preview: document.getElementById('preview'),
  columnInfo: document.getElementById('columnInfo'),
};

let parsedRows = [];
let columnMap = {};
let parseMeta = null;
let selectedIds = new Set();
let jobPollTimer = null;
let settingsSaveTimer = null;

init();

async function init() {
  els.systemPrompt.value = DEFAULT_SYSTEM_PROMPT;

  els.xlsxFile.addEventListener('change', onFileSelected);
  els.generateBtn.addEventListener('click', onGenerate);
  els.reviewBtn.addEventListener('click', openReviewPage);
  els.clearBtn.addEventListener('click', onClearStorage);
  els.systemPrompt.addEventListener('input', scheduleSaveSettings);
  els.apiKey.addEventListener('input', scheduleSaveSettings);

  chrome.storage.onChanged.addListener(onStorageChanged);

  const data = await storageGet([
    CONFIG.SETTINGS_KEY,
    CONFIG.PARSE_CACHE_KEY,
    CONFIG.PROGRESS_KEY,
    CONFIG.DRAFT_KEY,
    CONFIG.APPLY_ENABLED_KEY,
  ]);

  const settings = data[CONFIG.SETTINGS_KEY] || {};
  els.apiKey.value = settings.apiKey || CONFIG.GEMINI_API_KEY || '';
  if (settings.systemPrompt) {
    els.systemPrompt.value = settings.systemPrompt;
  }

  restoreParseCache(data[CONFIG.PARSE_CACHE_KEY]);
  updateReviewButton(data[CONFIG.DRAFT_KEY]);

  refreshJobStatus();
}

function updateReviewButton(draft) {
  const count = draft?.items?.length || 0;
  els.reviewBtn.textContent = count ? `답글 검토하기 (${count}건)` : '답글 검토하기';
}

function openReviewPage() {
  chrome.tabs.create({ url: chrome.runtime.getURL('review.html') });
}

function restoreParseCache(cache) {
  if (!cache?.parsedRows?.length) return;

  parsedRows = cache.parsedRows;
  columnMap = cache.columnMap || {};
  parseMeta = {
    headers: cache.headers || [],
    skippedReplied: cache.skippedReplied || 0,
    fileName: cache.fileName || '',
  };
  selectedIds = new Set(
    cache.selectedIds?.length
      ? cache.selectedIds
      : parsedRows.map((r) => r.id)
  );

  renderRowList();
  updateGenerateButton();

  if (cache.statusMessage) {
    setStatus(cache.statusMessage);
  }
}

function getSelectedRows() {
  return parsedRows.filter((row) => selectedIds.has(row.id));
}

function updateGenerateButton() {
  const count = selectedIds.size;
  els.generateBtn.textContent = `선택한 ${count}건 답변 생성`;
  els.generateBtn.disabled = count === 0;
}

async function saveParseCache(statusMessage) {
  if (!parsedRows.length) {
    await storageRemove(CONFIG.PARSE_CACHE_KEY);
    return;
  }

  await storageSet({
    [CONFIG.PARSE_CACHE_KEY]: {
      parsedRows,
      columnMap,
      headers: parseMeta?.headers || [],
      skippedReplied: parseMeta?.skippedReplied || 0,
      fileName: parseMeta?.fileName || '',
      selectedIds: [...selectedIds],
      statusMessage: statusMessage || '',
      savedAt: Date.now(),
    },
  });
}

function renderRowList() {
  const mapped = Object.entries(columnMap)
    .map(([k, idx]) => `${k}→"${parseMeta?.headers?.[idx] || ''}"`)
    .join(' · ');
  const skipInfo =
    parseMeta?.skippedReplied > 0
      ? ` · 답글완료 ${parseMeta.skippedReplied}건 제외`
      : '';
  const fileInfo = parseMeta?.fileName ? ` · 파일: ${parseMeta.fileName}` : '';
  els.columnInfo.textContent = `인식된 컬럼: ${mapped}${skipInfo}${fileInfo}`;

  if (!parsedRows.length) {
    els.preview.hidden = true;
    els.preview.innerHTML = '';
    return;
  }

  els.preview.hidden = false;
  els.preview.innerHTML = `
    <div class="select-toolbar">
      <button type="button" id="selectAllBtn">전체 선택</button>
      <button type="button" id="selectNoneBtn">전체 해제</button>
      <span class="select-count">${selectedIds.size} / ${parsedRows.length}건 선택</span>
    </div>
    ${parsedRows
      .map(
        (row) => `
      <label class="review-item">
        <input type="checkbox" data-id="${escapeHtml(row.id)}" ${selectedIds.has(row.id) ? 'checked' : ''} />
        <div class="review-item-body">
          <div><span class="badge">#${escapeHtml(row.id)}</span>${row.rating ? ` ★${escapeHtml(row.rating)}` : ''}</div>
          <div class="review-item-text">${escapeHtml(row.content.slice(0, 80))}${row.content.length > 80 ? '…' : ''}</div>
          ${row.product ? `<div class="review-item-meta">${escapeHtml(row.product.slice(0, 50))}${row.product.length > 50 ? '…' : ''}</div>` : ''}
        </div>
      </label>`
      )
      .join('')}
  `;

  els.preview.querySelector('#selectAllBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    selectedIds = new Set(parsedRows.map((r) => r.id));
    renderRowList();
    updateGenerateButton();
    saveParseCache();
  });

  els.preview.querySelector('#selectNoneBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    selectedIds.clear();
    renderRowList();
    updateGenerateButton();
    saveParseCache();
  });

  els.preview.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.id;
      if (cb.checked) selectedIds.add(id);
      else selectedIds.delete(id);
      const countEl = els.preview.querySelector('.select-count');
      if (countEl) countEl.textContent = `${selectedIds.size} / ${parsedRows.length}건 선택`;
      updateGenerateButton();
      saveParseCache();
    });
  });
}

function scheduleSaveSettings() {
  clearTimeout(settingsSaveTimer);
  settingsSaveTimer = setTimeout(saveSettings, 300);
}

async function saveSettings() {
  await storageSet({
    [CONFIG.SETTINGS_KEY]: {
      apiKey: els.apiKey.value.trim(),
      systemPrompt: els.systemPrompt.value.trim(),
    },
  });
}

function normalizeHeader(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function detectColumns(headers) {
  const map = {};
  const normalized = headers.map((h) => normalizeHeader(h));

  for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
    const aliasNorm = aliases.map(normalizeHeader);
    const idx = normalized.findIndex((h) => aliasNorm.includes(h));
    if (idx >= 0) map[key] = idx;
  }

  return map;
}

function parseWorkbook(arrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (!rows.length) {
    throw new Error('시트가 비어 있습니다.');
  }

  const headers = rows[0].map((h) => String(h).trim());
  const columnMap = detectColumns(headers);

  if (columnMap.id === undefined) {
    throw new Error(
      `리뷰글번호 컬럼을 찾지 못했습니다. 헤더: ${headers.join(', ')}`
    );
  }
  if (columnMap.content === undefined) {
    throw new Error(
      `리뷰상세내용 컬럼을 찾지 못했습니다. 헤더: ${headers.join(', ')}`
    );
  }

  const dataRows = [];
  let skippedReplied = 0;
  let skippedEmpty = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((cell) => String(cell).trim() === '')) continue;

    const id = String(row[columnMap.id] ?? '').trim();
    const content = normalizeReviewContent(String(row[columnMap.content] ?? '').trim());
    if (!id || !content) {
      skippedEmpty++;
      continue;
    }

    const replyStatus =
      columnMap.replyStatus !== undefined
        ? String(row[columnMap.replyStatus] ?? '').trim().toUpperCase()
        : '';
    if (replyStatus === 'Y' || replyStatus === '예' || replyStatus === '있음') {
      skippedReplied++;
      continue;
    }

    dataRows.push({
      id,
      content,
      rating: columnMap.rating !== undefined ? String(row[columnMap.rating] ?? '').trim() : '',
      product: columnMap.product !== undefined ? String(row[columnMap.product] ?? '').trim() : '',
      reviewType:
        columnMap.reviewType !== undefined ? String(row[columnMap.reviewType] ?? '').trim() : '',
      option: columnMap.option !== undefined ? String(row[columnMap.option] ?? '').trim() : '',
      writer: columnMap.writer !== undefined ? String(row[columnMap.writer] ?? '').trim() : '',
    });
  }

  if (!dataRows.length) {
    throw new Error(
      `답글 대상 리뷰가 없습니다. (답글완료 ${skippedReplied}건 제외, 내용없음 ${skippedEmpty}건)`
    );
  }

  return { headers, columnMap, dataRows, skippedReplied, skippedEmpty };
}

function renderPreview() {
  renderRowList();
}

async function onFileSelected(event) {
  const file = event.target.files?.[0];
  parsedRows = [];
  columnMap = {};
  selectedIds.clear();
  els.generateBtn.disabled = true;

  if (!file) {
    setStatus('엑셀 파일을 선택하세요.');
    els.preview.hidden = true;
    els.preview.innerHTML = '';
    els.columnInfo.textContent = '';
    return;
  }

  try {
    setStatus(`파싱 중: ${file.name}`);
    const buffer = await file.arrayBuffer();
    const result = parseWorkbook(buffer);
    parsedRows = result.dataRows;
    columnMap = result.columnMap;
    parseMeta = {
      headers: result.headers,
      skippedReplied: result.skippedReplied,
      fileName: file.name,
    };
    selectedIds = new Set();
    renderRowList();
    updateGenerateButton();
    const skipMsg = result.skippedReplied
      ? ` (답글완료 ${result.skippedReplied}건 제외)`
      : '';
    const statusMessage = `${parsedRows.length}건 파싱 완료${skipMsg}. 생성할 리뷰를 선택하세요.`;
    setStatus(statusMessage);
    await saveParseCache(statusMessage);
    await saveSettings();
  } catch (err) {
    setStatus(`오류: ${err.message}`);
    els.preview.hidden = true;
    els.preview.innerHTML = '';
    els.columnInfo.textContent = '';
  }
}

async function onGenerate() {
  const apiKey = els.apiKey.value.trim() || CONFIG.GEMINI_API_KEY;
  if (!apiKey || apiKey.includes('YOUR_GEMINI_API_KEY')) {
    setStatus('Gemini API 키를 config.js 또는 입력란에 넣어주세요.');
    return;
  }
  if (!parsedRows.length) {
    const cache = (await storageGet(CONFIG.PARSE_CACHE_KEY))[CONFIG.PARSE_CACHE_KEY];
    if (cache?.parsedRows?.length) {
      restoreParseCache(cache);
    }
  }
  if (!parsedRows.length) {
    setStatus('먼저 엑셀 파일을 업로드하세요.');
    return;
  }

  const selectedRows = getSelectedRows();
  if (!selectedRows.length) {
    setStatus('답변을 생성할 리뷰를 1건 이상 선택하세요.');
    return;
  }

  await saveSettings();

  const job = await getJobStatus();
  if (job?.status === 'running') {
    setStatus(`${job.message}\n\n팝업을 닫아도 백그라운드에서 계속 진행됩니다.`);
    setGeneratingUi(true);
    return;
  }

  els.generateBtn.disabled = true;
  setStatus(
    `선택한 ${selectedRows.length}건 백그라운드 생성 시작...\n팝업을 닫아도 계속 진행됩니다.`
  );

  chrome.runtime.sendMessage(
    {
      type: 'START_GENERATE',
      payload: {
        rows: selectedRows,
        apiKey,
        systemPrompt: els.systemPrompt.value.trim(),
        model: CONFIG.GEMINI_MODEL,
      },
    },
    (response) => {
      if (chrome.runtime.lastError) {
        setStatus(`시작 실패: ${chrome.runtime.lastError.message}`);
        setGeneratingUi(false);
        return;
      }
      if (!response?.ok) {
        setStatus(response?.error || '시작에 실패했습니다.');
        setGeneratingUi(false);
        return;
      }
      setGeneratingUi(true);
      refreshJobStatus();
    }
  );
}

function onStorageChanged(changes, area) {
  if (area !== 'local') return;
  if (changes[CONFIG.PROGRESS_KEY]) {
    applyJobUi(changes[CONFIG.PROGRESS_KEY].newValue);
  }
  if (changes[CONFIG.DRAFT_KEY]) {
    updateReviewButton(changes[CONFIG.DRAFT_KEY].newValue);
  }
}

function refreshJobStatus() {
  chrome.runtime.sendMessage({ type: 'GET_JOB_STATUS' }, (response) => {
    if (chrome.runtime.lastError) return;
    applyJobUi(response?.job);
  });
}

function applyJobUi(job) {
  if (!job) {
    if (parsedRows.length) {
      setGeneratingUi(false);
      updateGenerateButton();
      return;
    }
    chrome.storage.local.get([CONFIG.DRAFT_KEY, CONFIG.PARSE_CACHE_KEY, CONFIG.APPLY_ENABLED_KEY], (data) => {
      if (data[CONFIG.PARSE_CACHE_KEY]?.statusMessage) {
        setStatus(data[CONFIG.PARSE_CACHE_KEY].statusMessage);
        return;
      }
      const count = data[CONFIG.DRAFT_KEY]?.items?.length || 0;
      if (count > 0) {
        const apply = data[CONFIG.APPLY_ENABLED_KEY] ? ' (적용 활성화됨)' : ' (검토 필요)';
        setStatus(`생성된 답글 ${count}건${apply}. [답글 검토하기]를 눌러 확인하세요.`);
      }
    });
    setGeneratingUi(false);
    return;
  }

  if (job.message) setStatus(job.message);

  if (job.status === 'running') {
    setGeneratingUi(true);
    els.generateBtn.textContent = `생성 중 (${job.current || 0}/${job.total || '?'})`;
    return;
  }

  setGeneratingUi(false);
  updateGenerateButton();

  if (job.status === 'done' || job.status === 'error') {
    clearInterval(jobPollTimer);
    jobPollTimer = null;
    if (job.status === 'done' && job.openReview) {
      setStatus(`${job.message}\n\n[답글 검토하기]에서 확인·수정 후 일괄 확인하세요.`);
    }
  }
}

function getJobStatus() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_JOB_STATUS' }, (response) => {
      resolve(response?.job || null);
    });
  });
}

function setGeneratingUi(isGenerating) {
  const count = selectedIds.size;
  els.generateBtn.disabled = isGenerating || count === 0;
  if (isGenerating) {
    els.generateBtn.textContent = '백그라운드 생성 중...';
  } else {
    els.generateBtn.textContent = `선택한 ${count}건 답변 생성`;
  }

  if (isGenerating && !jobPollTimer) {
    jobPollTimer = setInterval(refreshJobStatus, 1500);
  }
  if (!isGenerating && jobPollTimer) {
    clearInterval(jobPollTimer);
    jobPollTimer = null;
  }
}

async function onClearStorage() {
  const job = await getJobStatus();
  if (job?.status === 'running') {
    setStatus('답변 생성이 진행 중입니다. 완료 후 삭제하세요.');
    return;
  }

  await storageRemove([
    CONFIG.STORAGE_KEY,
    CONFIG.DRAFT_KEY,
    CONFIG.APPLY_ENABLED_KEY,
    CONFIG.PROGRESS_KEY,
    CONFIG.PARSE_CACHE_KEY,
  ]);

  parsedRows = [];
  columnMap = {};
  parseMeta = null;
  selectedIds.clear();
  els.preview.hidden = true;
  els.preview.innerHTML = '';
  els.columnInfo.textContent = '';
  els.generateBtn.disabled = true;
  els.generateBtn.textContent = '선택한 0건 답변 생성';
  els.xlsxFile.value = '';
  setStatus('저장된 답변·검토 데이터를 삭제했습니다.');
}

function normalizeReviewContent(text) {
  const cleaned = text.replace(/\r\n/g, '\n').trim();
  if (!cleaned || /^https?:\/\//i.test(cleaned)) return '';
  return cleaned;
}

function setStatus(message) {
  els.status.textContent = message;
}

function storageGet(keys) {
  const keyList = Array.isArray(keys) ? keys : [keys];
  return new Promise((resolve) => chrome.storage.local.get(keyList, resolve));
}

function storageSet(data) {
  return new Promise((resolve) => chrome.storage.local.set(data, resolve));
}

function storageRemove(keys) {
  const keyList = Array.isArray(keys) ? keys : [keys];
  return new Promise((resolve) => chrome.storage.local.remove(keyList, resolve));
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
