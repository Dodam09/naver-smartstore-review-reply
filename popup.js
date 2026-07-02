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


const INQUIRY_DRAFT_KEY = CONFIG.INQUIRY_DRAFT_KEY || 'smartstoreInquiryDraft';
const INQUIRY_PARSE_CACHE_KEY = CONFIG.INQUIRY_PARSE_CACHE_KEY || 'smartstoreInquiryParseCache';
const INQUIRY_STORAGE_KEY = CONFIG.INQUIRY_STORAGE_KEY || 'smartstoreInquiryReplies';
const INQUIRY_APPLY_ENABLED_KEY = CONFIG.INQUIRY_APPLY_ENABLED_KEY || 'smartstoreInquiryApplyEnabled';
const INQUIRY_PROGRESS_KEY = CONFIG.INQUIRY_PROGRESS_KEY || 'smartstoreInquiryJobProgress';
const INQUIRY_REFERENCE_CACHE_KEY = CONFIG.INQUIRY_REFERENCE_CACHE_KEY || 'smartstoreInquiryReferenceCache';

const els = {
  tabs: document.querySelectorAll('.tab'),
  panelWork: document.getElementById('panelWork'),
  panelInquiry: document.getElementById('panelInquiry'),
  panelSettings: document.getElementById('panelSettings'),
  apiKey: document.getElementById('apiKey'),
  tonePreset: document.getElementById('tonePreset'),
  presetNote: document.getElementById('presetNote'),
  systemPrompt: document.getElementById('systemPrompt'),
  sampleReplies: document.getElementById('sampleReplies'),
  sampleCount: document.getElementById('sampleCount'),
  sampleFlowStatus: document.getElementById('sampleFlowStatus'),
  sampleStepLoad: document.getElementById('sampleStepLoad'),
  sampleStepAnalyze: document.getElementById('sampleStepAnalyze'),
  sampleStepApply: document.getElementById('sampleStepApply'),
  sampleFile: document.getElementById('sampleFile'),
  downloadSampleXlsxBtn: document.getElementById('downloadSampleXlsxBtn'),
  downloadSampleTxtBtn: document.getElementById('downloadSampleTxtBtn'),
  openStylePickBtn: document.getElementById('openStylePickBtn'),
  openInquiryStylePickBtn: document.getElementById('openInquiryStylePickBtn'),
  analyzeBtn: document.getElementById('analyzeBtn'),
  inquiryTonePreset: document.getElementById('inquiryTonePreset'),
  inquiryPresetNote: document.getElementById('inquiryPresetNote'),
  inquirySystemPrompt: document.getElementById('inquirySystemPrompt'),
  inquirySampleReplies: document.getElementById('inquirySampleReplies'),
  inquirySampleCount: document.getElementById('inquirySampleCount'),
  inquirySampleFlowStatus: document.getElementById('inquirySampleFlowStatus'),
  inquirySampleStepLoad: document.getElementById('inquirySampleStepLoad'),
  inquirySampleStepAnalyze: document.getElementById('inquirySampleStepAnalyze'),
  inquirySampleStepApply: document.getElementById('inquirySampleStepApply'),
  inquirySampleFile: document.getElementById('inquirySampleFile'),
  inquiryDownloadSampleXlsxBtn: document.getElementById('inquiryDownloadSampleXlsxBtn'),
  inquiryDownloadSampleTxtBtn: document.getElementById('inquiryDownloadSampleTxtBtn'),
  inquiryAnalyzeBtn: document.getElementById('inquiryAnalyzeBtn'),
  fetchDays: document.getElementById('fetchDays'),
  fetchBtn: document.getElementById('fetchBtn'),
  xlsxFile: document.getElementById('xlsxFile'),
  selectBtn: document.getElementById('selectBtn'),
  clearBtn: document.getElementById('clearBtn'),
  status: document.getElementById('status'),
  fileSummary: document.getElementById('fileSummary'),
  inquiryFetchDays: document.getElementById('inquiryFetchDays'),
  inquiryFetchBtn: document.getElementById('inquiryFetchBtn'),
  inquirySelectBtn: document.getElementById('inquirySelectBtn'),
  inquiryApplyHint: document.getElementById('inquiryApplyHint'),
  inquiryStatus: document.getElementById('inquiryStatus'),
  inquirySummary: document.getElementById('inquirySummary'),
  reviewFlow1: document.getElementById('reviewFlow1'),
  reviewFlow2: document.getElementById('reviewFlow2'),
  inquiryFlow1: document.getElementById('inquiryFlow1'),
  inquiryFlow2: document.getElementById('inquiryFlow2'),
};

let parsedRows = [];
let columnMap = {};
let parseMeta = null;
let selectedIds = new Set();
let jobPollTimer = null;
let settingsSaveTimer = null;
let inquiryRows = [];
let inquiryJobPollTimer = null;
let reviewStyle;
let inquiryStyle;

init();

async function init() {
  initTabs();

  reviewStyle = createStyleChannel({
    channelId: 'review',
    label: '리뷰',
    builtinPresets: BUILTIN_TONE_PRESETS,
    learnedPresetId: REVIEW_LEARNED_PRESET_ID,
    storageKeys: {
      systemPrompt: 'systemPrompt',
      tonePresetId: 'tonePresetId',
      customPresets: 'customPresets',
      sampleReplies: 'sampleReplies',
      sampleFlow: 'sampleFlow',
    },
    els: {
      tonePreset: els.tonePreset,
      presetNote: els.presetNote,
      systemPrompt: els.systemPrompt,
      sampleReplies: els.sampleReplies,
      sampleCount: els.sampleCount,
      sampleFlowStatus: els.sampleFlowStatus,
      sampleStepLoad: els.sampleStepLoad,
      sampleStepAnalyze: els.sampleStepAnalyze,
      sampleStepApply: els.sampleStepApply,
      sampleFile: els.sampleFile,
      downloadSampleXlsxBtn: els.downloadSampleXlsxBtn,
      downloadSampleTxtBtn: els.downloadSampleTxtBtn,
      openStylePickBtn: els.openStylePickBtn,
      analyzeBtn: els.analyzeBtn,
    },
    getApiKey: () => els.apiKey.value.trim() || CONFIG.GEMINI_API_KEY || '',
    getModel: () => CONFIG.GEMINI_MODEL,
    onSettingsDirty: scheduleSaveSettings,
    features: { stylePick: true },
  });

  inquiryStyle = createStyleChannel({
    channelId: 'inquiry',
    label: '문의',
    builtinPresets: BUILTIN_INQUIRY_TONE_PRESETS,
    learnedPresetId: INQUIRY_LEARNED_PRESET_ID,
    storageKeys: {
      systemPrompt: 'inquirySystemPrompt',
      tonePresetId: 'inquiryTonePresetId',
      customPresets: 'inquiryCustomPresets',
      sampleReplies: 'inquirySampleReplies',
      sampleFlow: 'inquirySampleFlow',
    },
    els: {
      tonePreset: els.inquiryTonePreset,
      presetNote: els.inquiryPresetNote,
      systemPrompt: els.inquirySystemPrompt,
      sampleReplies: els.inquirySampleReplies,
      sampleCount: els.inquirySampleCount,
      sampleFlowStatus: els.inquirySampleFlowStatus,
      sampleStepLoad: els.inquirySampleStepLoad,
      sampleStepAnalyze: els.inquirySampleStepAnalyze,
      sampleStepApply: els.inquirySampleStepApply,
      sampleFile: els.inquirySampleFile,
      downloadSampleXlsxBtn: els.inquiryDownloadSampleXlsxBtn,
      downloadSampleTxtBtn: els.inquiryDownloadSampleTxtBtn,
      openStylePickBtn: els.openInquiryStylePickBtn,
      analyzeBtn: els.inquiryAnalyzeBtn,
    },
    getApiKey: () => els.apiKey.value.trim() || CONFIG.GEMINI_API_KEY || '',
    getModel: () => CONFIG.GEMINI_MODEL,
    onSettingsDirty: scheduleSaveSettings,
    features: { stylePick: true },
  });

  reviewStyle.bindEvents();
  inquiryStyle.bindEvents();

  els.xlsxFile.addEventListener('change', onFileSelected);
  els.fetchBtn.addEventListener('click', onFetchFromSeller);
  els.inquiryFetchBtn.addEventListener('click', onFetchInquiries);
  els.inquirySelectBtn.addEventListener('click', openInquiryWorkPage);
  els.selectBtn.addEventListener('click', openWorkPage);
  els.clearBtn.addEventListener('click', onClearStorage);
  els.openStylePickBtn.addEventListener('click', openStylePickPage);
  els.openInquiryStylePickBtn.addEventListener('click', openInquiryStylePickPage);
  els.apiKey.addEventListener('input', scheduleSaveSettings);
  els.fetchDays.addEventListener('change', scheduleSaveSettings);
  els.inquiryFetchDays.addEventListener('change', scheduleSaveSettings);

  chrome.storage.onChanged.addListener(onStorageChanged);

  const data = await storageGet([
    CONFIG.SETTINGS_KEY,
    CONFIG.PARSE_CACHE_KEY,
    CONFIG.PROGRESS_KEY,
    CONFIG.DRAFT_KEY,
    CONFIG.APPLY_ENABLED_KEY,
    INQUIRY_PARSE_CACHE_KEY,
    INQUIRY_STORAGE_KEY,
    INQUIRY_APPLY_ENABLED_KEY,
    INQUIRY_DRAFT_KEY,
    INQUIRY_PROGRESS_KEY,
  ]);

  const settings = data[CONFIG.SETTINGS_KEY] || {};
  els.apiKey.value = settings.apiKey || CONFIG.GEMINI_API_KEY || '';
  renderLookupDayOptions(els.fetchDays, {
    includeLong: true,
    selected: settings.reviewLookupDays ?? 7,
  });
  renderLookupDayOptions(els.inquiryFetchDays, {
    includeLong: true,
    selected: settings.inquiryLookupDays ?? 7,
  });
  reviewStyle.initFromSettings(settings);
  inquiryStyle.initFromSettings(settings);

  restoreParseCache(data[CONFIG.PARSE_CACHE_KEY]);
  restoreInquiryCache(data[INQUIRY_PARSE_CACHE_KEY]);
  updateWorkButton(data[CONFIG.DRAFT_KEY]);
  updateInquiryWorkButton(data[INQUIRY_DRAFT_KEY]);
  refreshInquiryApplyHint();
  refreshJobStatus();
  refreshInquiryJobStatus();
  updateReviewFlowBar();
  updateInquiryFlowBar();
}

function updateReviewFlowBar() {
  const hasData = parsedRows.length > 0;
  els.reviewFlow1?.classList.toggle('done', hasData);
  els.reviewFlow1?.classList.toggle('active', !hasData);
  els.reviewFlow2?.classList.toggle('active', hasData);
  els.reviewFlow2?.classList.toggle('done', false);
}

function updateInquiryFlowBar() {
  const hasData = inquiryRows.length > 0;
  els.inquiryFlow1?.classList.toggle('done', hasData);
  els.inquiryFlow1?.classList.toggle('active', !hasData);
  els.inquiryFlow2?.classList.toggle('active', hasData);
  els.inquiryFlow2?.classList.toggle('done', false);
}

function initTabs() {
  els.tabs.forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });
}

function switchTab(name) {
  const panels = {
    work: els.panelWork,
    inquiry: els.panelInquiry,
    settings: els.panelSettings,
  };

  els.tabs.forEach((tab) => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle('active', active);
  });

  Object.entries(panels).forEach(([key, panel]) => {
    panel.classList.toggle('active', key === name);
  });
}

function openStylePickPage() {
  chrome.tabs.create({ url: chrome.runtime.getURL('style-pick.html') });
}

function openInquiryStylePickPage() {
  chrome.tabs.create({ url: chrome.runtime.getURL('inquiry-style-pick.html') });
}

function openInquiryWorkPage() {
  chrome.storage.local.get([INQUIRY_DRAFT_KEY], (result) => {
    const hasDraft = (result[INQUIRY_DRAFT_KEY]?.items?.length || 0) > 0;
    const hash = hasDraft ? '#review' : '';
    chrome.tabs.create({ url: chrome.runtime.getURL(`inquiry-select.html${hash}`) });
  });
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
      ? `② 이어서 답글 만들기 (확인 ${count}건) →`
      : `② 답글 만들기 시작 (${parsedRows.length}건) →`;
  } else {
    els.selectBtn.textContent = count
      ? `② 이어서 답글 만들기 (확인 ${count}건) →`
      : '② 답글 만들기 시작 →';
  }
  updateReviewFlowBar();
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
    els.selectBtn.textContent = '② 답글 만들기 시작 →';
    updateReviewFlowBar();
    return;
  }

  els.fileSummary.classList.add('visible');
  els.fileSummary.innerHTML = `
    <div><strong>${parsedRows.length}</strong>건 준비됨</div>
    <div>${parseMeta?.fileName || '판매자센터'}</div>
    <div class="next-step">아래 「답글 만들기 시작」을 누르세요</div>
  `;
  els.selectBtn.disabled = false;
  chrome.storage.local.get([CONFIG.DRAFT_KEY], (r) => updateWorkButton(r[CONFIG.DRAFT_KEY]));
  updateReviewFlowBar();
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
  const existing = (await storageGet([CONFIG.SETTINGS_KEY]))[CONFIG.SETTINGS_KEY] || {};
  await storageSet({
    [CONFIG.SETTINGS_KEY]: {
      ...existing,
      apiKey: els.apiKey.value.trim(),
      reviewLookupDays: clampLookupDays(els.fetchDays.value, { min: 0, max: 90, fallback: 7 }),
      inquiryLookupDays: clampLookupDays(els.inquiryFetchDays.value, { min: 0, max: 365, fallback: 7 }),
      ...reviewStyle.patchSettings(existing),
      ...inquiryStyle.patchSettings(existing),
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
  const days = clampLookupDays(els.fetchDays.value, { min: 0, max: 90, fallback: 7 });
  els.fetchBtn.disabled = true;
  setStatus(`판매자센터에서 ${formatLookupDaysLabel(days)} 리뷰를 가져오는 중...`);

  try {
    const response = await sendTabMessage(null, {
      type: 'FETCH_REVIEWS',
      payload: { days, onlyUnreplied: true },
    });

    if (!response?.ok) {
      throw new Error(response?.error || '가져오기 실패');
    }

    await applyImportedRows(response, response.sourceLabel || `판매자센터 (${formatLookupDaysLabel(days)})`);
  } catch (err) {
    const msg = err.message || String(err);
    if (/Receiving end does not exist|Could not establish connection/i.test(msg)) {
      setStatus(
        '판매자센터 페이지와 연결되지 않았습니다.\n\n' +
          '1. [리뷰 관리] 페이지(sell.smartstore.naver.com)에서 F5\n' +
          '2. chrome://extensions 에서 확장 프로그램 [새로고침]\n' +
          '3. 다시 시도'
      );
    } else {
      setStatus(`오류: ${msg}`);
    }
  } finally {
    els.fetchBtn.disabled = false;
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
  const statusMessage = `${parsedRows.length}건 가져왔어요.\n아래 「답글 만들기 시작」을 누르세요.`;
  setStatus(statusMessage);
  updateFileSummary();
  highlightSelectButton();
  await saveParseCache(statusMessage);
  await saveSettings();
}

function restoreInquiryCache(cache) {
  if (!cache?.inquiryRows?.length) {
    updateInquirySummary();
    return;
  }

  inquiryRows = cache.inquiryRows;
  if (cache.statusMessage) setInquiryStatus(cache.statusMessage);
  updateInquirySummary(Object.keys(cache.replies || {}).length);
  chrome.storage.local.get([INQUIRY_DRAFT_KEY], (r) => updateInquiryWorkButton(r[INQUIRY_DRAFT_KEY]));
}

function updateInquirySummary(replyCount = 0) {
  if (!inquiryRows.length) {
    els.inquirySummary.classList.remove('visible');
    els.inquirySelectBtn.disabled = true;
    els.inquirySelectBtn.textContent = '② 답글 만들기 시작 →';
    updateInquiryFlowBar();
    return;
  }

  els.inquirySummary.classList.add('visible');
  const replyHint = replyCount > 0 ? `<div>만든 답글 ${replyCount}건</div>` : '';
  els.inquirySummary.innerHTML = `
    <div><strong>${inquiryRows.length}</strong>건 준비됨</div>
    ${replyHint}
    <div class="next-step">아래 「답글 만들기 시작」을 누르세요</div>
  `;
  els.inquirySelectBtn.disabled = false;
  chrome.storage.local.get([INQUIRY_DRAFT_KEY], (r) => updateInquiryWorkButton(r[INQUIRY_DRAFT_KEY]));
  updateInquiryFlowBar();
}

function updateInquiryApplyHint(applyEnabled, draftCount = 0) {
  if (!els.inquiryApplyHint) return;
  if (applyEnabled && draftCount > 0) {
    els.inquiryApplyHint.textContent =
      '✓ 판매자센터에 넣기 준비됨 — 상품문의에서 [답글]만 누르면 자동으로 채워집니다.';
    els.inquiryApplyHint.style.color = '#0a7a3f';
    els.inquiryApplyHint.style.fontWeight = '600';
    return;
  }
  els.inquiryApplyHint.textContent =
    '답글을 만든 뒤, 작업 화면에서 「판매자센터에 넣기 준비」를 누르면 [답글] 클릭 시 자동으로 채워집니다.';
  els.inquiryApplyHint.style.color = '';
  els.inquiryApplyHint.style.fontWeight = '';
}

function refreshInquiryApplyHint() {
  chrome.storage.local.get([INQUIRY_APPLY_ENABLED_KEY, INQUIRY_DRAFT_KEY], (data) => {
    updateInquiryApplyHint(
      !!data[INQUIRY_APPLY_ENABLED_KEY],
      data[INQUIRY_DRAFT_KEY]?.items?.length || 0
    );
  });
}

function updateInquiryWorkButton(draft) {
  const draftCount = draft?.items?.length || 0;
  if (inquiryRows.length) {
    els.inquirySelectBtn.textContent = draftCount
      ? `② 이어서 답글 만들기 (확인 ${draftCount}건) →`
      : `② 답글 만들기 시작 (${inquiryRows.length}건) →`;
  } else {
    els.inquirySelectBtn.textContent = draftCount
      ? `② 이어서 답글 만들기 (확인 ${draftCount}건) →`
      : '② 답글 만들기 시작 →';
  }
  els.inquirySelectBtn.disabled = !inquiryRows.length && !draftCount;
  updateInquiryFlowBar();
}

async function saveInquiryCache(statusMessage, replies, sourceLabel) {
  if (!inquiryRows.length) {
    await storageRemove(INQUIRY_PARSE_CACHE_KEY);
    return;
  }

  await storageSet({
    [INQUIRY_PARSE_CACHE_KEY]: {
      inquiryRows,
      selectedIds: inquiryRows.map((row) => row.id),
      sourceLabel: sourceLabel || '',
      statusMessage: statusMessage || '',
      replies: replies || {},
      savedAt: Date.now(),
    },
  });
}

async function onFetchInquiries() {
  const days = clampLookupDays(els.inquiryFetchDays.value, { min: 0, max: 365, fallback: 7 });
  els.inquiryFetchBtn.disabled = true;
  setInquiryStatus(`판매자센터에서 ${formatLookupDaysLabel(days)} 미답변 상품문의를 가져오는 중...`);

  try {
    const response = await sendTabMessage(null, {
      type: 'FETCH_INQUIRIES',
      payload: { days, onlyUnanswered: true, maxItems: 100 },
    });

    if (!response?.ok) {
      throw new Error(response?.error || '가져오기 실패');
    }

    inquiryRows = response.parsedRows || [];
    const sourceLabel = response.sourceLabel || `판매자센터 (${formatLookupDaysLabel(days)})`;
    const statusMessage = `${inquiryRows.length}건 미답변 문의를 가져왔습니다.\n[문의 답글 작업 열기]를 눌러주세요.`;
    setInquiryStatus(statusMessage);
    updateInquirySummary();
    await saveInquiryCache(statusMessage, {}, sourceLabel);
  } catch (err) {
    const msg = err.message || String(err);
    if (/Receiving end does not exist|Could not establish connection/i.test(msg)) {
      setInquiryStatus(
        '판매자센터 페이지와 연결되지 않았습니다.\n\n' +
          '1. [상품문의] 페이지(sell.smartstore.naver.com)에서 F5\n' +
          '2. chrome://extensions 에서 확장 프로그램 [새로고침]\n' +
          '3. 다시 시도'
      );
    } else {
      setInquiryStatus(`오류: ${msg}`);
    }
  } finally {
    els.inquiryFetchBtn.disabled = false;
  }
}

function refreshInquiryJobStatus() {
  chrome.runtime.sendMessage({ type: 'GET_INQUIRY_JOB_STATUS' }, async (response) => {
    if (chrome.runtime.lastError) return;
    await applyInquiryJobUi(response?.job, response?.isRunning);
  });
}

async function applyInquiryJobUi(job, running) {
  if (running) {
    if (job?.message) setInquiryStatus(job.message);
    if (!inquiryJobPollTimer) {
      inquiryJobPollTimer = setInterval(refreshInquiryJobStatus, 1500);
    }
    return;
  }

  if (!job) {
    if (inquiryJobPollTimer) {
      clearInterval(inquiryJobPollTimer);
      inquiryJobPollTimer = null;
    }
    updateInquirySummary();
    return;
  }

  if (job.status === 'running' && !running) {
    if (inquiryJobPollTimer) {
      clearInterval(inquiryJobPollTimer);
      inquiryJobPollTimer = null;
    }
    updateInquirySummary();
    if (job.message) {
      setInquiryStatus(`${job.message}\n(중간에 멈췄어요. 작업 화면에서 다시 만들기를 누르세요.)`);
    }
    return;
  }

  if (inquiryJobPollTimer) {
    clearInterval(inquiryJobPollTimer);
    inquiryJobPollTimer = null;
  }

  updateInquirySummary();

  if (job.message) setInquiryStatus(job.message);

  if (job.status === 'done' || job.status === 'stopped') {
    const data = await storageGet([INQUIRY_STORAGE_KEY, INQUIRY_DRAFT_KEY]);
    const replyCount = Object.keys(data[INQUIRY_STORAGE_KEY] || {}).length;
    updateInquiryWorkButton(data[INQUIRY_DRAFT_KEY]);
    refreshInquiryApplyHint();
    updateInquirySummary(replyCount);
    await saveInquiryCache(job.message, data[INQUIRY_STORAGE_KEY] || {});
  }
}

function setInquiryStatus(message) {
  els.inquiryStatus.textContent = message;
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
  if (changes[CONFIG.SETTINGS_KEY]) {
    const settings = changes[CONFIG.SETTINGS_KEY].newValue || {};
    reviewStyle.syncFromSettings(settings);
    inquiryStyle.syncFromSettings(settings);
  }
  if (changes[CONFIG.PROGRESS_KEY]) {
    chrome.runtime.sendMessage({ type: 'GET_JOB_STATUS' }, (response) => {
      if (chrome.runtime.lastError) return;
      applyJobUi(response?.job ?? changes[CONFIG.PROGRESS_KEY].newValue, response?.isRunning);
    });
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
  if (changes[INQUIRY_PROGRESS_KEY]) {
    chrome.runtime.sendMessage({ type: 'GET_INQUIRY_JOB_STATUS' }, (response) => {
      if (chrome.runtime.lastError) return;
      applyInquiryJobUi(response?.job ?? changes[INQUIRY_PROGRESS_KEY].newValue, response?.isRunning);
    });
  }
  if (changes[INQUIRY_APPLY_ENABLED_KEY] || changes[INQUIRY_DRAFT_KEY]) {
    refreshInquiryApplyHint();
  }
  if (changes[INQUIRY_DRAFT_KEY]) {
    updateInquiryWorkButton(changes[INQUIRY_DRAFT_KEY].newValue);
  }
  if (changes[INQUIRY_STORAGE_KEY]) {
    const count = Object.keys(changes[INQUIRY_STORAGE_KEY].newValue || {}).length;
    if (count) updateInquirySummary(count);
  }
  if (changes[INQUIRY_PARSE_CACHE_KEY]) {
    restoreInquiryCache(changes[INQUIRY_PARSE_CACHE_KEY].newValue);
  }
}

function refreshJobStatus() {
  chrome.runtime.sendMessage({ type: 'GET_JOB_STATUS' }, (response) => {
    if (chrome.runtime.lastError) return;
    applyJobUi(response?.job, response?.isRunning);
  });
}

function applyJobUi(job, activelyRunning) {
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
        setStatus(`만든 답글 ${count}건. 작업 화면 「확인하고 올리기」에서 이어서 하세요.`);
      }
    });
    return;
  }

  if (job.message) setStatus(job.message);

  if (job.status === 'running' && activelyRunning) {
    els.selectBtn.disabled = true;
    els.selectBtn.textContent = `생성 중 (${job.current || 0}/${job.total || '?'})`;
    if (!jobPollTimer) {
      jobPollTimer = setInterval(refreshJobStatus, 1500);
    }
    return;
  }

  if (job.status === 'running' && !activelyRunning) {
    if (jobPollTimer) {
      clearInterval(jobPollTimer);
      jobPollTimer = null;
    }
    updateFileSummary();
    return;
  }

  updateFileSummary();
  if (jobPollTimer) {
    clearInterval(jobPollTimer);
    jobPollTimer = null;
  }

  if (job.status === 'done') {
    setStatus(`${job.message}\n\n작업 화면 「확인하고 올리기」에서 답글을 확인하세요.`);
  } else if (job.status === 'stopped') {
    setStatus(`${job.message}\n\n작업 화면 「확인하고 올리기」에서 이어서 확인하세요.`);
  }
}

async function onClearStorage() {
  const [reviewJob, inquiryJob] = await Promise.all([
    new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_JOB_STATUS' }, (r) => resolve(r?.job));
    }),
    new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_INQUIRY_JOB_STATUS' }, (r) => resolve(r?.job));
    }),
  ]);
  if (reviewJob?.status === 'running') {
    setStatus('답변 생성이 진행 중입니다. 완료 후 삭제하세요.');
    return;
  }
  if (inquiryJob?.status === 'running') {
    setInquiryStatus('문의 답변 생성이 진행 중입니다. 완료 후 삭제하세요.');
    return;
  }

  await storageRemove([
    CONFIG.STORAGE_KEY,
    CONFIG.DRAFT_KEY,
    CONFIG.APPLY_ENABLED_KEY,
    CONFIG.PROGRESS_KEY,
    CONFIG.PARSE_CACHE_KEY,
    INQUIRY_STORAGE_KEY,
    INQUIRY_APPLY_ENABLED_KEY,
    INQUIRY_PROGRESS_KEY,
    INQUIRY_PARSE_CACHE_KEY,
    INQUIRY_DRAFT_KEY,
    INQUIRY_REFERENCE_CACHE_KEY,
  ]);

  parsedRows = [];
  columnMap = {};
  parseMeta = null;
  selectedIds.clear();
  inquiryRows = [];
  els.xlsxFile.value = '';
  refreshInquiryApplyHint();
  updateFileSummary();
  updateInquirySummary();
  setStatus('저장된 내용을 모두 지웠어요.\n다시 가져오기부터 시작하세요.');
  setInquiryStatus('저장된 내용을 모두 지웠어요.\n다시 가져오기부터 시작하세요.');
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
