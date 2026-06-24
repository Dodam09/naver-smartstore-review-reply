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
  fetchDays: document.getElementById('fetchDays'),
  fetchBtn: document.getElementById('fetchBtn'),
  xlsxFile: document.getElementById('xlsxFile'),
  selectBtn: document.getElementById('selectBtn'),
  clearBtn: document.getElementById('clearBtn'),
  status: document.getElementById('status'),
  fileSummary: document.getElementById('fileSummary'),
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
  els.fetchBtn.addEventListener('click', onFetchFromSeller);
  els.selectBtn.addEventListener('click', openWorkPage);
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
  updateWorkButton(data[CONFIG.DRAFT_KEY]);
  refreshJobStatus();
}

function openWorkPage() {
  chrome.storage.local.get([CONFIG.DRAFT_KEY], (result) => {
    const hasDraft = (result[CONFIG.DRAFT_KEY]?.items?.length || 0) > 0;
    const hash = hasDraft ? '#review' : '';
    chrome.tabs.create({ url: chrome.runtime.getURL(`select.html${hash}`) });
  });
}

function updateWorkButton(draft) {
  const count = draft?.items?.length || 0;
  if (parsedRows.length) {
    els.selectBtn.textContent = count
      ? `리뷰 답글 작업 열기 (검토 ${count}건)`
      : `리뷰 답글 작업 열기 (${parsedRows.length}건)`;
  } else {
    els.selectBtn.textContent = count
      ? `리뷰 답글 작업 열기 (검토 ${count}건)`
      : '리뷰 답글 작업 열기';
  }
}

function restoreParseCache(cache) {
  if (!cache?.parsedRows?.length) {
    updateFileSummary();
    return;
  }

  parsedRows = cache.parsedRows;
  columnMap = cache.columnMap || {};
  parseMeta = {
    headers: cache.headers || [],
    skippedReplied: cache.skippedReplied || 0,
    fileName: cache.fileName || '',
  };
  selectedIds = new Set(cache.selectedIds || []);

  updateFileSummary();
  if (cache.statusMessage) {
    setStatus(cache.statusMessage);
  }
}

function updateFileSummary() {
  if (!parsedRows.length) {
    els.fileSummary.classList.remove('visible');
    els.selectBtn.disabled = true;
    els.selectBtn.textContent = '리뷰 답글 작업 열기';
    return;
  }

  els.fileSummary.classList.add('visible');
  els.fileSummary.innerHTML = `
    <div><strong>${parsedRows.length}</strong>건 리뷰 로드됨</div>
    <div>${parseMeta?.fileName || ''}</div>
    <div class="next-step">다음: [리뷰 답글 작업 열기] 버튼 클릭</div>
  `;
  els.selectBtn.disabled = false;
  chrome.storage.local.get([CONFIG.DRAFT_KEY], (r) => updateWorkButton(r[CONFIG.DRAFT_KEY]));
}

function highlightSelectButton() {
  els.selectBtn.classList.remove('highlight');
  void els.selectBtn.offsetWidth;
  els.selectBtn.classList.add('highlight');
  setTimeout(() => els.selectBtn.classList.remove('highlight'), 3000);
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
  const data = new Uint8Array(arrayBuffer);
  const readOptions = {
    type: 'array',
    dense: true,
    cellStyles: false,
    cellNF: false,
    cellHTML: false,
    bookVBA: false,
    bookDeps: false,
  };

  const workbook = readWorkbookSilently(data, readOptions);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (!rows.length) {
    throw new Error('시트가 비어 있습니다.');
  }

  const headers = rows[0].map((h) => String(h).trim());
  const columnMap = detectColumns(headers);

  if (columnMap.id === undefined) {
    throw new Error(`리뷰글번호 컬럼을 찾지 못했습니다. 헤더: ${headers.join(', ')}`);
  }
  if (columnMap.content === undefined) {
    throw new Error(`리뷰상세내용 컬럼을 찾지 못했습니다. 헤더: ${headers.join(', ')}`);
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

function readWorkbookSilently(data, options) {
  const prevError = console.error;
  console.error = (...args) => {
    const msg = String(args[0] ?? '');
    if (
      msg.includes('Bad uncompressed size') ||
      msg.includes('Bad compressed size')
    ) {
      return;
    }
    prevError.apply(console, args);
  };

  try {
    return XLSX.read(data, options);
  } finally {
    console.error = prevError;
  }
}

async function onFetchFromSeller() {
  const days = Number(els.fetchDays.value) || 7;
  els.fetchBtn.disabled = true;
  setStatus(`판매자센터에서 최근 ${days}일 리뷰를 가져오는 중...`);

  try {
    const tabs = await chrome.tabs.query({ url: 'https://sell.smartstore.naver.com/*' });
    if (!tabs.length) {
      throw new Error(
        '판매자센터 탭이 없습니다.\n[sell.smartstore.naver.com] 리뷰 관리 페이지를 연 뒤 다시 시도하세요.'
      );
    }

    const tab = tabs.find((t) => t.active) || tabs[0];
    const response = await sendTabMessage(tab.id, {
      type: 'FETCH_REVIEWS',
      payload: { days, onlyUnreplied: true },
    });

    if (!response?.ok) {
      throw new Error(response?.error || '가져오기 실패');
    }

    await applyImportedRows(response, response.sourceLabel || `판매자센터 (최근 ${days}일)`);
  } catch (err) {
    const msg = err.message || String(err);
    if (/Receiving end does not exist|Could not establish connection/i.test(msg)) {
      setStatus(
        '판매자센터 페이지와 연결되지 않았습니다.\n리뷰 관리 페이지를 새로고침(F5)한 뒤 다시 시도하세요.'
      );
    } else {
      setStatus(`오류: ${msg}`);
    }
  } finally {
    els.fetchBtn.disabled = false;
  }
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

async function applyImportedRows(result, sourceLabel) {
  parsedRows = result.parsedRows;
  columnMap = {
    id: 0,
    content: 1,
    rating: 2,
    product: 3,
    reviewType: 4,
    replyStatus: 5,
  };
  parseMeta = {
    headers: ['리뷰글번호', '리뷰상세내용', '구매자평점', '상품명', '리뷰구분', '답글여부'],
    skippedReplied: result.skippedReplied || 0,
    fileName: sourceLabel,
  };
  selectedIds = new Set();

  const skipMsg = parseMeta.skippedReplied
    ? ` (답글완료 ${parseMeta.skippedReplied}건 제외)`
    : '';
  const statusMessage = `${parsedRows.length}건 가져옴${skipMsg}.\n[리뷰 답글 작업 열기]를 눌러주세요.`;
  setStatus(statusMessage);
  updateFileSummary();
  highlightSelectButton();
  await saveParseCache(statusMessage);
  await saveSettings();
}

async function onFileSelected(event) {
  const file = event.target.files?.[0];
  parsedRows = [];
  columnMap = {};
  selectedIds.clear();
  els.selectBtn.disabled = true;

  if (!file) {
    setStatus('판매자센터에서 가져오거나 엑셀 파일을 선택하세요.');
    updateFileSummary();
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

    const skipMsg = result.skippedReplied
      ? ` (답글완료 ${result.skippedReplied}건 제외)`
      : '';
    const statusMessage = `${parsedRows.length}건 파싱 완료${skipMsg}.\n아래 [리뷰 답글 작업 열기] 버튼을 눌러주세요.`;
    setStatus(statusMessage);
    updateFileSummary();
    highlightSelectButton();
    await saveParseCache(statusMessage);
    await saveSettings();
  } catch (err) {
    setStatus(`오류: ${err.message}`);
    updateFileSummary();
  }
}

function onStorageChanged(changes, area) {
  if (area !== 'local') return;
  if (changes[CONFIG.PROGRESS_KEY]) {
    applyJobUi(changes[CONFIG.PROGRESS_KEY].newValue);
  }
  if (changes[CONFIG.DRAFT_KEY]) {
    updateWorkButton(changes[CONFIG.DRAFT_KEY].newValue);
  }
  if (changes[CONFIG.PARSE_CACHE_KEY]) {
    const cache = changes[CONFIG.PARSE_CACHE_KEY].newValue;
    if (cache?.selectedIds) {
      selectedIds = new Set(cache.selectedIds);
      updateFileSummary();
    }
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
    if (parsedRows.length) return;
    chrome.storage.local.get([CONFIG.DRAFT_KEY, CONFIG.PARSE_CACHE_KEY, CONFIG.APPLY_ENABLED_KEY], (data) => {
      if (data[CONFIG.PARSE_CACHE_KEY]?.statusMessage) {
        setStatus(data[CONFIG.PARSE_CACHE_KEY].statusMessage);
        return;
      }
      const count = data[CONFIG.DRAFT_KEY]?.items?.length || 0;
      if (count > 0) {
        const apply = data[CONFIG.APPLY_ENABLED_KEY] ? ' (적용 활성화됨)' : ' (검토 필요)';
        setStatus(`생성된 답글 ${count}건${apply}. [리뷰 답글 작업 열기]에서 검토 탭을 확인하세요.`);
      }
    });
    return;
  }

  if (job.message) setStatus(job.message);

  if (job.status === 'running') {
    els.selectBtn.disabled = true;
    els.selectBtn.textContent = `생성 중 (${job.current || 0}/${job.total || '?'})`;
    if (!jobPollTimer) {
      jobPollTimer = setInterval(refreshJobStatus, 1500);
    }
    return;
  }

  updateFileSummary();
  if (jobPollTimer) {
    clearInterval(jobPollTimer);
    jobPollTimer = null;
  }

  if (job.status === 'done') {
    setStatus(`${job.message}\n\n작업 화면의 「2. 답글 검토」 탭에서 확인·수정 후 일괄 확인하세요.`);
  } else if (job.status === 'stopped') {
    setStatus(`${job.message}\n\n작업 화면의 「2. 답글 검토」 탭에서 확인·수정 후 일괄 확인하세요.`);
  }
}

async function onClearStorage() {
  const job = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_JOB_STATUS' }, (r) => resolve(r?.job));
  });
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
  els.xlsxFile.value = '';
  updateFileSummary();
  setStatus('저장된 답변·검토 데이터를 삭제했습니다.\n다시 가져오거나 엑셀을 업로드하세요.');
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
