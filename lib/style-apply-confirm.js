/**
 * 스타일 분석 결과 적용 전 — 기존 스타일 덮어쓰기 확인
 */
function truncateStylePreview(text, max = 420) {
  const s = String(text || '').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

function getConfiguredStyleSnapshot(settings = {}, context = 'review') {
  const isInquiry = context === 'inquiry';
  const presetIdKey = isInquiry ? 'inquiryTonePresetId' : 'tonePresetId';
  const promptKey = isInquiry ? 'inquirySystemPrompt' : 'systemPrompt';
  const customPresetsKey = isInquiry ? 'inquiryCustomPresets' : 'customPresets';
  const learnedId = isInquiry ? INQUIRY_LEARNED_PRESET_ID : REVIEW_LEARNED_PRESET_ID;
  const builtins = isInquiry ? BUILTIN_INQUIRY_TONE_PRESETS : BUILTIN_TONE_PRESETS;
  const findFn = isInquiry ? findInquiryPreset : findPreset;

  const presetId = settings[presetIdKey] || 'default';
  const savedPrompt = String(settings[promptKey] || '').trim();
  const defaultPrompt = String(builtins[0]?.prompt || '').trim();

  let label = builtins[0]?.name || '기본';
  if (presetId === CUSTOM_PRESET_ID) label = '직접 입력';
  else if (presetId === learnedId) label = '내 스타일 (학습)';
  else {
    const preset = findFn(presetId, settings[customPresetsKey] || []);
    if (preset?.name) label = preset.name;
  }

  let prompt = savedPrompt;
  if (!prompt) {
    const preset = findFn(presetId, settings[customPresetsKey] || []);
    prompt = String(preset?.prompt || defaultPrompt).trim();
  }

  const configured =
    presetId === learnedId ||
    presetId === CUSTOM_PRESET_ID ||
    presetId !== 'default' ||
    (!!savedPrompt && savedPrompt !== defaultPrompt);

  return { configured, label, prompt, presetId };
}

function buildLearnedStyleSettingsPatch(settings = {}, context = 'review', response = {}, extra = {}) {
  const isInquiry = context === 'inquiry';
  const learnedId = isInquiry ? INQUIRY_LEARNED_PRESET_ID : REVIEW_LEARNED_PRESET_ID;
  const presetsKey = isInquiry ? 'inquiryCustomPresets' : 'customPresets';
  const presetIdKey = isInquiry ? 'inquiryTonePresetId' : 'tonePresetId';
  const promptKey = isInquiry ? 'inquirySystemPrompt' : 'systemPrompt';
  const flowKey = isInquiry ? 'inquirySampleFlow' : 'sampleFlow';

  const learned = {
    id: learnedId,
    name: `내 스타일 (샘플 ${response.sampleCount || 0}개)`,
    prompt: response.prompt,
    updatedAt: Date.now(),
  };
  const customPresets = [
    learned,
    ...(settings[presetsKey] || []).filter((p) => p.id !== learnedId),
  ];

  return {
    ...settings,
    ...extra,
    [presetsKey]: response.customPresets || customPresets,
    [presetIdKey]: response.tonePresetId || learnedId,
    [promptKey]: response.prompt,
    [flowKey]: response.sampleFlow || settings[flowKey],
  };
}

function showStyleApplyConfirm(options = {}) {
  const {
    title = '새 스타일을 적용할까요?',
    subtitle = '기존에 설정된 스타일이 있습니다. 새로 분석한 스타일로 바꿀지 선택하세요.',
    currentLabel = '현재 스타일',
    currentPrompt = '',
    newPrompt = '',
    sampleCount = 0,
    showCurrent = true,
  } = options;

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'ss-style-confirm-overlay';
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483646',
      background: 'rgba(15, 23, 42, 0.45)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
    });

    const card = document.createElement('div');
    Object.assign(card.style, {
      width: '100%',
      maxWidth: '720px',
      maxHeight: '90vh',
      overflow: 'auto',
      background: '#fff',
      borderRadius: '16px',
      boxShadow: '0 24px 48px rgba(0,0,0,.18)',
      padding: '24px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      color: '#1a1a1a',
    });

    const meta =
      sampleCount > 0
        ? `<div style="font-size:13px;color:#666;margin-bottom:16px;">샘플 ${sampleCount}개로 분석한 새 「내 스타일」입니다.</div>`
        : '';

    const currentBlock = showCurrent
      ? `<div style="margin-bottom:14px;">
        <div style="font-size:13px;font-weight:700;color:#475569;margin-bottom:6px;">현재 · ${escapeStyleConfirmHtml(currentLabel)}</div>
        <pre class="ss-style-preview ss-style-preview-current" style="margin:0;padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;font-size:12px;line-height:1.55;white-space:pre-wrap;word-break:break-word;max-height:160px;overflow:auto;"></pre>
      </div>`
      : '';

    const keepLabel = showCurrent ? '기존 스타일 유지' : '취소';

    card.innerHTML = `
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:800;">${escapeStyleConfirmHtml(title)}</h2>
      <p style="margin:0 0 12px;font-size:14px;line-height:1.5;color:#555;">${escapeStyleConfirmHtml(subtitle)}</p>
      ${meta}
      ${currentBlock}
      <div style="margin-bottom:20px;">
        <div style="font-size:13px;font-weight:700;color:#1d4ed8;margin-bottom:6px;">새로 분석된 스타일</div>
        <div style="font-size:12px;color:#64748b;margin-bottom:8px;">적용 전에 내용을 자유롭게 수정할 수 있습니다.</div>
        <textarea class="ss-style-preview-new" rows="12" style="display:block;width:100%;box-sizing:border-box;margin:0;padding:12px 14px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;font-size:12px;line-height:1.55;font-family:inherit;resize:vertical;min-height:180px;max-height:320px;"></textarea>
        <div class="ss-style-confirm-error" hidden style="margin-top:8px;font-size:12px;color:#b91c1c;">답글 지침을 입력해 주세요.</div>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
        <button type="button" data-action="keep" style="padding:12px 18px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;font-weight:700;cursor:pointer;">${escapeStyleConfirmHtml(keepLabel)}</button>
        <button type="button" data-action="apply" style="padding:12px 18px;border:none;border-radius:10px;background:#2563eb;color:#fff;font-weight:700;cursor:pointer;">새 스타일 적용</button>
      </div>
    `;

    if (showCurrent) {
      card.querySelector('.ss-style-preview-current').textContent = truncateStylePreview(currentPrompt, 1200);
    }

    const newPromptInput = card.querySelector('.ss-style-preview-new');
    const errorEl = card.querySelector('.ss-style-confirm-error');
    newPromptInput.value = String(newPrompt || '').trim();

    function close(result) {
      overlay.remove();
      document.removeEventListener('keydown', onKeyDown);
      resolve(result);
    }

    function dismiss() {
      close(showCurrent ? 'keep' : 'cancel');
    }

    function onKeyDown(event) {
      if (event.key === 'Escape') dismiss();
    }

    function tryApply() {
      const editedPrompt = newPromptInput.value.trim();
      if (!editedPrompt) {
        errorEl.hidden = false;
        newPromptInput.focus();
        return;
      }
      close({ choice: 'apply', prompt: editedPrompt });
    }

    card.querySelector('[data-action="keep"]').addEventListener('click', dismiss);
    card.querySelector('[data-action="apply"]').addEventListener('click', tryApply);
    newPromptInput.addEventListener('input', () => {
      if (newPromptInput.value.trim()) errorEl.hidden = true;
    });
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) dismiss();
    });
    document.addEventListener('keydown', onKeyDown);

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    newPromptInput.focus();
    newPromptInput.setSelectionRange(newPromptInput.value.length, newPromptInput.value.length);
  });
}

function escapeStyleConfirmHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function confirmAndApplyLearnedStyle(settings, context, response, extraSettingsPatch = {}) {
  const snapshot = getConfiguredStyleSnapshot(settings, context);
  const choice = await showStyleApplyConfirm({
    title: snapshot.configured ? '새 스타일을 적용할까요?' : '분석된 스타일 확인',
    subtitle: snapshot.configured
      ? '기존에 설정된 스타일이 있습니다. 새로 분석한 스타일로 바꿀지 선택하세요.'
      : '분석된 답글 지침을 확인·수정한 뒤 적용하세요.',
    currentLabel: snapshot.label,
    currentPrompt: snapshot.prompt,
    newPrompt: response.prompt,
    sampleCount: response.sampleCount || 0,
    showCurrent: snapshot.configured,
  });

  if (choice === 'keep' || choice === 'cancel' || choice?.choice !== 'apply') {
    return { applied: false, choice: choice === 'keep' ? 'keep' : 'cancel' };
  }

  const promptToApply = String(choice.prompt || response.prompt || '').trim();
  if (!promptToApply) {
    return { applied: false, choice: 'cancel' };
  }

  return {
    applied: true,
    choice: 'apply',
    patch: buildLearnedStyleSettingsPatch(
      settings,
      context,
      { ...response, prompt: promptToApply },
      extraSettingsPatch
    ),
  };
}
