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
const INQUIRY_TEST_DRAFT_KEY = CONFIG.INQUIRY_TEST_DRAFT_KEY || 'smartstoreInquiryTestDraft';

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
  reviewModeWork: document.getElementById('reviewModeWork'),
  reviewModeStyle: document.getElementById('reviewModeStyle'),
  reviewActiveStyleBanner: document.getElementById('reviewActiveStyleBanner'),
  reviewActiveStylePrompt: document.getElementById('reviewActiveStylePrompt'),
  reviewActiveStyleChangeBtn: document.getElementById('reviewActiveStyleChangeBtn'),
  reviewWorkPanel: document.getElementById('reviewWorkPanel'),
  reviewStylePanel: document.getElementById('reviewStylePanel'),
  reviewStyleModeList: document.getElementById('reviewStyleModeList'),
  reviewLearnedPromptEditor: document.getElementById('reviewLearnedPromptEditor'),
  reviewLearnedSystemPrompt: document.getElementById('reviewLearnedSystemPrompt'),
  reviewLearnedSystemPromptPaste: document.getElementById('reviewLearnedSystemPromptPaste'),
  reviewLearnedPromptEditorPaste: document.getElementById('reviewLearnedPromptEditorPaste'),
  reviewLearnedPromptHostPick: document.getElementById('reviewLearnedPromptHostPick'),
  reviewLearnedPromptHostPaste: document.getElementById('reviewLearnedPromptHostPaste'),
  reviewStepFetch: document.getElementById('reviewStepFetch'),
  reviewStepCompose: document.getElementById('reviewStepCompose'),
  reviewGoComposeBtn: document.getElementById('reviewGoComposeBtn'),
  reviewBackFetchBtn: document.getElementById('reviewBackFetchBtn'),
  inquiryFlow1: document.getElementById('inquiryFlow1'),
  inquiryFlow2: document.getElementById('inquiryFlow2'),
  inquiryModeWork: document.getElementById('inquiryModeWork'),
  inquiryModeStyle: document.getElementById('inquiryModeStyle'),
  inquiryModeTest: document.getElementById('inquiryModeTest'),
  inquiryActiveStyleBanner: document.getElementById('inquiryActiveStyleBanner'),
  inquiryActiveStylePrompt: document.getElementById('inquiryActiveStylePrompt'),
  inquiryActiveStyleChangeBtn: document.getElementById('inquiryActiveStyleChangeBtn'),
  inquiryWorkPanel: document.getElementById('inquiryWorkPanel'),
  inquiryStylePanel: document.getElementById('inquiryStylePanel'),
  inquiryTestPanel: document.getElementById('inquiryTestPanel'),
  inquiryTestProduct: document.getElementById('inquiryTestProduct'),
  inquiryTestProductName: document.getElementById('inquiryTestProductName'),
  inquiryTestProductHint: document.getElementById('inquiryTestProductHint'),
  inquiryTestQuestion: document.getElementById('inquiryTestQuestion'),
  inquiryTestResult: document.getElementById('inquiryTestResult'),
  inquiryTestBtn: document.getElementById('inquiryTestBtn'),
  inquiryTestStatus: document.getElementById('inquiryTestStatus'),
  inquiryTestUsageHint: document.getElementById('inquiryTestUsageHint'),
  inquiryStyleModeList: document.getElementById('inquiryStyleModeList'),
  inquiryLearnedPromptEditor: document.getElementById('inquiryLearnedPromptEditor'),
  inquiryLearnedSystemPrompt: document.getElementById('inquiryLearnedSystemPrompt'),
  inquiryLearnedSystemPromptPaste: document.getElementById('inquiryLearnedSystemPromptPaste'),
  inquiryLearnedPromptEditorPaste: document.getElementById('inquiryLearnedPromptEditorPaste'),
  inquiryLearnedPromptHostPick: document.getElementById('inquiryLearnedPromptHostPick'),
  inquiryLearnedPromptHostPaste: document.getElementById('inquiryLearnedPromptHostPaste'),
  inquiryStepFetch: document.getElementById('inquiryStepFetch'),
  inquiryStepCompose: document.getElementById('inquiryStepCompose'),
  inquiryGoComposeBtn: document.getElementById('inquiryGoComposeBtn'),
  inquiryBackFetchBtn: document.getElementById('inquiryBackFetchBtn'),
  accountCard: document.getElementById('accountCard'),
  accountLoggedOut: document.getElementById('accountLoggedOut'),
  accountLoggedIn: document.getElementById('accountLoggedIn'),
  kakaoLoginBtn: document.getElementById('kakaoLoginBtn'),
  accountDivider: document.getElementById('accountDivider'),
  loginEmail: document.getElementById('loginEmail'),
  loginPassword: document.getElementById('loginPassword'),
  loginBtn: document.getElementById('loginBtn'),
  registerBtn: document.getElementById('registerBtn'),
  accountTabLogin: document.getElementById('accountTabLogin'),
  accountTabRegister: document.getElementById('accountTabRegister'),
  registerExtra: document.getElementById('registerExtra'),
  registerPasswordConfirm: document.getElementById('registerPasswordConfirm'),
  logoutBtn: document.getElementById('logoutBtn'),
  refreshUsageBtn: document.getElementById('refreshUsageBtn'),
  openBillingBtn: document.getElementById('openBillingBtn'),
  openBillingManageBtn: document.getElementById('openBillingManageBtn'),
  paymentHistorySection: document.getElementById('paymentHistorySection'),
  paymentHistoryList: document.getElementById('paymentHistoryList'),
  undoCancelBtn: document.getElementById('undoCancelBtn'),
  cancelSubscriptionBtn: document.getElementById('cancelSubscriptionBtn'),
  cancelConfirmBox: document.getElementById('cancelConfirmBox'),
  cancelConfirmOk: document.getElementById('cancelConfirmOk'),
  cancelConfirmBack: document.getElementById('cancelConfirmBack'),
  cancelConfirmStatus: document.getElementById('cancelConfirmStatus'),
  accountActionStatus: document.getElementById('accountActionStatus'),
  accountStatus: document.getElementById('accountStatus'),
  accountSummary: document.getElementById('accountSummary'),
  apiKeyCard: document.getElementById('apiKeyCard'),
  apiKeyHint: document.getElementById('apiKeyHint'),
  headerSub: document.getElementById('headerSub'),
  accountCardDesc: document.getElementById('accountCardDesc'),
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
let accountAuthMode = 'login';
let kakaoLoginEnabled = false;
let registrationOpen = true;
let authGateActive = false;
let reviewPanelStep = 'fetch';
let inquiryPanelStep = 'fetch';
let reviewPanelMode = 'work';
let inquiryPanelMode = 'work';
let inquiryTestProducts = [];
let inquiryTestSaveTimer = null;

init();

async function init() {
  initTabs();
  initWorkPanelSteps();

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
      activeStyleMode: 'styleActiveMode',
      savedCustomPrompt: 'savedCustomPrompt',
      savedPresetId: 'savedPresetId',
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
      activeStyleBanner: els.reviewActiveStyleBanner,
      activeStylePrompt: els.reviewActiveStylePrompt,
      learnedPromptEditor: els.reviewLearnedPromptEditor,
      learnedSystemPrompt: els.reviewLearnedSystemPrompt,
      learnedSystemPromptPaste: els.reviewLearnedSystemPromptPaste,
      learnedPromptEditorPaste: els.reviewLearnedPromptEditorPaste,
      styleModeList: els.reviewStyleModeList,
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
      activeStyleMode: 'inquiryStyleActiveMode',
      savedCustomPrompt: 'inquirySavedCustomPrompt',
      savedPresetId: 'inquirySavedPresetId',
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
      activeStyleBanner: els.inquiryActiveStyleBanner,
      activeStylePrompt: els.inquiryActiveStylePrompt,
      learnedPromptEditor: els.inquiryLearnedPromptEditor,
      learnedSystemPrompt: els.inquiryLearnedSystemPrompt,
      learnedSystemPromptPaste: els.inquiryLearnedSystemPromptPaste,
      learnedPromptEditorPaste: els.inquiryLearnedPromptEditorPaste,
      styleModeList: els.inquiryStyleModeList,
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
  els.loginBtn?.addEventListener('click', onLoginAccount);
  els.registerBtn?.addEventListener('click', onRegisterAccount);
  els.kakaoLoginBtn?.addEventListener('click', onKakaoLogin);
  els.accountTabLogin?.addEventListener('click', () => setAccountAuthMode('login'));
  els.accountTabRegister?.addEventListener('click', () => setAccountAuthMode('register'));
  els.logoutBtn?.addEventListener('click', onLogoutAccount);
  els.refreshUsageBtn?.addEventListener('click', onRefreshAccountUsage);
  els.openBillingBtn?.addEventListener('click', onOpenBillingPage);
  els.openBillingManageBtn?.addEventListener('click', onOpenBillingManagePage);
  els.undoCancelBtn?.addEventListener('click', onUndoCancelSubscription);
  els.cancelSubscriptionBtn?.addEventListener('click', onShowCancelSubscriptionConfirm);
  els.cancelConfirmOk?.addEventListener('click', onConfirmCancelSubscription);
  els.cancelConfirmBack?.addEventListener('click', onHideCancelSubscriptionConfirm);

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
  chrome.storage.local.get([CONFIG.DRAFT_KEY, INQUIRY_DRAFT_KEY], (data) => {
    if (parsedRows.length || (data[CONFIG.DRAFT_KEY]?.items?.length || 0) > 0) {
      setReviewPanelStep('compose');
    } else {
      setReviewPanelStep('fetch');
    }
    if (inquiryRows.length || (data[INQUIRY_DRAFT_KEY]?.items?.length || 0) > 0) {
      setInquiryPanelStep('compose');
    } else {
      setInquiryPanelStep('fetch');
    }
  });
  await initAccountUi();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushInquiryTestDraft();
  });
  window.addEventListener('pagehide', flushInquiryTestDraft);
  await restoreInquiryTestSession();
}

function initWorkPanelSteps() {
  els.reviewModeWork?.addEventListener('click', () => setReviewPanelMode('work'));
  els.reviewModeStyle?.addEventListener('click', () => setReviewPanelMode('style'));
  els.reviewActiveStyleChangeBtn?.addEventListener('click', () => setReviewPanelMode('style'));
  els.inquiryModeWork?.addEventListener('click', () => setInquiryPanelMode('work'));
  els.inquiryModeStyle?.addEventListener('click', () => setInquiryPanelMode('style'));
  els.inquiryModeTest?.addEventListener('click', () => setInquiryPanelMode('test'));
  els.inquiryTestBtn?.addEventListener('click', onInquiryTestGenerate);
  els.inquiryTestProduct?.addEventListener('change', onInquiryTestProductChange);
  els.inquiryTestProductName?.addEventListener('input', scheduleSaveInquiryTestDraft);
  els.inquiryTestQuestion?.addEventListener('input', scheduleSaveInquiryTestDraft);
  els.inquiryTestResult?.addEventListener('input', scheduleSaveInquiryTestDraft);
  els.inquiryActiveStyleChangeBtn?.addEventListener('click', () => setInquiryPanelMode('style'));

  els.reviewFlow1?.addEventListener('click', () => setReviewPanelStep('fetch'));
  els.reviewFlow2?.addEventListener('click', () => {
    if (!parsedRows.length) return;
    setReviewPanelStep('compose');
  });
  els.reviewGoComposeBtn?.addEventListener('click', () => setReviewPanelStep('compose'));
  els.reviewBackFetchBtn?.addEventListener('click', () => setReviewPanelStep('fetch'));

  els.inquiryFlow1?.addEventListener('click', () => setInquiryPanelStep('fetch'));
  els.inquiryFlow2?.addEventListener('click', () => {
    if (!canEnterInquiryCompose()) return;
    setInquiryPanelStep('compose');
  });
  els.inquiryGoComposeBtn?.addEventListener('click', () => setInquiryPanelStep('compose'));
  els.inquiryBackFetchBtn?.addEventListener('click', () => setInquiryPanelStep('fetch'));
}

function canEnterInquiryCompose() {
  return inquiryRows.length > 0 || !els.inquirySelectBtn?.disabled;
}

function setReviewPanelMode(mode) {
  reviewPanelMode = mode;
  els.reviewModeWork?.classList.toggle('active', mode === 'work');
  els.reviewModeStyle?.classList.toggle('active', mode === 'style');
  els.reviewWorkPanel?.classList.toggle('active', mode === 'work');
  els.reviewStylePanel?.classList.toggle('active', mode === 'style');
  if (mode === 'style') {
    reviewStyle?.updateSampleFlowUI();
    setStatus('판매자센터 답글을 분석해 내 말투로 설정합니다.');
  } else {
    refreshReviewWorkStatus();
  }
}

function setInquiryPanelMode(mode) {
  inquiryPanelMode = mode;
  els.inquiryModeWork?.classList.toggle('active', mode === 'work');
  els.inquiryModeStyle?.classList.toggle('active', mode === 'style');
  els.inquiryModeTest?.classList.toggle('active', mode === 'test');
  els.inquiryWorkPanel?.classList.toggle('active', mode === 'work');
  els.inquiryStylePanel?.classList.toggle('active', mode === 'style');
  els.inquiryTestPanel?.classList.toggle('active', mode === 'test');
  if (els.inquiryActiveStyleBanner) {
    els.inquiryActiveStyleBanner.hidden = mode === 'test';
  }
  if (mode === 'style') {
    inquiryStyle?.updateSampleFlowUI();
    setInquiryStatus('판매자센터 문의 답글을 분석해 내 말투로 설정합니다.');
  } else if (mode === 'test') {
    refreshInquiryTestProductOptions()
      .then(() => restoreInquiryTestDraft())
      .then(() => flushInquiryTestDraft())
      .catch(() => {});
    refreshInquiryTestUsageHint();
    setInquiryStatus('샘플 문의로 답글을 미리 확인합니다. 성공 시 1건 차감됩니다.');
  } else {
    flushInquiryTestDraft();
    refreshInquiryWorkStatus();
  }
}

function scheduleSaveInquiryTestDraft() {
  clearTimeout(inquiryTestSaveTimer);
  inquiryTestSaveTimer = setTimeout(() => {
    saveInquiryTestDraft().catch(() => {});
  }, 150);
}

function flushInquiryTestDraft() {
  clearTimeout(inquiryTestSaveTimer);
  inquiryTestSaveTimer = null;
  void saveInquiryTestDraft();
}

async function saveInquiryTestDraft(extra = {}) {
  if (!els.inquiryTestQuestion && !els.inquiryTestProduct && !els.inquiryTestProductName) return;
  const selected = getSelectedInquiryTestProduct();
  const existing = (await storageGet([INQUIRY_TEST_DRAFT_KEY]))[INQUIRY_TEST_DRAFT_KEY] || {};
  await storageSet({
    [INQUIRY_TEST_DRAFT_KEY]: {
      ...existing,
      productName: selected?.name || String(els.inquiryTestProductName?.value || '').trim() || existing.productName || '',
      productNo: selected?.productNo || existing.productNo || '',
      question: String(els.inquiryTestQuestion?.value || ''),
      result: String(els.inquiryTestResult?.value || ''),
      statusText: String(els.inquiryTestStatus?.textContent || ''),
      statusColor: els.inquiryTestStatus?.style?.color || '',
      panelMode: inquiryPanelMode,
      mainTab: 'inquiry',
      updatedAt: Date.now(),
      ...extra,
    },
  });
}

async function restoreInquiryTestSession() {
  if (authGateActive) return;
  const draft = (await storageGet([INQUIRY_TEST_DRAFT_KEY]))[INQUIRY_TEST_DRAFT_KEY];
  if (!draft) return;

  const hasContent =
    String(draft.question || '').trim() ||
    String(draft.result || '').trim() ||
    String(draft.productName || '').trim();
  if (draft.panelMode !== 'test' && !hasContent) return;

  switchTab('inquiry');
  setInquiryPanelMode('test');
}

async function restoreInquiryTestDraft() {
  const draft = (await storageGet([INQUIRY_TEST_DRAFT_KEY]))[INQUIRY_TEST_DRAFT_KEY];
  if (!draft) return;

  if (els.inquiryTestQuestion && draft.question != null) {
    els.inquiryTestQuestion.value = String(draft.question);
  }
  if (els.inquiryTestResult && draft.result != null) {
    els.inquiryTestResult.value = String(draft.result);
    els.inquiryTestResult.readOnly = !String(draft.result).trim();
  }
  if (els.inquiryTestStatus && draft.statusText) {
    els.inquiryTestStatus.textContent = String(draft.statusText);
    els.inquiryTestStatus.style.color = draft.statusColor || '#64748b';
  }

  applyInquiryTestProductSelection(draft.productName, draft.productNo);
  if (els.inquiryTestProductName && draft.productName) {
    els.inquiryTestProductName.value = String(draft.productName);
  }
}

function applyInquiryTestProductSelection(productName, productNo = '') {
  if (els.inquiryTestProductName && productName) {
    els.inquiryTestProductName.value = String(productName).trim();
  }
  if (!els.inquiryTestProduct || !inquiryTestProducts.length) return;
  const name = String(productName || '').trim().toLowerCase();
  const no = String(productNo || '').replace(/[^\d]/g, '');
  if (!name) return;

  let index = inquiryTestProducts.findIndex(
    (item) => item.name.toLowerCase() === name && (!no || item.productNo === no)
  );
  if (index < 0) {
    index = inquiryTestProducts.findIndex((item) => item.name.toLowerCase() === name);
  }
  if (index >= 0) els.inquiryTestProduct.value = String(index);
}

function onInquiryTestProductChange() {
  const selected = getSelectedInquiryTestProductFromSelect();
  if (selected?.name && els.inquiryTestProductName) {
    els.inquiryTestProductName.value = selected.name;
  }
  scheduleSaveInquiryTestDraft();
}

async function refreshInquiryTestProductOptions() {
  if (!els.inquiryTestProduct) return;

  const map = new Map();
  const addProduct = (name, productNo = '') => {
    const product = String(name || '').trim();
    if (!product) return;
    const key = product.toLowerCase();
    const no = String(productNo || '').replace(/[^\d]/g, '');
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { name: product, productNo: no });
      return;
    }
    if (no && !prev.productNo) prev.productNo = no;
  };

  for (const row of inquiryRows) addProduct(row.product, row.productNo);
  for (const row of parsedRows) addProduct(row.product, row.productNo);

  let savedDraft = null;
  try {
    const data = await storageGet([
      CONFIG.PARSE_CACHE_KEY,
      INQUIRY_PARSE_CACHE_KEY,
      INQUIRY_DRAFT_KEY,
      CONFIG.DRAFT_KEY,
      INQUIRY_REFERENCE_CACHE_KEY,
      INQUIRY_TEST_DRAFT_KEY,
    ]);
    savedDraft = data[INQUIRY_TEST_DRAFT_KEY] || null;
    const reviewCache = data[CONFIG.PARSE_CACHE_KEY];
    const inquiryCache = data[INQUIRY_PARSE_CACHE_KEY];
    const refCache = data[INQUIRY_REFERENCE_CACHE_KEY];

    for (const row of reviewCache?.parsedRows || []) addProduct(row.product || row.productName, row.productNo);
    for (const row of inquiryCache?.inquiryRows || []) addProduct(row.product || row.productName, row.productNo);
    for (const item of data[INQUIRY_DRAFT_KEY]?.items || []) addProduct(item.product || item.productName, item.productNo);
    for (const item of data[CONFIG.DRAFT_KEY]?.items || []) addProduct(item.product || item.productName, item.productNo);
    for (const item of refCache?.catalog || []) addProduct(item.product || item.productName, item.productNo);
  } catch (_) {}

  const typedName = String(els.inquiryTestProductName?.value || '').trim();
  if (typedName) addProduct(typedName, '');
  if (savedDraft?.productName) addProduct(savedDraft.productName, savedDraft.productNo);

  inquiryTestProducts = [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));

  if (!inquiryTestProducts.length) {
    els.inquiryTestProduct.innerHTML =
      '<option value="">직접 입력 또는 아래 목록에서 선택</option>';
    els.inquiryTestProduct.disabled = false;
    if (els.inquiryTestProductHint) {
      els.inquiryTestProductHint.textContent =
        '아직 목록이 비어 있습니다. 상품명을 직접 입력하거나, 문의/리뷰를 먼저 가져오세요.';
    }
    return;
  }

  els.inquiryTestProduct.disabled = false;
  els.inquiryTestProduct.innerHTML =
    '<option value="">직접 입력 또는 아래 목록에서 선택</option>' +
    inquiryTestProducts
      .map(
        (item, index) =>
          `<option value="${index}">${escapeHtml(item.name)}${
            item.productNo ? ` (#${escapeHtml(item.productNo)})` : ''
          }</option>`
      )
      .join('');

  applyInquiryTestProductSelection(
    typedName || savedDraft?.productName,
    savedDraft?.productNo
  );

  if (els.inquiryTestProductHint) {
    els.inquiryTestProductHint.textContent = `등록된 상품 ${inquiryTestProducts.length}개 · 문의/리뷰에서 모은 목록입니다. 직접 입력도 가능합니다.`;
  }
}

function getSelectedInquiryTestProductFromSelect() {
  const index = Number(els.inquiryTestProduct?.value);
  if (!Number.isInteger(index) || index < 0 || index >= inquiryTestProducts.length) {
    return null;
  }
  return inquiryTestProducts[index];
}

function getSelectedInquiryTestProduct() {
  const typed = String(els.inquiryTestProductName?.value || '').trim();
  if (typed) {
    const fromList = inquiryTestProducts.find((item) => item.name.toLowerCase() === typed.toLowerCase());
    return {
      name: typed,
      productNo: fromList?.productNo || '',
    };
  }
  return getSelectedInquiryTestProductFromSelect();
}

async function refreshInquiryTestUsageHint() {
  if (!els.inquiryTestUsageHint) return;
  if (!useAiProxy()) {
    els.inquiryTestUsageHint.textContent = '직접 API 키 모드 · 서버 사용량 차감 없음';
    return;
  }
  try {
    await refreshAccountUsage();
    const session = await loadAuthSession();
    const summary = formatUsageSummary(session?.usage);
    const remaining = getReplyRemaining(session?.usage);
    els.inquiryTestUsageHint.textContent = summary
      ? `${summary}${remaining != null ? ` · 테스트 시 1건 차감` : ''}`
      : '로그인 후 사용량을 확인할 수 있습니다.';
  } catch (_) {
    els.inquiryTestUsageHint.textContent = '사용량을 불러오지 못했습니다.';
  }
}

async function onInquiryTestGenerate() {
  const question = String(els.inquiryTestQuestion?.value || '').trim();
  const selected = getSelectedInquiryTestProduct();
  if (!selected?.name) {
    if (els.inquiryTestStatus) {
      els.inquiryTestStatus.textContent = '테스트할 상품을 선택해 주세요.';
      els.inquiryTestStatus.style.color = '#b91c1c';
    }
    return;
  }
  if (!question) {
    if (els.inquiryTestStatus) {
      els.inquiryTestStatus.textContent = '테스트 문의를 입력해 주세요.';
      els.inquiryTestStatus.style.color = '#b91c1c';
    }
    return;
  }

  const settingsData = await storageGet(CONFIG.SETTINGS_KEY);
  const settings = settingsData[CONFIG.SETTINGS_KEY] || {};
  const apiKey = settings.apiKey || CONFIG.GEMINI_API_KEY;
  if (!(await hasAiCredentialsAsync(apiKey))) {
    if (els.inquiryTestStatus) {
      els.inquiryTestStatus.textContent = 'AI 연결이 필요해요. [계정]에서 로그인하거나 API 키를 넣어 주세요.';
      els.inquiryTestStatus.style.color = '#b91c1c';
    }
    return;
  }

  const systemPrompt =
    String(settings.inquirySystemPrompt || '').trim() ||
    BUILTIN_INQUIRY_TONE_PRESETS?.[0]?.prompt ||
    '';

  if (els.inquiryTestBtn) els.inquiryTestBtn.disabled = true;
  if (els.inquiryTestResult) els.inquiryTestResult.value = '';
  if (els.inquiryTestStatus) {
    els.inquiryTestStatus.textContent = '답글 만드는 중… (성공 시 1건 차감)';
    els.inquiryTestStatus.style.color = '#64748b';
  }

  chrome.runtime.sendMessage(
    {
      type: 'TEST_GENERATE_INQUIRY',
      payload: {
        apiKey,
        systemPrompt,
        model: CONFIG.GEMINI_MODEL,
        product: selected.name,
        productNo: selected.productNo || '',
        content: question,
      },
    },
    async (response) => {
      if (els.inquiryTestBtn) els.inquiryTestBtn.disabled = false;
      if (chrome.runtime.lastError || !response?.ok) {
        if (els.inquiryTestStatus) {
          els.inquiryTestStatus.textContent =
            response?.error || chrome.runtime.lastError?.message || '테스트 실패';
          els.inquiryTestStatus.style.color = '#b91c1c';
        }
        await refreshInquiryTestUsageHint();
        await saveInquiryTestDraft();
        return;
      }

      if (response.deferred) {
        if (els.inquiryTestResult) {
          els.inquiryTestResult.value = '';
          els.inquiryTestResult.readOnly = true;
        }
        if (els.inquiryTestStatus) {
          els.inquiryTestStatus.textContent =
            `${response.reason || '직접 작성이 필요한 문의 유형입니다.'} (사용량 차감 없음)`;
          els.inquiryTestStatus.style.color = '#9a6700';
        }
        await refreshInquiryTestUsageHint();
        await saveInquiryTestDraft();
        return;
      }

      if (els.inquiryTestResult) {
        els.inquiryTestResult.value = response.text || '';
        els.inquiryTestResult.readOnly = false;
      }
      if (els.inquiryTestStatus) {
        const usageText = formatUsageSummary(response.usage);
        els.inquiryTestStatus.textContent = usageText
          ? `테스트 완료 · 1건 차감됨 · ${usageText}`
          : '테스트 완료 · 1건 차감됨';
        els.inquiryTestStatus.style.color = '#0a7a3f';
      }
      await refreshInquiryTestUsageHint();
      await saveInquiryTestDraft();
    }
  );
}

function refreshReviewWorkStatus() {
  if (reviewPanelStep === 'compose') {
    setStatus('답글 만들기를 시작하세요. 말투는 「답변 스타일 설정」에서 바꿀 수 있습니다.');
    return;
  }
  if (parsedRows.length > 0) {
    setStatus('가져오기 완료. 「다음」으로 답글 만들기로 이동하세요.');
    return;
  }
  setStatus('리뷰를 가져온 다음 「다음」으로 이동하세요.');
}

function refreshInquiryWorkStatus() {
  if (inquiryPanelStep === 'compose') {
    setInquiryStatus('답글 만들기를 시작하세요. 말투는 「답변 스타일 설정」에서 바꿀 수 있습니다.');
    return;
  }
  if (inquiryRows.length > 0) {
    setInquiryStatus('가져오기 완료. 「다음」으로 답글 만들기로 이동하세요.');
    return;
  }
  setInquiryStatus('문의를 가져온 다음 「다음」으로 이동하세요.');
}

function setReviewPanelStep(step) {
  if (step === 'compose' && !parsedRows.length) return;
  reviewPanelStep = step;
  els.reviewStepFetch?.classList.toggle('active', step === 'fetch');
  els.reviewStepCompose?.classList.toggle('active', step === 'compose');
  updateReviewFlowBar();
  if (reviewPanelMode === 'work') refreshReviewWorkStatus();
}

function setInquiryPanelStep(step) {
  if (step === 'compose' && !canEnterInquiryCompose()) return;
  inquiryPanelStep = step;
  els.inquiryStepFetch?.classList.toggle('active', step === 'fetch');
  els.inquiryStepCompose?.classList.toggle('active', step === 'compose');
  updateInquiryFlowBar();
  if (inquiryPanelMode === 'work') refreshInquiryWorkStatus();
}

function updateReviewFlowBar() {
  const hasData = parsedRows.length > 0;
  els.reviewFlow1?.classList.toggle('active', reviewPanelStep === 'fetch');
  els.reviewFlow1?.classList.toggle('done', hasData && reviewPanelStep === 'compose');
  els.reviewFlow2?.classList.toggle('active', reviewPanelStep === 'compose');
  if (els.reviewFlow2) els.reviewFlow2.disabled = !hasData;
  if (els.reviewGoComposeBtn) els.reviewGoComposeBtn.hidden = !(hasData && reviewPanelStep === 'fetch');
}

function updateInquiryFlowBar() {
  const hasData = canEnterInquiryCompose();
  els.inquiryFlow1?.classList.toggle('active', inquiryPanelStep === 'fetch');
  els.inquiryFlow1?.classList.toggle('done', hasData && inquiryPanelStep === 'compose');
  els.inquiryFlow2?.classList.toggle('active', inquiryPanelStep === 'compose');
  if (els.inquiryFlow2) els.inquiryFlow2.disabled = !canEnterInquiryCompose();
  if (els.inquiryGoComposeBtn) {
    els.inquiryGoComposeBtn.hidden = !(inquiryRows.length > 0 && inquiryPanelStep === 'fetch');
  }
}

function initTabs() {
  els.tabs.forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });
}

function switchTab(name) {
  if (authGateActive && name !== 'settings') return;

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

  if (name === 'settings') {
    void syncAccountUi();
  }
  if (inquiryPanelMode === 'test') flushInquiryTestDraft();
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
    openOrFocusExtensionTab('inquiry-select.html', hash);
  });
}

function openWorkPage() {
  chrome.storage.local.get([CONFIG.DRAFT_KEY], (result) => {
    const hasDraft = (result[CONFIG.DRAFT_KEY]?.items?.length || 0) > 0;
    const hash = hasDraft ? '#review' : '';
    openOrFocusExtensionTab('select.html', hash);
  });
}

function updateWorkButton(draft) {
  const count = draft?.items?.length || 0;
  if (parsedRows.length) {
    els.selectBtn.textContent = count
      ? `이어서 답글 만들기 (확인 ${count}건) →`
      : `답글 만들기 시작 (${parsedRows.length}건) →`;
  } else {
    els.selectBtn.textContent = count
      ? `이어서 답글 만들기 (확인 ${count}건) →`
      : '답글 만들기 시작 →';
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
  setReviewPanelStep('compose');
  if (inquiryPanelMode === 'test') refreshInquiryTestProductOptions();
}

function updateFileSummary() {
  if (!parsedRows.length) {
    els.fileSummary.classList.remove('visible');
    els.selectBtn.disabled = true;
    els.selectBtn.textContent = '답글 만들기 시작 →';
    setReviewPanelStep('fetch');
    updateReviewFlowBar();
    return;
  }

  els.fileSummary.classList.add('visible');
  els.fileSummary.innerHTML = `
    <div><strong>${parsedRows.length}</strong>건 준비됨</div>
    <div>${parseMeta?.fileName || '판매자센터'}</div>
    <div class="next-step">「다음」으로 답글 만들기 단계로 이동하세요</div>
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
  const statusMessage = `${parsedRows.length}건 가져왔어요.\n「다음」으로 이동해 답글을 만들어 보세요.`;
  setStatus(statusMessage);
  updateFileSummary();
  setReviewPanelStep('compose');
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
  if (inquiryRows.length) setInquiryPanelStep('compose');
  if (inquiryPanelMode === 'test') refreshInquiryTestProductOptions();
}

function updateInquirySummary(replyCount = 0) {
  if (!inquiryRows.length) {
    els.inquirySummary.classList.remove('visible');
    els.inquirySelectBtn.disabled = true;
    els.inquirySelectBtn.textContent = '답글 만들기 시작 →';
    setInquiryPanelStep('fetch');
    updateInquiryFlowBar();
    return;
  }

  els.inquirySummary.classList.add('visible');
  const replyHint = replyCount > 0 ? `<div>만든 답글 ${replyCount}건</div>` : '';
  els.inquirySummary.innerHTML = `
    <div><strong>${inquiryRows.length}</strong>건 준비됨</div>
    ${replyHint}
    <div class="next-step">「다음」으로 답글 만들기 단계로 이동하세요</div>
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
      ? `이어서 답글 만들기 (확인 ${draftCount}건) →`
      : `답글 만들기 시작 (${inquiryRows.length}건) →`;
  } else {
    els.inquirySelectBtn.textContent = draftCount
      ? `이어서 답글 만들기 (확인 ${draftCount}건) →`
      : '답글 만들기 시작 →';
  }
  els.inquirySelectBtn.disabled = !inquiryRows.length && !draftCount;
  updateInquiryFlowBar();
  if (draftCount && !inquiryRows.length) setInquiryPanelStep('compose');
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
    const statusMessage = `${inquiryRows.length}건 미답변 문의를 가져왔습니다.\n「다음」으로 이동해 답글을 만들어 보세요.`;
    setInquiryStatus(statusMessage);
    updateInquirySummary();
    setInquiryPanelStep('compose');
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
    const statusMessage = `${parsedRows.length}건 파싱 완료${skipMsg}.\n「다음」으로 이동해 답글을 만들어 보세요.`;
    setStatus(statusMessage);
    updateFileSummary();
    setReviewPanelStep('compose');
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
  const authKey = CONFIG.AUTH_STORAGE_KEY || 'smartstoreAuthSession';
  if (changes[authKey]) {
    renderAccountUi();
  }
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
    INQUIRY_TEST_DRAFT_KEY,
  ]);
  if (els.inquiryTestQuestion) els.inquiryTestQuestion.value = '';
  if (els.inquiryTestProductName) els.inquiryTestProductName.value = '';
  if (els.inquiryTestResult) els.inquiryTestResult.value = '';
  if (els.inquiryTestStatus) {
    els.inquiryTestStatus.textContent = '';
    els.inquiryTestStatus.style.color = '';
  }

  parsedRows = [];
  columnMap = {};
  parseMeta = null;
  selectedIds.clear();
  inquiryRows = [];
  els.xlsxFile.value = '';
  refreshInquiryApplyHint();
  updateFileSummary();
  updateInquirySummary();
  setReviewPanelStep('fetch');
  setInquiryPanelStep('fetch');
  setReviewPanelMode('work');
  setInquiryPanelMode('work');
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

function requiresAuthGate() {
  const devBypass = !!String(CONFIG.API_DEV_SECRET || '').trim();
  return useAiProxy() && !devBypass;
}

function applyAuthGate(loggedIn) {
  authGateActive = requiresAuthGate() && !loggedIn;
  document.body.classList.toggle('auth-gate', authGateActive);

  if (els.headerSub) {
    els.headerSub.textContent = authGateActive
      ? '로그인 후 답글·말투 분석을 이용할 수 있습니다.'
      : '리뷰·상품문의 답글을 쉽게 만들고 올립니다';
  }

  if (els.accountCardDesc) {
    els.accountCardDesc.textContent = authGateActive
      ? '카카오 로그인으로 시작하세요. 처음이면 자동 가입됩니다.'
      : '카카오로 간편 로그인하거나 이메일로 가입·로그인하세요.';
  }

  if (authGateActive) {
    switchTab('settings');
    if (els.accountCard) els.accountCard.hidden = false;
  }
}

async function syncAccountUi(options = {}) {
  if (!useAiProxy()) {
    await renderAccountUi();
    return;
  }
  const session = await loadAuthSession();
  if (!session?.token) {
    await renderAccountUi();
    return;
  }
  try {
    await refreshAccountUsage(options);
  } catch (err) {
    if (err?.code === 'AUTH_EXPIRED' || !(await loadAuthSession())?.token) {
      await renderAccountUi();
      if (els.accountStatus) {
        els.accountStatus.textContent =
          '서버 세션이 만료되었습니다. 다시 로그인해 주세요. (재배포 후 흔히 발생합니다)';
      }
      return;
    }
    // 네트워크 오류 시 캐시된 세션으로 표시
  }
  await renderAccountUi();
}

async function initAccountUi() {
  const proxyMode = useAiProxy();
  const devBypass = !!String(CONFIG.API_DEV_SECRET || '').trim();

  if (els.accountCard) {
    els.accountCard.hidden = !proxyMode || devBypass;
  }
  if (els.apiKeyCard) {
    els.apiKeyCard.hidden = proxyMode && !devBypass;
  }
  if (els.apiKeyHint && proxyMode && devBypass) {
    els.apiKeyHint.textContent = '개발 모드: 서버 DEV_API_SECRET 으로 연결 중입니다.';
  }

  if (!proxyMode || devBypass) return;

  try {
    const health = await fetchServerHealth();
    registrationOpen = health?.registrationOpen !== false;
    kakaoLoginEnabled = health?.kakaoLoginEnabled === true;
  } catch (_) {
    registrationOpen = true;
    kakaoLoginEnabled = false;
  }

  if (els.kakaoLoginBtn) {
    els.kakaoLoginBtn.hidden = !kakaoLoginEnabled;
  }
  if (els.accountDivider) {
    els.accountDivider.hidden = !kakaoLoginEnabled;
  }

  if (els.accountTabRegister) {
    els.accountTabRegister.hidden = !registrationOpen;
  }
  setAccountAuthMode('login');
  await syncAccountUi({ force: true });
}

function setAccountAuthMode(mode) {
  if (mode === 'register' && !registrationOpen) {
    mode = 'login';
  }
  accountAuthMode = mode;

  els.accountTabLogin?.classList.toggle('active', mode === 'login');
  els.accountTabRegister?.classList.toggle('active', mode === 'register');
  if (els.registerExtra) els.registerExtra.hidden = mode !== 'register';
  if (els.loginBtn) els.loginBtn.hidden = mode !== 'login';
  if (els.registerBtn) els.registerBtn.hidden = mode !== 'register';

  if (els.accountStatus) {
    els.accountStatus.textContent =
      mode === 'register'
        ? '이메일과 비밀번호(8자 이상)로 가입할 수 있습니다.'
        : kakaoLoginEnabled
          ? '카카오 로그인을 권장합니다. 이메일 로그인도 이용할 수 있습니다.'
          : registrationOpen
            ? '로그인하거나 [가입하기] 탭에서 새 계정을 만드세요.'
            : '이메일과 비밀번호로 로그인해 주세요.';
  }
}

async function renderAccountUi() {
  const session = await loadAuthSession();
  const loggedIn = !!session?.token;

  applyAuthGate(loggedIn);

  if (els.accountLoggedOut) els.accountLoggedOut.hidden = loggedIn;
  if (els.accountLoggedIn) els.accountLoggedIn.hidden = !loggedIn;

  if (!loggedIn) {
    setAccountAuthMode(accountAuthMode);
    return;
  }

  if (els.accountSummary) {
    const usageText = formatUsageSummary(session.usage);
    const subText = formatSubscriptionSummary(session.subscription);
    const planLabel = session.subscription?.active
      ? session.planName || session.planId || '플랜'
      : '구독 전';
    const accountLabel = session.displayName || session.email || '계정';
    const providerLabel = session.authProvider === 'kakao' ? '카카오' : '이메일';
    els.accountSummary.innerHTML = `
      <div><strong>${accountLabel}</strong> <span style="color:#6b7280;font-size:12px;">(${providerLabel})</span></div>
      <div>${planLabel}</div>
      <div>${subText || '구독 정보 없음'}</div>
      <div>${usageText || '사용량 정보 없음'}</div>
    `;
  }

  const sub = session.subscription;
  const isCancelled = !!(sub?.cancelled || sub?.status === 'cancelled');
  const planRank = { basic: 1, standard: 2, pro: 3 };
  const currentRank = planRank[sub?.planId] || 0;
  const canSubscribe = !sub?.active;
  const canUpgrade = sub?.active && sub?.status === 'active' && !isCancelled && currentRank < 3;
  const canUndoCancel = isCancelled && sub?.active;
  const canCancel = sub?.active && sub?.status === 'active' && !sub?.cancelled;
  if (els.openBillingBtn) {
    els.openBillingBtn.hidden = !canSubscribe && !canUpgrade;
    if (canUpgrade) {
      els.openBillingBtn.textContent = '플랜 업그레이드';
    } else {
      els.openBillingBtn.textContent = '구독하기';
    }
  }
  if (els.undoCancelBtn) els.undoCancelBtn.hidden = !canUndoCancel;
  if (els.cancelSubscriptionBtn) els.cancelSubscriptionBtn.hidden = !canCancel;
  if (els.openBillingManageBtn) els.openBillingManageBtn.hidden = false;
  if (!canCancel && els.cancelConfirmBox) els.cancelConfirmBox.hidden = true;
  await renderPaymentHistory();
}

async function renderPaymentHistory() {
  if (!els.paymentHistorySection || !els.paymentHistoryList) return;
  if (!useAiProxy()) {
    els.paymentHistorySection.hidden = true;
    return;
  }
  try {
    const rows = await fetchPaymentHistory();
    els.paymentHistorySection.hidden = false;
    if (!rows.length) {
      els.paymentHistoryList.innerHTML =
        '<div class="hint">결제 내역이 없습니다. [구독하기]에서 시작하세요.</div>';
      return;
    }
    els.paymentHistoryList.innerHTML = rows
      .slice(0, 8)
      .map((row) => {
        const refunded = row.status === 'refunded';
        return `<div style="padding:6px 0;border-bottom:1px solid #eef1f6;font-size:12px;">
          <div><strong>${row.kindLabel || row.kind}</strong> · ${row.planName || row.planId}${refunded ? ' · <span style="color:#b45309;">환불</span>' : ''}</div>
          <div style="color:#6b7280;">${row.paidAt || '-'} · ${Number(row.amount || 0).toLocaleString()}원</div>
        </div>`;
      })
      .join('');
  } catch (_) {
    els.paymentHistorySection.hidden = true;
  }
}

function setCancelConfirmMessage(text) {
  if (els.cancelConfirmStatus) {
    els.cancelConfirmStatus.textContent = text || '';
    els.cancelConfirmStatus.style.color = text && /실패|오류|없습니다|필요/.test(text) ? '#b91c1c' : '#92400e';
  }
}

async function setAccountMessage(text) {
  const session = await loadAuthSession();
  const loggedIn = !!session?.token;
  if (loggedIn && els.accountActionStatus) {
    els.accountActionStatus.textContent = text || '';
    return;
  }
  if (els.accountStatus) els.accountStatus.textContent = text || '';
}

function onShowCancelSubscriptionConfirm() {
  if (els.cancelConfirmBox) els.cancelConfirmBox.hidden = false;
  if (els.cancelSubscriptionBtn) els.cancelSubscriptionBtn.hidden = true;
  setCancelConfirmMessage('');
  void setAccountMessage('');
}

function onHideCancelSubscriptionConfirm() {
  if (els.cancelConfirmBox) els.cancelConfirmBox.hidden = true;
  setCancelConfirmMessage('');
  renderAccountUi();
}

async function onConfirmCancelSubscription() {
  if (els.cancelConfirmOk) els.cancelConfirmOk.disabled = true;
  if (els.cancelConfirmBack) els.cancelConfirmBack.disabled = true;
  setCancelConfirmMessage('구독 취소 처리 중…');
  await setAccountMessage('구독 취소 처리 중…');

  try {
    await cancelSubscription();
    onHideCancelSubscriptionConfirm();
    await renderAccountUi();
    await setAccountMessage('구독 취소가 예약되었습니다. 만료일까지 현재 플랜을 이용할 수 있으며, 자동 결제는 중단됩니다.');
  } catch (err) {
    const message = err.message || '구독 취소에 실패했습니다.';
    setCancelConfirmMessage(message);
    await setAccountMessage(message);
  } finally {
    if (els.cancelConfirmOk) els.cancelConfirmOk.disabled = false;
    if (els.cancelConfirmBack) els.cancelConfirmBack.disabled = false;
  }
}

async function onRegisterAccount() {
  const email = els.loginEmail?.value.trim() || '';
  const password = els.loginPassword?.value || '';
  const confirm = els.registerPasswordConfirm?.value || '';

  if (!email || !password) {
    if (els.accountStatus) els.accountStatus.textContent = '이메일과 비밀번호를 입력해 주세요.';
    return;
  }
  if (password.length < 8) {
    if (els.accountStatus) els.accountStatus.textContent = '비밀번호는 8자 이상이어야 합니다.';
    return;
  }
  if (password !== confirm) {
    if (els.accountStatus) els.accountStatus.textContent = '비밀번호 확인이 일치하지 않습니다.';
    return;
  }

  if (els.registerBtn) els.registerBtn.disabled = true;
  if (els.accountStatus) els.accountStatus.textContent = '가입 중…';

  try {
    await registerWithPassword(email, password);
    if (els.loginPassword) els.loginPassword.value = '';
    if (els.registerPasswordConfirm) els.registerPasswordConfirm.value = '';
    if (els.accountStatus) els.accountStatus.textContent = '가입 완료! [구독하기]에서 플랜을 선택해 주세요.';
    await renderAccountUi();
  } catch (err) {
    if (els.accountStatus) els.accountStatus.textContent = err.message || '가입에 실패했습니다.';
  } finally {
    if (els.registerBtn) els.registerBtn.disabled = false;
  }
}

async function onKakaoLogin() {
  if (els.kakaoLoginBtn) els.kakaoLoginBtn.disabled = true;
  if (els.accountStatus) els.accountStatus.textContent = '카카오 로그인 창을 여는 중… (창이 닫히면 [계정]을 다시 확인하세요)';

  try {
    await loginWithKakao();
    if (els.accountStatus) els.accountStatus.textContent = '카카오 로그인되었습니다.';
    await renderAccountUi();
    switchTab('work');
  } catch (err) {
    if (els.accountStatus) els.accountStatus.textContent = err.message || '카카오 로그인에 실패했습니다.';
  } finally {
    if (els.kakaoLoginBtn) els.kakaoLoginBtn.disabled = false;
  }
}

async function onLoginAccount() {
  const email = els.loginEmail?.value.trim() || '';
  const password = els.loginPassword?.value || '';
  if (!email || !password) {
    if (els.accountStatus) els.accountStatus.textContent = '이메일과 비밀번호를 입력해 주세요.';
    return;
  }

  if (els.loginBtn) els.loginBtn.disabled = true;
  if (els.accountStatus) els.accountStatus.textContent = '로그인 중…';

  try {
    await loginWithPassword(email, password);
    if (els.loginPassword) els.loginPassword.value = '';
    if (els.accountStatus) els.accountStatus.textContent = '로그인되었습니다.';
    await renderAccountUi();
    switchTab('work');
  } catch (err) {
    if (els.accountStatus) {
      const msg = err.message || '로그인에 실패했습니다.';
      els.accountStatus.textContent = /비밀번호|찾을 수 없|올바르지|존재하지/.test(msg)
        ? `${msg} (서버 재배포 후에는 [가입하기]로 새 계정을 만들거나 카카오로 다시 로그인해 주세요.)`
        : msg;
    }
  } finally {
    if (els.loginBtn) els.loginBtn.disabled = false;
  }
}

async function onLogoutAccount() {
  await logoutAccount();
  await renderAccountUi();
  await setAccountMessage('로그아웃되었습니다.');
  switchTab('settings');
}

async function onRefreshAccountUsage() {
  if (els.refreshUsageBtn) els.refreshUsageBtn.disabled = true;
  try {
    await refreshAccountUsage({ force: true });
    await renderAccountUi();
  } catch (err) {
    await setAccountMessage(err.message || '새로고침에 실패했습니다.');
  } finally {
    if (els.refreshUsageBtn) els.refreshUsageBtn.disabled = false;
  }
}

function onOpenBillingManagePage() {
  openBillingManagePage().catch(async (err) => {
    await setAccountMessage(err.message || '결제 관리 페이지를 열 수 없습니다.');
  });
}

function onOpenBillingPage() {
  loadAuthSession()
    .then((session) => {
      const planId =
        session?.planId && session.planId !== 'none' ? session.planId : 'standard';
      return openBillingPage(planId);
    })
    .catch(async (err) => {
      await setAccountMessage(err.message || '결제 페이지를 열 수 없습니다.');
    });
}

async function onUndoCancelSubscription() {
  if (els.undoCancelBtn) els.undoCancelBtn.disabled = true;
  await setAccountMessage('취소 철회 처리 중…');
  try {
    await undoCancelSubscription();
    await renderAccountUi();
    await setAccountMessage('구독 취소를 철회했습니다. 만료일에 같은 플랜으로 자동 갱신됩니다.');
  } catch (err) {
    await setAccountMessage(err.message || '취소 철회에 실패했습니다.');
  } finally {
    if (els.undoCancelBtn) els.undoCancelBtn.disabled = false;
  }
}

function storageGet(keys) {
  const keyList = Array.isArray(keys) ? keys : [keys];
  return new Promise((resolve) => chrome.storage.local.get(keyList, resolve));
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function storageSet(data) {
  return new Promise((resolve) => chrome.storage.local.set(data, resolve));
}

function storageRemove(keys) {
  const keyList = Array.isArray(keys) ? keys : [keys];
  return new Promise((resolve) => chrome.storage.local.remove(keyList, resolve));
}
