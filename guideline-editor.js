const params = new URLSearchParams(location.search);
const context = params.get('context') === 'inquiry' ? 'inquiry' : 'review';
const isInquiry = context === 'inquiry';

const storageKeys = isInquiry
  ? {
      systemPrompt: 'inquirySystemPrompt',
      tonePresetId: 'inquiryTonePresetId',
      customPresets: 'inquiryCustomPresets',
    }
  : {
      systemPrompt: 'systemPrompt',
      tonePresetId: 'tonePresetId',
      customPresets: 'customPresets',
    };

const learnedPresetId = isInquiry ? INQUIRY_LEARNED_PRESET_ID : REVIEW_LEARNED_PRESET_ID;

const els = {
  pageTitle: document.getElementById('pageTitle'),
  pageSub: document.getElementById('pageSub'),
  banner: document.getElementById('banner'),
  editorHost: document.getElementById('editorHost'),
  cancelBtn: document.getElementById('cancelBtn'),
  saveBtn: document.getElementById('saveBtn'),
};

els.pageTitle.textContent = isInquiry ? '응대 지침서 관리' : '리뷰 말투 지침 관리';
els.pageSub.textContent = isInquiry
  ? '문의 답글에 쓰는 지침입니다. 비슷한 의미끼리 모아 두고 필요할 때만 고치면 됩니다.'
  : '리뷰 답글에 쓰는 지침입니다. 비슷한 의미끼리 모아 두고 필요할 때만 고치면 됩니다.';

let editor = null;
let initialPrompt = '';
let settingsSnapshot = {};

init();

async function init() {
  const data = await storageGet([CONFIG.SETTINGS_KEY]);
  settingsSnapshot = data[CONFIG.SETTINGS_KEY] || {};
  const presets = settingsSnapshot[storageKeys.customPresets] || [];
  const learned = presets.find((p) => p.id === learnedPresetId);
  initialPrompt = String(
    learned?.prompt || settingsSnapshot[storageKeys.systemPrompt] || ''
  ).trim();

  editor = mountGuidelineItemsEditor(els.editorHost, {
    text: initialPrompt,
    emptyText: '지침이 없습니다. + 지침 추가로 넣어 주세요.',
  });

  els.cancelBtn.addEventListener('click', () => window.close());
  els.saveBtn.addEventListener('click', onSave);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[CONFIG.SETTINGS_KEY]) return;
    // Keep local edits; only refresh if another tab saved and we have no dirty changes.
    if (getCurrentPrompt() !== initialPrompt) return;
    settingsSnapshot = changes[CONFIG.SETTINGS_KEY].newValue || {};
    const presetsNext = settingsSnapshot[storageKeys.customPresets] || [];
    const learnedNext = presetsNext.find((p) => p.id === learnedPresetId);
    const nextPrompt = String(
      learnedNext?.prompt || settingsSnapshot[storageKeys.systemPrompt] || ''
    ).trim();
    if (nextPrompt === initialPrompt) return;
    initialPrompt = nextPrompt;
    editor?.setFromText(nextPrompt);
  });
}

function getCurrentPrompt() {
  return String(editor?.getSerialized() || '').trim();
}

async function onSave() {
  const prompt = getCurrentPrompt();
  if (!prompt) {
    setBanner('지침을 1개 이상 남겨 주세요.', 'warn');
    return;
  }

  els.saveBtn.disabled = true;
  els.saveBtn.textContent = '저장 중...';

  try {
    const data = await storageGet([CONFIG.SETTINGS_KEY]);
    const settings = data[CONFIG.SETTINGS_KEY] || {};
    const presets = settings[storageKeys.customPresets] || [];
    const learned = presets.find((p) => p.id === learnedPresetId);
    const nextLearned = {
      id: learnedPresetId,
      name:
        learned?.name ||
        (isInquiry ? '응대 지침서' : '내 스타일 (학습)'),
      prompt,
      updatedAt: Date.now(),
    };
    const nextSettings = {
      ...settings,
      [storageKeys.customPresets]: [
        nextLearned,
        ...presets.filter((p) => p.id !== learnedPresetId),
      ],
      [storageKeys.systemPrompt]: prompt,
      [storageKeys.tonePresetId]:
        settings[storageKeys.tonePresetId] || learnedPresetId,
    };

    await storageSet({ [CONFIG.SETTINGS_KEY]: nextSettings });
    initialPrompt = prompt;
    settingsSnapshot = nextSettings;
    setBanner('저장했습니다. 사이드패널에도 바로 반영됩니다.', 'success');
  } catch (err) {
    setBanner(`저장 실패: ${err.message || err}`, 'error');
  } finally {
    els.saveBtn.disabled = false;
    els.saveBtn.textContent = '저장';
  }
}

function setBanner(message, variant) {
  els.banner.textContent = message;
  els.banner.className = `banner visible ${variant || ''}`.trim();
}

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(data) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(data, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}
