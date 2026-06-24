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

const DEFAULT_SYSTEM_PROMPT = BUILTIN_TONE_PRESETS[0].prompt;

const els = {
  tabs: document.querySelectorAll('.tab'),
  panelWork: document.getElementById('panelWork'),
  panelStyle: document.getElementById('panelStyle'),
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
  fetchSamplesBtn: document.getElementById('fetchSamplesBtn'),
  analyzeBtn: document.getElementById('analyzeBtn'),
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
let customPresets = [];
let tonePresetId = 'default';
let isApplyingPreset = false;
let sampleFlow = createEmptySampleFlow();
let sampleSaveTimer = null;
let isFetchingSamples = false;
let isAnalyzingSamples = false;

init();

async function init() {
  initTabs();
  renderPresetOptions();

  els.xlsxFile.addEventListener('change', onFileSelected);
  els.fetchBtn.addEventListener('click', onFetchFromSeller);
  els.selectBtn.addEventListener('click', openWorkPage);
  els.clearBtn.addEventListener('click', onClearStorage);
  els.tonePreset.addEventListener('change', onPresetChange);
  els.systemPrompt.addEventListener('input', onSystemPromptInput);
  els.analyzeBtn.addEventListener('click', onAnalyzeSamples);
  els.fetchSamplesBtn.addEventListener('click', onFetchSamplesFromSeller);
  els.sampleFile.addEventListener('change', onSampleFileSelected);
  els.downloadSampleXlsxBtn.addEventListener('click', onDownloadSampleXlsxTemplate);
  els.downloadSampleTxtBtn.addEventListener('click', onDownloadSampleTxtTemplate);
  els.sampleReplies.addEventListener('input', onSampleRepliesInput);
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
  customPresets = settings.customPresets || [];
  tonePresetId = settings.tonePresetId || 'default';
  renderPresetOptions();
  restoreSampleFlow(settings);

  if (settings.systemPrompt) {
    applyPresetSelection(tonePresetId, settings.systemPrompt, false);
  } else {
    applyPresetSelection('default', null, false);
  }

  restoreParseCache(data[CONFIG.PARSE_CACHE_KEY]);
  updateWorkButton(data[CONFIG.DRAFT_KEY]);
  refreshJobStatus();
  updateSampleFlowUI();
}

function initTabs() {
  els.tabs.forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });
}

function switchTab(name) {
  const panels = {
    work: els.panelWork,
    style: els.panelStyle,
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

function createEmptySampleFlow() {
  return {
    source: null,
    sourceLabel: '',
    loadedAt: null,
    loadedCount: 0,
    analyzedAt: null,
    analyzedCount: 0,
    analyzedFingerprint: '',
    fetching: false,
    fetchStartedAt: null,
    analyzing: false,
    analyzeStartedAt: null,
    lastError: '',
    lastErrorAt: null,
  };
}

function resetStaleSampleFlowFlags() {
  const staleMs = 3 * 60 * 1000;
  const now = Date.now();

  if (sampleFlow.fetching && sampleFlow.fetchStartedAt && now - sampleFlow.fetchStartedAt > staleMs) {
    sampleFlow.fetching = false;
    sampleFlow.fetchStartedAt = null;
    sampleFlow.lastError = '가져오기가 시간 초과되었습니다. 다시 시도해 주세요.';
    sampleFlow.lastErrorAt = now;
  }

  if (sampleFlow.analyzing && sampleFlow.analyzeStartedAt && now - sampleFlow.analyzeStartedAt > staleMs) {
    sampleFlow.analyzing = false;
    sampleFlow.analyzeStartedAt = null;
    sampleFlow.lastError = '분석이 시간 초과되었습니다. 다시 시도해 주세요.';
    sampleFlow.lastErrorAt = now;
  }
}

function restoreSampleFlow(settings) {
  if (settings.sampleReplies) {
    els.sampleReplies.value = settings.sampleReplies;
  }
  sampleFlow = {
    ...createEmptySampleFlow(),
    ...(settings.sampleFlow || {}),
  };
  resetStaleSampleFlowFlags();
  isFetchingSamples = !!sampleFlow.fetching;
  isAnalyzingSamples = !!sampleFlow.analyzing;

  if (sampleFlow.analyzedAt && !sampleFlow.analyzedFingerprint && els.sampleReplies.value.trim()) {
    sampleFlow.analyzedFingerprint = getSampleFingerprint();
  }
}

function getSampleFingerprint(samples) {
  const list = samples || normalizeSamples(parseReplySamplesFromText(els.sampleReplies.value));
  return list.map((s) => s.slice(0, 120)).join('\n---\n');
}

function onSampleRepliesInput() {
  updateSampleCount();
  scheduleSaveSampleFlow();

  const count = normalizeSamples(parseReplySamplesFromText(els.sampleReplies.value)).length;
  if (count >= 2) {
    if (!sampleFlow.loadedAt || sampleFlow.source === 'paste') {
      markSampleLoaded({
        source: 'paste',
        sourceLabel: '직접 입력',
        count,
      });
    } else if (sampleFlow.loadedCount !== count) {
      sampleFlow.loadedCount = count;
      invalidateSampleAnalysis('샘플 내용이 변경되었습니다. 다시 [샘플 분석]을 실행하세요.');
    }
  } else {
    sampleFlow.loadedAt = null;
    sampleFlow.loadedCount = 0;
    sampleFlow.source = null;
    sampleFlow.sourceLabel = '';
    invalidateSampleAnalysis('샘플 2개 이상 필요합니다.');
  }

  updateSampleFlowUI();
}

function markSampleLoaded({ source, sourceLabel, count }) {
  sampleFlow.source = source;
  sampleFlow.sourceLabel = sourceLabel;
  sampleFlow.loadedAt = Date.now();
  sampleFlow.loadedCount = count;
  sampleFlow.lastError = '';
  sampleFlow.lastErrorAt = null;
  sampleFlow.fetching = false;
  invalidateSampleAnalysis(null, false);
  scheduleSaveSampleFlow();
  updateSampleFlowUI();
}

function invalidateSampleAnalysis(message, updateUi = true) {
  const fingerprint = getSampleFingerprint();
  if (sampleFlow.analyzedAt && sampleFlow.analyzedFingerprint !== fingerprint) {
    sampleFlow.analyzedAt = null;
    sampleFlow.analyzedCount = 0;
    sampleFlow.analyzedFingerprint = '';
    if (message) setSampleFlowStatus(message, 'warn');
    else if (updateUi) updateSampleFlowUI();
    scheduleSaveSampleFlow();
    return true;
  }
  if (message) setSampleFlowStatus(message, 'warn');
  else if (updateUi) updateSampleFlowUI();
  return false;
}

function markSampleAnalyzed(count) {
  sampleFlow.analyzedAt = Date.now();
  sampleFlow.analyzedCount = count;
  sampleFlow.analyzedFingerprint = getSampleFingerprint();
  scheduleSaveSampleFlow();
  updateSampleFlowUI();
}

function setSampleFlowStatus(message, variant = '') {
  els.sampleFlowStatus.textContent = message;
  els.sampleFlowStatus.className = 'sample-flow-status';
  if (variant) els.sampleFlowStatus.classList.add(variant);
}

function formatSampleTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function updateSampleFlowUI() {
  const count = normalizeSamples(parseReplySamplesFromText(els.sampleReplies.value)).length;
  const hasSamples = count >= 2;
  const isAnalyzed =
    !!sampleFlow.analyzedAt &&
    sampleFlow.analyzedFingerprint === getSampleFingerprint();
  const isApplied = tonePresetId === 'learned' && findPreset('learned', customPresets);
  const needsReanalysis = hasSamples && sampleFlow.analyzedAt && !isAnalyzed;

  els.sampleStepLoad.className = 'sample-step';
  els.sampleStepAnalyze.className = 'sample-step';
  els.sampleStepApply.className = 'sample-step';

  if (hasSamples) {
    els.sampleStepLoad.classList.add('done');
    els.sampleStepLoad.textContent = `① 샘플 ${count}개`;
  } else {
    els.sampleStepLoad.textContent = '① 샘플 준비';
  }

  if (isAnalyzed) {
    els.sampleStepAnalyze.classList.add('done');
    els.sampleStepAnalyze.textContent = '② 분석 완료';
  } else if (needsReanalysis) {
    els.sampleStepAnalyze.classList.add('stale');
    els.sampleStepAnalyze.textContent = '② 재분석 필요';
  } else if (hasSamples) {
    els.sampleStepAnalyze.classList.add('active');
    els.sampleStepAnalyze.textContent = '② 분석 대기';
  } else {
    els.sampleStepAnalyze.textContent = '② 분석';
  }

  if (isApplied && isAnalyzed) {
    els.sampleStepApply.classList.add('done');
    els.sampleStepApply.textContent = '③ 적용됨';
  } else if (isAnalyzed) {
    els.sampleStepApply.classList.add('active');
    els.sampleStepApply.textContent = '③ 적용 대기';
  } else {
    els.sampleStepApply.textContent = '③ 적용';
  }

  els.sampleCount.textContent = `샘플 ${count}개${
    count >= 2 ? ' · 분석 가능' : ' · 2개 이상 필요'
  }`;

  if (isFetchingSamples || sampleFlow.fetching) {
    els.fetchSamplesBtn.disabled = true;
    els.fetchSamplesBtn.textContent = '가져오는 중...';
    els.fetchSamplesBtn.classList.add('loading');
    setSampleFlowStatus('판매자센터에서 답글이 달린 리뷰를 찾는 중...', 'loading');
    return;
  }

  if (isAnalyzingSamples || sampleFlow.analyzing) {
    els.analyzeBtn.disabled = true;
    els.analyzeBtn.classList.add('loading');
    els.analyzeBtn.textContent = '분석 중...';
    setSampleFlowStatus('Gemini가 샘플 답글 스타일을 분석하는 중입니다...', 'loading');
    return;
  }

  els.fetchSamplesBtn.disabled = false;
  els.fetchSamplesBtn.textContent = '판매자센터 기존 답글 가져오기';
  els.fetchSamplesBtn.classList.remove('loading');
  els.analyzeBtn.disabled = false;
  els.analyzeBtn.classList.remove('loading');

  if (isAnalyzed) {
    els.analyzeBtn.textContent = `✓ 분석 완료 (${sampleFlow.analyzedCount}개) · 다시 분석`;
    els.analyzeBtn.classList.add('done');
  } else {
    els.analyzeBtn.textContent = '샘플 분석 → 프롬프트 생성';
    els.analyzeBtn.classList.remove('done');
  }

  if (sampleFlow.lastError && !hasSamples && !isAnalyzed) {
    setSampleFlowStatus(sampleFlow.lastError, 'error');
    return;
  }

  if (isAnalyzed && isApplied) {
    setSampleFlowStatus(
      `✓ 완료 · ${sampleFlow.sourceLabel || '샘플'} ${count}개 → 분석 ${sampleFlow.analyzedCount}개 (${formatSampleTime(sampleFlow.analyzedAt)})\n「내 스타일」 프리셋이 적용 중입니다.`,
      'success'
    );
    return;
  }

  if (isAnalyzed) {
    setSampleFlowStatus(
      `✓ 분석 완료 · ${sampleFlow.analyzedCount}개 (${formatSampleTime(sampleFlow.analyzedAt)})\n톤 프리셋에서 「내 스타일」을 선택하세요.`,
      'success'
    );
    return;
  }

  if (hasSamples && sampleFlow.loadedAt) {
    const next = needsReanalysis
      ? '샘플이 변경되어 다시 분석이 필요합니다.'
      : '[샘플 분석 → 프롬프트 생성] 버튼을 눌러 주세요.';
    setSampleFlowStatus(
      `✓ ${sampleFlow.sourceLabel || '샘플'} ${count}개 준비됨 (${formatSampleTime(sampleFlow.loadedAt)})\n${next}`,
      needsReanalysis ? 'warn' : 'success'
    );
    return;
  }

  if (count > 0 && count < 2) {
    setSampleFlowStatus('샘플이 1개뿐입니다. 1개 더 추가하거나 [판매자센터 기존 답글 가져오기]를 사용하세요.', 'warn');
    return;
  }

  setSampleFlowStatus(
    '답글 샘플 2개 이상을 준비한 뒤 [샘플 분석]을 누르세요.\n직접 입력 · 파일 업로드 · 판매자센터 가져오기 중 하나를 사용할 수 있습니다.'
  );
}

function updateSampleCount() {
  const count = normalizeSamples(parseReplySamplesFromText(els.sampleReplies.value)).length;
  els.sampleCount.textContent = `샘플 ${count}개${count >= 2 ? ' · 분석 가능' : ' · 2개 이상 필요'}`;
}

function scheduleSaveSampleFlow() {
  clearTimeout(sampleSaveTimer);
  sampleSaveTimer = setTimeout(saveSampleFlow, 300);
}

async function saveSampleFlow() {
  await saveSampleFlowNow();
}

async function saveSampleFlowNow() {
  const settings = (await storageGet([CONFIG.SETTINGS_KEY]))[CONFIG.SETTINGS_KEY] || {};
  await storageSet({
    [CONFIG.SETTINGS_KEY]: {
      ...settings,
      sampleReplies: els.sampleReplies.value,
      sampleFlow,
    },
  });
}

function renderPresetOptions() {
  const select = els.tonePreset;
  select.innerHTML = '';

  const builtinGroup = document.createElement('optgroup');
  builtinGroup.label = '기본 프리셋';
  for (const preset of BUILTIN_TONE_PRESETS) {
    const opt = document.createElement('option');
    opt.value = preset.id;
    opt.textContent = preset.name;
    builtinGroup.appendChild(opt);
  }
  select.appendChild(builtinGroup);

  if (customPresets.length) {
    const customGroup = document.createElement('optgroup');
    customGroup.label = '내 스타일';
    for (const preset of customPresets) {
      const opt = document.createElement('option');
      opt.value = preset.id;
      opt.textContent = preset.name;
      customGroup.appendChild(opt);
    }
    select.appendChild(customGroup);
  }

  const customOpt = document.createElement('option');
  customOpt.value = CUSTOM_PRESET_ID;
  customOpt.textContent = '직접 작성';
  select.appendChild(customOpt);

  select.value =
    findPreset(tonePresetId, customPresets) || tonePresetId === CUSTOM_PRESET_ID
      ? tonePresetId
      : 'default';
}

function applyPresetSelection(presetId, overridePrompt, save = true) {
  isApplyingPreset = true;
  tonePresetId = presetId;
  els.tonePreset.value = presetId;

  if (presetId === CUSTOM_PRESET_ID) {
    if (overridePrompt != null) els.systemPrompt.value = overridePrompt;
    els.presetNote.textContent = '직접 작성 모드입니다. 아래 지침을 자유롭게 수정하세요.';
  } else {
    const preset = findPreset(presetId, customPresets);
    const prompt = overridePrompt ?? preset?.prompt ?? DEFAULT_SYSTEM_PROMPT;
    els.systemPrompt.value = prompt;
    els.presetNote.textContent = preset
      ? `「${preset.name}」 프리셋이 적용되었습니다. 수정하면 직접 작성으로 전환됩니다.`
      : '프리셋 지침이 적용되었습니다.';
  }

  isApplyingPreset = false;
  if (save) scheduleSaveSettings();
  updateSampleFlowUI();
}

function onPresetChange() {
  const id = els.tonePreset.value;
  if (id === CUSTOM_PRESET_ID) {
    applyPresetSelection(CUSTOM_PRESET_ID, els.systemPrompt.value.trim());
    return;
  }
  applyPresetSelection(id);
}

function onSystemPromptInput() {
  if (isApplyingPreset) return;
  if (tonePresetId !== CUSTOM_PRESET_ID) {
    tonePresetId = CUSTOM_PRESET_ID;
    els.tonePreset.value = CUSTOM_PRESET_ID;
    els.presetNote.textContent = '직접 작성 모드입니다. 아래 지침을 자유롭게 수정하세요.';
  }
  scheduleSaveSettings();
}

function upsertLearnedPreset(prompt, sampleCount) {
  const learned = {
    id: 'learned',
    name: `내 스타일 (샘플 ${sampleCount}개)`,
    prompt,
    updatedAt: Date.now(),
  };
  customPresets = [learned, ...customPresets.filter((p) => p.id !== 'learned')];
}

async function collectSampleReplies() {
  const fromText = normalizeSamples(parseReplySamplesFromText(els.sampleReplies.value));
  if (fromText.length >= 2) return fromText;

  const file = els.sampleFile.files?.[0];
  if (file) {
    if (file.name.match(/\.(xlsx|xls)$/i)) {
      const buffer = await file.arrayBuffer();
      const workbook = readWorkbookSilently(new Uint8Array(buffer), {
        type: 'array',
        dense: true,
        cellStyles: false,
        cellNF: false,
        cellHTML: false,
      });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      return normalizeSamples(parseReplySamplesFromWorkbookRows(rows));
    }
    const text = await file.text();
    return normalizeSamples(parseReplySamplesFromText(text));
  }

  return fromText;
}

async function getSellerTab() {
  const tabs = await new Promise((resolve) => {
    chrome.tabs.query({ url: 'https://sell.smartstore.naver.com/*' }, resolve);
  });
  if (!tabs.length) {
    throw new Error(
      '판매자센터 탭이 없습니다.\n[sell.smartstore.naver.com] 리뷰 관리 페이지를 연 뒤 다시 시도하세요.'
    );
  }
  return tabs.find((t) => t.active) || tabs[0];
}

async function onFetchSamplesFromSeller() {
  isFetchingSamples = true;
  sampleFlow.fetching = true;
  sampleFlow.fetchStartedAt = Date.now();
  sampleFlow.lastError = '';
  sampleFlow.lastErrorAt = null;
  await saveSampleFlowNow();
  updateSampleFlowUI();

  const days = Math.max(Number(els.fetchDays?.value) || 30, 14);

  try {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: 'FETCH_SELLER_SAMPLES_JOB',
          payload: { days, maxSamples: 15 },
        },
        (res) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!res?.ok) {
            reject(new Error(res?.error || '가져오기 실패'));
            return;
          }
          resolve(res);
        }
      );
    });

    const settings = (await storageGet([CONFIG.SETTINGS_KEY]))[CONFIG.SETTINGS_KEY] || {};
    restoreSampleFlow(settings);
    isFetchingSamples = false;
    updateSampleCount();
    updateSampleFlowUI();
    setSampleFlowStatus(
      `✓ 판매자센터에서 답글 ${response.sampleCount}개를 가져왔습니다. (${response.repliedCount || '?'}건 중)\n다음: [샘플 분석 → 프롬프트 생성]을 누르세요.`,
      'success'
    );
  } catch (err) {
    const settings = (await storageGet([CONFIG.SETTINGS_KEY]))[CONFIG.SETTINGS_KEY] || {};
    restoreSampleFlow(settings);
    isFetchingSamples = false;
    updateSampleFlowUI();
  }
}

function onDownloadSampleXlsxTemplate() {
  try {
    const rows = getSampleReplyTemplateRows();
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, '샘플답글');
    XLSX.writeFile(workbook, '답글샘플_양식.xlsx');
    setStatus('엑셀 양식을 다운로드했습니다. 예시를 참고해 답글을 작성한 뒤 업로드하세요.');
  } catch (err) {
    setStatus(`양식 다운로드 오류: ${err.message}`);
  }
}

function onDownloadSampleTxtTemplate() {
  try {
    const text = getSampleReplyTemplateText();
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = '답글샘플_양식.txt';
    link.click();
    URL.revokeObjectURL(url);
    setStatus('텍스트 양식을 다운로드했습니다. 예시를 참고해 답글을 작성한 뒤 업로드하세요.');
  } catch (err) {
    setStatus(`양식 다운로드 오류: ${err.message}`);
  }
}

async function onSampleFileSelected(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    if (file.name.match(/\.(xlsx|xls)$/i)) {
      const buffer = await file.arrayBuffer();
      const workbook = readWorkbookSilently(new Uint8Array(buffer), {
        type: 'array',
        dense: true,
        cellStyles: false,
        cellNF: false,
        cellHTML: false,
      });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      const samples = normalizeSamples(parseReplySamplesFromWorkbookRows(rows));
      els.sampleReplies.value = samples.join('\n\n---\n\n');
      markSampleLoaded({
        source: 'file',
        sourceLabel: `파일 (${file.name})`,
        count: samples.length,
      });
      updateSampleCount();
      setSampleFlowStatus(
        `✓ 파일에서 샘플 ${samples.length}개를 불러왔습니다.\n다음: [샘플 분석 → 프롬프트 생성]을 누르세요.`,
        'success'
      );
    } else {
      const text = await file.text();
      const samples = normalizeSamples(parseReplySamplesFromText(text));
      els.sampleReplies.value = samples.join('\n\n---\n\n');
      markSampleLoaded({
        source: 'file',
        sourceLabel: `파일 (${file.name})`,
        count: samples.length,
      });
      updateSampleCount();
      setSampleFlowStatus(
        `✓ 파일에서 샘플 ${samples.length}개를 불러왔습니다.\n다음: [샘플 분석 → 프롬프트 생성]을 누르세요.`,
        'success'
      );
    }
  } catch (err) {
    setSampleFlowStatus(`샘플 파일 오류: ${err.message}`, 'error');
    updateSampleFlowUI();
  }
}

async function onAnalyzeSamples() {
  const apiKey = els.apiKey.value.trim() || CONFIG.GEMINI_API_KEY || '';
  if (!apiKey || apiKey.includes('YOUR_GEMINI')) {
    setSampleFlowStatus('Gemini API 키를 [설정] 탭에서 먼저 입력하세요.', 'warn');
    return;
  }

  let samples;
  try {
    samples = await collectSampleReplies();
    if (samples.length < 2) {
      throw new Error(
        '샘플 답글이 2개 이상 필요합니다.\n직접 입력, 파일 업로드, 또는 [판매자센터에서 기존 답글 가져오기]를 사용하세요.'
      );
    }
  } catch (err) {
    setSampleFlowStatus(`분석 오류: ${err.message}`, 'error');
    updateSampleFlowUI();
    return;
  }

  isAnalyzingSamples = true;
  sampleFlow.analyzing = true;
  sampleFlow.analyzeStartedAt = Date.now();
  sampleFlow.lastError = '';
  await saveSampleFlowNow();
  updateSampleFlowUI();

  try {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: 'ANALYZE_TONE_SAMPLES_JOB',
          payload: {
            apiKey,
            samples,
            model: CONFIG.GEMINI_MODEL,
          },
        },
        (res) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!res?.ok) {
            reject(new Error(res?.error || '분석 실패'));
            return;
          }
          resolve(res);
        }
      );
    });

    const settings = (await storageGet([CONFIG.SETTINGS_KEY]))[CONFIG.SETTINGS_KEY] || {};
    customPresets = settings.customPresets || [];
    tonePresetId = settings.tonePresetId || 'learned';
    renderPresetOptions();
    restoreSampleFlow(settings);
    sampleFlow.analyzedFingerprint = getSampleFingerprint(samples);
    isAnalyzingSamples = false;
    applyPresetSelection('learned', response.prompt, true);
    await saveSampleFlowNow();
    setSampleFlowStatus(
      `✓ 분석 완료 · 샘플 ${response.sampleCount}개로 「내 스타일」 프리셋을 만들었습니다.\nAI 답글 생성 시 이 톤이 적용됩니다.`,
      'success'
    );
    updateSampleFlowUI();
  } catch (err) {
    const settings = (await storageGet([CONFIG.SETTINGS_KEY]))[CONFIG.SETTINGS_KEY] || {};
    restoreSampleFlow(settings);
    isAnalyzingSamples = false;
    updateSampleFlowUI();
  }
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
    <div class="next-step">[리뷰 답글 작업 열기] 클릭</div>
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
  const existing = (await storageGet([CONFIG.SETTINGS_KEY]))[CONFIG.SETTINGS_KEY] || {};
  await storageSet({
    [CONFIG.SETTINGS_KEY]: {
      ...existing,
      apiKey: els.apiKey.value.trim(),
      systemPrompt: els.systemPrompt.value.trim(),
      tonePresetId,
      customPresets,
      sampleReplies: els.sampleReplies.value,
      sampleFlow,
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
    const tab = await getSellerTab();
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
  if (changes[CONFIG.SETTINGS_KEY]) {
    const settings = changes[CONFIG.SETTINGS_KEY].newValue || {};
    if (settings.sampleFlow || settings.sampleReplies != null) {
      restoreSampleFlow(settings);
      updateSampleCount();
      updateSampleFlowUI();
    }
    if (settings.customPresets || settings.tonePresetId || settings.systemPrompt) {
      customPresets = settings.customPresets || customPresets;
      if (settings.tonePresetId && settings.tonePresetId !== tonePresetId) {
        tonePresetId = settings.tonePresetId;
        renderPresetOptions();
        applyPresetSelection(tonePresetId, settings.systemPrompt, false);
      }
    }
  }
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
