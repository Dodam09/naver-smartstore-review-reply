/**
 * 리뷰/문의 각각 독립된 답글 스타일 UI·저장 로직
 */
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

function readWorkbookSilently(data, options) {
  const prevError = console.error;
  console.error = (...args) => {
    const msg = String(args[0] ?? '');
    if (msg.includes('Bad uncompressed size') || msg.includes('Bad compressed size')) return;
    prevError.apply(console, args);
  };
  try {
    return XLSX.read(data, options);
  } finally {
    console.error = prevError;
  }
}

function createStyleChannel(config) {
  const {
    channelId,
    label,
    builtinPresets,
    learnedPresetId,
    storageKeys,
    els,
    getApiKey,
    getModel,
    onSettingsDirty,
    features = {},
  } = config;

  let customPresets = [];
  let tonePresetId = 'default';
  let activeStyleMode = 'preset';
  let savedCustomPrompt = '';
  let savedPresetId = 'default';
  let isApplyingPreset = false;
  let sampleFlow = createEmptySampleFlow();
  let sampleSaveTimer = null;
  let isAnalyzingSamples = false;

  function resetStaleSampleFlowFlags() {
    const staleMs = 45 * 1000;
    const now = Date.now();
    let changed = false;

    if (sampleFlow.fetching) {
      const started = sampleFlow.fetchStartedAt || 0;
      if (!started || now - started > staleMs) {
        sampleFlow.fetching = false;
        sampleFlow.fetchStartedAt = null;
        if (!sampleFlow.lastError) {
          sampleFlow.lastError = '가져오기가 중단되었습니다. 다시 시도해 주세요.';
          sampleFlow.lastErrorAt = now;
        }
        changed = true;
      }
    }

    if (sampleFlow.analyzing) {
      const started = sampleFlow.analyzeStartedAt || 0;
      if (!started || now - started > staleMs) {
        sampleFlow.analyzing = false;
        sampleFlow.analyzeStartedAt = null;
        isAnalyzingSamples = false;
        if (!sampleFlow.lastError) {
          sampleFlow.lastError = '분석이 중단되었습니다. 다시 시도해 주세요.';
          sampleFlow.lastErrorAt = now;
        }
        changed = true;
      }
    }

    if (changed) scheduleSaveSampleFlow();
  }

  function findChannelPreset(id) {
    if (channelId === 'inquiry') return findInquiryPreset(id, customPresets);
    return findPreset(id, customPresets);
  }

  function getDefaultPrompt() {
    return builtinPresets[0]?.prompt || '';
  }

  function getSampleFingerprint(samples) {
    const list = samples || normalizeSamples(parseReplySamplesFromText(els.sampleReplies.value));
    return list.map((s) => s.slice(0, 120)).join('\n---\n');
  }

  function inferActiveStyleMode(settings = {}) {
    const stored = settings[storageKeys.activeStyleMode];
    if (stored && ['pick', 'paste', 'preset', 'custom'].includes(stored)) return stored;

    const pid = settings[storageKeys.tonePresetId] || tonePresetId || 'default';
    if (pid === CUSTOM_PRESET_ID) return 'custom';
    if (pid === learnedPresetId) {
      const flow = settings[storageKeys.sampleFlow] || sampleFlow;
      if (flow.source === 'paste' || flow.source === 'file') return 'paste';
      return 'pick';
    }
    return 'preset';
  }

  function getLearnedPromptText() {
    const preset = findChannelPreset(learnedPresetId);
    return String(preset?.prompt || els.systemPrompt?.value || '').trim();
  }

  function syncLearnedPromptEditor() {
    const text = getLearnedPromptText();
    if (els.learnedSystemPrompt && els.learnedSystemPrompt.value !== text) {
      els.learnedSystemPrompt.value = text;
    }
    if (els.learnedSystemPromptPaste && els.learnedSystemPromptPaste.value !== text) {
      els.learnedSystemPromptPaste.value = text;
    }
  }

  function preservePanelScroll(fn) {
    const panel = els.styleModeList?.closest('.panel');
    const scrollTop = panel?.scrollTop ?? 0;
    fn();
    if (!panel) return;
    panel.scrollTop = scrollTop;
    requestAnimationFrame(() => {
      panel.scrollTop = scrollTop;
    });
  }

  function updateLearnedPromptEditorVisibility() {
    preservePanelScroll(() => {
      const show = hasLearnedPreset();
      const showPick = show && !isPasteLearnedSource();
      const showPaste = show && isPasteLearnedSource();

      if (els.learnedPromptEditor) els.learnedPromptEditor.hidden = !showPick;
      if (els.learnedPromptEditorPaste) els.learnedPromptEditorPaste.hidden = !showPaste;

      if (show) syncLearnedPromptEditor();
    });
  }

  function isPasteLearnedSource() {
    return sampleFlow.source === 'paste' || sampleFlow.source === 'file';
  }

  function persistLearnedPrompt(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return;

    const learned = findChannelPreset(learnedPresetId);
    const nextLearned = {
      id: learnedPresetId,
      name: learned?.name || `내 스타일 (샘플 ${sampleFlow.analyzedCount || 0}개)`,
      prompt: trimmed,
      updatedAt: Date.now(),
    };
    customPresets = [
      nextLearned,
      ...customPresets.filter((p) => p.id !== learnedPresetId),
    ];
    renderPresetOptions();

    if (tonePresetId === learnedPresetId && els.systemPrompt) {
      els.systemPrompt.value = trimmed;
    }
    updateActiveStyleBanner();
    onSettingsDirty();
  }

  function onLearnedSystemPromptInput(event) {
    if (isApplyingPreset) return;
    const value = event?.target?.value ?? els.learnedSystemPrompt?.value ?? '';
    if (els.learnedSystemPrompt && els.learnedSystemPrompt !== event?.target) {
      els.learnedSystemPrompt.value = value;
    }
    if (els.learnedSystemPromptPaste && els.learnedSystemPromptPaste !== event?.target) {
      els.learnedSystemPromptPaste.value = value;
    }
    persistLearnedPrompt(value);
  }

  function hasLearnedPreset() {
    return !!findChannelPreset(learnedPresetId)?.prompt;
  }

  function isPickConfigured() {
    return hasLearnedPreset() && sampleFlow.source === 'seller-pick';
  }

  function isPasteConfigured() {
    return (
      hasLearnedPreset() &&
      (sampleFlow.source === 'paste' || sampleFlow.source === 'file')
    );
  }

  function isCustomConfigured() {
    return !!(savedCustomPrompt.trim() || (tonePresetId === CUSTOM_PRESET_ID && els.systemPrompt.value.trim()));
  }

  function isModeApplied(mode) {
    if (activeStyleMode !== mode) return false;
    if (mode === 'preset') {
      return tonePresetId !== CUSTOM_PRESET_ID && tonePresetId !== learnedPresetId;
    }
    if (mode === 'custom') return tonePresetId === CUSTOM_PRESET_ID;
    if (mode === 'pick' || mode === 'paste') return tonePresetId === learnedPresetId;
    return false;
  }

  function persistCurrentModeDraft() {
    if (activeStyleMode === 'custom') {
      savedCustomPrompt = els.systemPrompt.value.trim();
    }
    if (
      activeStyleMode === 'preset' &&
      tonePresetId !== CUSTOM_PRESET_ID &&
      tonePresetId !== learnedPresetId
    ) {
      savedPresetId = tonePresetId;
    }
  }

  function getModeBadge(mode) {
    const isActive = activeStyleMode === mode;
    const applied = isModeApplied(mode);
    const ready =
      mode === 'pick'
        ? isPickConfigured()
        : mode === 'paste'
          ? isPasteConfigured()
          : mode === 'preset'
            ? true
            : isCustomConfigured();

    if (isActive && applied) return { text: '✓ 적용 중', className: 'style-mode-badge applied' };
    if (isActive) return { text: '선택됨 · 설정 필요', className: 'style-mode-badge pending' };
    if (ready) return { text: '설정 완료', className: 'style-mode-badge ready' };
    return { text: '미설정', className: 'style-mode-badge' };
  }

  function updateStyleModeCardsUI() {
    const list = els.styleModeList;
    if (!list) return;

    preservePanelScroll(() => {
      list.querySelectorAll('.style-mode-card').forEach((card) => {
        const mode = card.dataset.mode;
        const isActive = activeStyleMode === mode;
        card.classList.toggle('active', isActive);

        const body = card.querySelector('.style-mode-body');
        if (body) body.classList.toggle('is-collapsed', !isActive);

        const badge = card.querySelector('.style-mode-badge');
        const { text, className } = getModeBadge(mode);
        if (badge) {
          badge.textContent = text;
          badge.className = className;
        }
      });
    });
  }

  function selectStyleMode(mode, save = true) {
    if (!['pick', 'paste', 'preset', 'custom'].includes(mode)) return;

    preservePanelScroll(() => {
      persistCurrentModeDraft();
      activeStyleMode = mode;

      if (mode === 'pick') {
        const learned = findChannelPreset(learnedPresetId);
        if (learned?.prompt) {
          applyPresetSelection(learnedPresetId, learned.prompt, save, { skipModeSync: true, skipPanelUi: true });
        }
      } else if (mode === 'paste') {
        const learned = findChannelPreset(learnedPresetId);
        if (learned?.prompt && isPasteConfigured()) {
          applyPresetSelection(learnedPresetId, learned.prompt, save, { skipModeSync: true, skipPanelUi: true });
        }
      } else if (mode === 'preset') {
        const pid =
          savedPresetId && (findChannelPreset(savedPresetId) || savedPresetId === CUSTOM_PRESET_ID)
            ? savedPresetId
            : 'default';
        if (pid !== CUSTOM_PRESET_ID && pid !== learnedPresetId) {
          applyPresetSelection(pid, null, save, { skipModeSync: true, skipPanelUi: true });
        } else {
          applyPresetSelection('default', null, save, { skipModeSync: true, skipPanelUi: true });
        }
      } else if (mode === 'custom') {
        applyPresetSelection(
          CUSTOM_PRESET_ID,
          savedCustomPrompt || els.systemPrompt.value.trim(),
          save,
          { skipModeSync: true, skipPanelUi: true }
        );
      }

      if (save) onSettingsDirty();
      updateStyleModeCardsUI();
      updateLearnedPromptEditorVisibility();
      updateActiveStyleBanner();
    });
  }

  function initFromSettings(settings) {
    if (settings[storageKeys.sampleReplies]) {
      els.sampleReplies.value = settings[storageKeys.sampleReplies];
    }
    customPresets = settings[storageKeys.customPresets] || [];
    tonePresetId = settings[storageKeys.tonePresetId] || 'default';
    savedCustomPrompt = settings[storageKeys.savedCustomPrompt] || '';
    savedPresetId = settings[storageKeys.savedPresetId] || tonePresetId || 'default';
    if (savedPresetId === learnedPresetId || savedPresetId === CUSTOM_PRESET_ID) {
      savedPresetId = 'default';
    }
    sampleFlow = {
      ...createEmptySampleFlow(),
      ...(settings[storageKeys.sampleFlow] || {}),
    };
    resetStaleSampleFlowFlags();
    isAnalyzingSamples = !!sampleFlow.analyzing;

    if (settings[storageKeys.sampleFlow]?.analyzedAt && !sampleFlow.analyzedFingerprint && els.sampleReplies.value.trim()) {
      sampleFlow.analyzedFingerprint = getSampleFingerprint();
    }

    if (settings[storageKeys.systemPrompt]) {
      applyPresetSelection(tonePresetId, settings[storageKeys.systemPrompt], false, { skipModeSync: true });
    } else {
      applyPresetSelection('default', null, false, { skipModeSync: true });
    }

    activeStyleMode = inferActiveStyleMode(settings);

    renderPresetOptions();
    updateSampleCount();
    updateSampleFlowUI();
    updateStyleModeCardsUI();
    updateLearnedPromptEditorVisibility();
    updateActiveStyleBanner();
  }

  function renderPresetOptions() {
    const select = els.tonePreset;
    if (!select) return;
    select.innerHTML = '';

    const builtinGroup = document.createElement('optgroup');
    builtinGroup.label = `${label} 기본 프리셋`;
    for (const preset of builtinPresets) {
      const opt = document.createElement('option');
      opt.value = preset.id;
      opt.textContent = preset.name;
      builtinGroup.appendChild(opt);
    }
    select.appendChild(builtinGroup);

    if (customPresets.length) {
      const customGroup = document.createElement('optgroup');
      customGroup.label = `${label} 내 스타일`;
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
      findChannelPreset(tonePresetId) || tonePresetId === CUSTOM_PRESET_ID ? tonePresetId : 'default';
  }

  function getActiveStyleBannerContent() {
    const settings = {
      [storageKeys.tonePresetId]: tonePresetId,
      [storageKeys.systemPrompt]: els.systemPrompt.value.trim(),
      [storageKeys.customPresets]: customPresets,
    };
    const snapshot = getConfiguredStyleSnapshot(settings, channelId);
    const prompt = snapshot.prompt || getDefaultPrompt();
    const method = getActiveStyleMethodLabel();

    let variant = 'preset';
    if (tonePresetId === learnedPresetId) variant = 'learned';
    else if (tonePresetId === CUSTOM_PRESET_ID) variant = 'custom';

    return { variant, prompt: prompt || '(지침 없음)', method };
  }

  function updateActiveStyleBanner() {
    const panel = els.activeStyleBanner;
    if (!panel) return;

    const { variant, prompt, method } = getActiveStyleBannerContent();
    panel.className = `active-style-panel ${variant}`;

    const labelEl = panel.querySelector('.active-style-label');
    const subEl = panel.querySelector('.active-style-sub');
    const promptEl = els.activeStylePrompt || panel.querySelector('.active-style-prompt-box');

    if (labelEl) labelEl.textContent = '적용 중인 AI 지침';
    if (subEl) {
      subEl.textContent = method;
      subEl.hidden = !method;
    }
    if (promptEl) promptEl.textContent = prompt;
  }

  function getActiveStyleMethodLabel() {
    if (tonePresetId === learnedPresetId) {
      const count = sampleFlow.analyzedCount || 0;
      if (sampleFlow.source === 'seller-pick') {
        return `기존 답글 선택${count ? ` · ${count}개 분석` : ''}`;
      }
      if (sampleFlow.source === 'file') {
        return `파일 업로드${count ? ` · ${count}개 분석` : ''}`;
      }
      if (sampleFlow.source === 'paste') {
        return `답글 붙여넣기${count ? ` · ${count}개 분석` : ''}`;
      }
      return `답글 분석${count ? ` · ${count}개` : ''}`;
    }
    if (tonePresetId === CUSTOM_PRESET_ID) return '직접 지침 작성';
    const preset = findChannelPreset(tonePresetId);
    return preset ? `프리셋 · ${preset.name}` : '프리셋 · 기본';
  }

  function applyPresetSelection(presetId, overridePrompt, save = true, options = {}) {
    isApplyingPreset = true;
    tonePresetId = presetId;
    if (els.tonePreset) els.tonePreset.value = presetId;

    if (presetId === CUSTOM_PRESET_ID) {
      if (overridePrompt != null) els.systemPrompt.value = overridePrompt;
      if (els.presetNote) {
        els.presetNote.textContent = `[${label}] 직접 작성 모드입니다.`;
      }
      if (!options.skipModeSync) {
        activeStyleMode = 'custom';
        savedCustomPrompt = els.systemPrompt.value.trim();
      }
    } else if (presetId === learnedPresetId) {
      const preset = findChannelPreset(presetId);
      const prompt = overridePrompt ?? preset?.prompt ?? getDefaultPrompt();
      els.systemPrompt.value = prompt;
      if (els.presetNote) {
        els.presetNote.textContent = `내 답글 스타일이 적용되었습니다.`;
      }
      if (!options.skipModeSync) {
        if (sampleFlow.source === 'paste' || sampleFlow.source === 'file') activeStyleMode = 'paste';
        else activeStyleMode = 'pick';
      }
      syncLearnedPromptEditor();
    } else {
      const preset = findChannelPreset(presetId);
      const prompt = overridePrompt ?? preset?.prompt ?? getDefaultPrompt();
      els.systemPrompt.value = prompt;
      if (els.presetNote) {
        els.presetNote.textContent = preset
          ? `「${preset.name}」 프리셋이 선택되었습니다.`
          : `[${label}] 프리셋이 적용되었습니다.`;
      }
      if (!options.skipModeSync) {
        activeStyleMode = 'preset';
        savedPresetId = presetId;
      }
    }

    isApplyingPreset = false;
    if (save) scheduleSaveSampleFlow();
    if (save) onSettingsDirty();
    if (options.skipPanelUi) return;

    preservePanelScroll(() => {
      updateSampleFlowUI();
      updateStyleModeCardsUI();
      updateLearnedPromptEditorVisibility();
      updateActiveStyleBanner();
    });
  }

  function onPresetChange() {
    const id = els.tonePreset.value;
    activeStyleMode = 'preset';
    if (id === CUSTOM_PRESET_ID) {
      activeStyleMode = 'custom';
      applyPresetSelection(CUSTOM_PRESET_ID, els.systemPrompt.value.trim());
      return;
    }
    savedPresetId = id;
    applyPresetSelection(id);
  }

  function onSystemPromptInput() {
    if (isApplyingPreset) return;
    activeStyleMode = 'custom';
    savedCustomPrompt = els.systemPrompt.value.trim();
    if (tonePresetId !== CUSTOM_PRESET_ID) {
      tonePresetId = CUSTOM_PRESET_ID;
      if (els.tonePreset) els.tonePreset.value = CUSTOM_PRESET_ID;
      if (els.presetNote) {
        els.presetNote.textContent = `[${label}] 직접 작성 모드입니다.`;
      }
    }
    updateStyleModeCardsUI();
    updateActiveStyleBanner();
    onSettingsDirty();
  }

  function getSystemPrompt() {
    return els.systemPrompt.value.trim() || getDefaultPrompt();
  }

  function patchSettings(settings) {
    persistCurrentModeDraft();
    return {
      [storageKeys.systemPrompt]: els.systemPrompt.value.trim(),
      [storageKeys.tonePresetId]: tonePresetId,
      [storageKeys.customPresets]: customPresets,
      [storageKeys.sampleReplies]: els.sampleReplies.value,
      [storageKeys.sampleFlow]: sampleFlow,
      [storageKeys.activeStyleMode]: activeStyleMode,
      [storageKeys.savedCustomPrompt]: savedCustomPrompt,
      [storageKeys.savedPresetId]: savedPresetId,
    };
  }

  function scheduleSaveSampleFlow() {
    clearTimeout(sampleSaveTimer);
    sampleSaveTimer = setTimeout(() => {
      onSettingsDirty();
    }, 300);
  }

  function setSampleFlowStatus(message, variant = '') {
    els.sampleFlowStatus.textContent = message;
    els.sampleFlowStatus.className = 'sample-flow-status';
    if (variant) els.sampleFlowStatus.classList.add(variant);
  }

  function updateSampleCount() {
    const count = normalizeSamples(parseReplySamplesFromText(els.sampleReplies.value)).length;
    els.sampleCount.textContent = `예시 ${count}개${count >= 2 ? ' · 만들 수 있음' : ' · 2개 이상 필요'}`;
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

  function onSampleRepliesInput() {
    updateSampleCount();
    scheduleSaveSampleFlow();

    const count = normalizeSamples(parseReplySamplesFromText(els.sampleReplies.value)).length;
    if (count >= 2) {
      const prevFingerprint = sampleFlow.analyzedFingerprint;
      const nextFingerprint = getSampleFingerprint();
      if (sampleFlow.source !== 'paste' || sampleFlow.loadedCount !== count) {
        markSampleLoaded({ source: 'paste', sourceLabel: '직접 입력', count });
      } else if (prevFingerprint && prevFingerprint !== nextFingerprint) {
        sampleFlow.loadedCount = count;
        invalidateSampleAnalysis('내용이 바뀌었습니다. 「붙여넣은 답글로 말투 만들기」를 다시 눌러 주세요.');
        scheduleSaveSampleFlow();
        updateSampleFlowUI();
      } else {
        sampleFlow.loadedCount = count;
        scheduleSaveSampleFlow();
      }
    } else {
      sampleFlow.loadedAt = null;
      sampleFlow.loadedCount = 0;
      sampleFlow.source = null;
      sampleFlow.sourceLabel = '';
      invalidateSampleAnalysis('예시 답글을 2개 이상 넣어 주세요.');
    }

    updateSampleFlowUI();
  }

  function updateSampleFlowUI() {
    preservePanelScroll(() => {
      updateActiveStyleBanner();

    const count = normalizeSamples(parseReplySamplesFromText(els.sampleReplies.value)).length;
    const hasSamples = count >= 2;
    const isAnalyzed =
      !!sampleFlow.analyzedAt && sampleFlow.analyzedFingerprint === getSampleFingerprint();
    const isApplied = tonePresetId === learnedPresetId && findChannelPreset(learnedPresetId);
    const needsReanalysis = hasSamples && sampleFlow.analyzedAt && !isAnalyzed;

    if (els.sampleStepLoad) els.sampleStepLoad.className = 'sample-step';
    if (els.sampleStepAnalyze) els.sampleStepAnalyze.className = 'sample-step';
    if (els.sampleStepApply) els.sampleStepApply.className = 'sample-step';

    if (els.sampleStepLoad) {
      if (hasSamples) {
        els.sampleStepLoad.classList.add('done');
        els.sampleStepLoad.textContent = `① 예시 ${count}개`;
      } else {
        els.sampleStepLoad.textContent = '① 예시 준비';
      }
    }

    if (els.sampleStepAnalyze) {
      if (isAnalyzed) {
        els.sampleStepAnalyze.classList.add('done');
        els.sampleStepAnalyze.textContent = '② 만들기 완료';
      } else if (needsReanalysis) {
        els.sampleStepAnalyze.classList.add('stale');
        els.sampleStepAnalyze.textContent = '② 다시 만들기';
      } else if (hasSamples) {
        els.sampleStepAnalyze.classList.add('active');
        els.sampleStepAnalyze.textContent = '② 만들기 대기';
      } else {
        els.sampleStepAnalyze.textContent = '② 만들기';
      }
    }

    if (els.sampleStepApply) {
      if (isApplied && isAnalyzed) {
        els.sampleStepApply.classList.add('done');
        els.sampleStepApply.textContent = '③ 저장됨';
      } else if (isAnalyzed) {
        els.sampleStepApply.classList.add('active');
        els.sampleStepApply.textContent = '③ 저장 대기';
      } else {
        els.sampleStepApply.textContent = '③ 저장';
      }
    }

    updateSampleCount();

    if (features.stylePick && els.openStylePickBtn) {
      if (sampleFlow.fetching) {
        els.openStylePickBtn.disabled = true;
        els.openStylePickBtn.textContent = '가져오는 중...';
        els.openStylePickBtn.classList.add('loading');
        setSampleFlowStatus('판매자센터에서 답글이 달린 리뷰를 찾는 중...', 'loading');
        return;
      }
      els.openStylePickBtn.disabled = false;
      els.openStylePickBtn.textContent = '기존 답글로 내 말투 만들기';
      els.openStylePickBtn.classList.remove('loading');
    }

    if (isAnalyzed && isApplied) {
      setSampleFlowStatus(
        `✓ 말투 만들기 완료 · ${sampleFlow.sourceLabel || '기존 답글'} ${count}개\n지금부터 AI가 이 말투로 ${label} 답글을 씁니다.`,
        'success'
      );
    }

    const canPasteAnalyze = hasSamples && !(isAnalyzed && isApplied && !needsReanalysis);

    if (els.analyzeBtn) {
      els.analyzeBtn.disabled = !canPasteAnalyze;
      els.analyzeBtn.classList.remove('loading');
      if (isAnalyzed && canPasteAnalyze && (sampleFlow.source === 'paste' || sampleFlow.source === 'file')) {
        els.analyzeBtn.textContent = `✓ 말투 만들기 완료 (${sampleFlow.analyzedCount}개) · 다시 만들기`;
        els.analyzeBtn.classList.add('done');
        els.analyzeBtn.disabled = false;
      } else {
        els.analyzeBtn.textContent = '붙여넣은 답글로 말투 만들기';
        els.analyzeBtn.classList.remove('done');
      }
    }

    if (isAnalyzed && isApplied && !needsReanalysis) {
      return;
    }

    if (isAnalyzingSamples || sampleFlow.analyzing) {
      if (els.analyzeBtn) {
        els.analyzeBtn.disabled = true;
        els.analyzeBtn.classList.add('loading');
        els.analyzeBtn.textContent = '분석 중…';
      }
      setSampleFlowStatus(`${label} 답글 말투를 만드는 중…`, 'loading');
      return;
    }

    if (sampleFlow.lastError && !hasSamples && !isAnalyzed) {
      setSampleFlowStatus(sampleFlow.lastError, 'error');
      return;
    }

    if (isAnalyzed && !isApplied) {
      setSampleFlowStatus(
        `✓ 말투 분석 완료 · ${sampleFlow.analyzedCount}개 예시`,
        'success'
      );
      return;
    }

    if (hasSamples && sampleFlow.loadedAt) {
      if (features.stylePick && sampleFlow.source === 'seller-pick') {
        setSampleFlowStatus(
          `✓ ${sampleFlow.sourceLabel || '기존 답글'} ${count}개 선택됨\n선택 창에서 「스타일 분석」을 눌러 말투를 완성하세요.`,
          'warn'
        );
        return;
      }
      const next = needsReanalysis
        ? '내용이 바뀌었습니다. 아래 「붙여넣은 답글로 말투 만들기」를 누르세요.'
        : '아래 「붙여넣은 답글로 말투 만들기」를 누르세요.';
      setSampleFlowStatus(
        `✓ ${sampleFlow.sourceLabel || '예시'} ${count}개 준비됨\n${next}`,
        needsReanalysis ? 'warn' : 'success'
      );
      return;
    }

    if (count > 0 && count < 2) {
      setSampleFlowStatus('예시가 1개뿐이에요. 1개 더 넣어 주세요.', 'warn');
      return;
    }

    setSampleFlowStatus(
      features.stylePick
        ? '버튼을 누르면 새 창에서 답글 선택과 말투 생성이 됩니다.'
        : '답글 2개 이상을 넣은 뒤 「붙여넣은 답글로 말투 만들기」를 누르세요.'
    );
    updateStyleModeCardsUI();
    });
  }

  async function collectSampleReplies() {
    const fromText = normalizeSamples(parseReplySamplesFromText(els.sampleReplies.value));
    if (fromText.length >= 2) return fromText;

    const file = els.sampleFile?.files?.[0];
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

  async function onSampleFileSelected(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      let samples;
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
        samples = normalizeSamples(parseReplySamplesFromWorkbookRows(rows));
      } else {
        samples = normalizeSamples(parseReplySamplesFromText(await file.text()));
      }

      els.sampleReplies.value = samples.join('\n\n---\n\n');
      markSampleLoaded({ source: 'file', sourceLabel: `파일 (${file.name})`, count: samples.length });
      updateSampleCount();
      setSampleFlowStatus(
        `✓ 파일에서 답글 ${samples.length}개를 불러왔습니다.\n「붙여넣은 답글로 말투 만들기」를 누르세요.`,
        'success'
      );
    } catch (err) {
      setSampleFlowStatus(`샘플 파일 오류: ${err.message}`, 'error');
      updateSampleFlowUI();
    }
  }

  async function onAnalyzeSamples() {
    const apiKey = getApiKey();
    if (!(await hasAiCredentialsAsync(apiKey))) {
      setSampleFlowStatus('[계정]에서 로그인하거나 API 키를 입력해 주세요.', 'warn');
      return;
    }

    let samples;
    try {
      samples = await collectSampleReplies();
      if (samples.length < 2) {
        throw new Error('샘플 답글이 2개 이상 필요합니다.');
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
    onSettingsDirty();
    updateSampleFlowUI();

    try {
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          {
            type: 'ANALYZE_TONE_SAMPLES_JOB',
            payload: {
              apiKey,
              samples,
              model: getModel(),
              context: channelId,
              skipPersist: true,
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

      const settingsData = await new Promise((resolve) => {
        chrome.storage.local.get([CONFIG.SETTINGS_KEY], (data) => resolve(data[CONFIG.SETTINGS_KEY] || {}));
      });
      const confirm = await confirmAndApplyLearnedStyle(settingsData, channelId, response, {
        [storageKeys.sampleReplies]: samples.join('\n\n---\n\n'),
      });

      if (!confirm.applied) {
        isAnalyzingSamples = false;
        sampleFlow.analyzing = false;
        sampleFlow.analyzeStartedAt = null;
        setSampleFlowStatus(
          confirm.choice === 'keep'
            ? '분석은 완료했지만 기존 스타일을 유지했습니다.'
            : '새 스타일 적용을 취소했습니다.',
          'warn'
        );
        updateSampleFlowUI();
        return;
      }

      await new Promise((resolve) => {
        chrome.storage.local.set({ [CONFIG.SETTINGS_KEY]: confirm.patch }, resolve);
      });

      customPresets = confirm.patch[storageKeys.customPresets] || customPresets;
      tonePresetId = confirm.patch[storageKeys.tonePresetId] || learnedPresetId;
      renderPresetOptions();
      sampleFlow = { ...sampleFlow, ...(response.sampleFlow || {}) };
      sampleFlow.analyzedFingerprint = getSampleFingerprint(samples);
      if (!sampleFlow.source) sampleFlow.source = 'paste';
      isAnalyzingSamples = false;
      activeStyleMode = 'paste';
      applyPresetSelection(learnedPresetId, response.prompt, true);
      setSampleFlowStatus(
        `✓ 내 답글 말투가 적용되었습니다. (${response.sampleCount}개 참고)`,
        'success'
      );
      updateSampleFlowUI();
    } catch (err) {
      isAnalyzingSamples = false;
      sampleFlow.analyzing = false;
      sampleFlow.analyzeStartedAt = null;
      setSampleFlowStatus(`분석 오류: ${err.message}`, 'error');
      updateSampleFlowUI();
    }
  }

  function syncFromSettings(settings) {
    if (settings[storageKeys.savedCustomPrompt] != null) {
      savedCustomPrompt = settings[storageKeys.savedCustomPrompt] || '';
    }
    if (settings[storageKeys.savedPresetId]) {
      savedPresetId = settings[storageKeys.savedPresetId];
      if (savedPresetId === learnedPresetId || savedPresetId === CUSTOM_PRESET_ID) {
        savedPresetId = 'default';
      }
    }
    if (settings[storageKeys.activeStyleMode]) {
      activeStyleMode = settings[storageKeys.activeStyleMode];
    }

    if (settings[storageKeys.sampleFlow] || settings[storageKeys.sampleReplies] != null) {
      if (settings[storageKeys.sampleReplies] != null) {
        els.sampleReplies.value = settings[storageKeys.sampleReplies];
      }
      sampleFlow = { ...createEmptySampleFlow(), ...(settings[storageKeys.sampleFlow] || {}) };
      resetStaleSampleFlowFlags();
      if (sampleFlow.analyzedAt && !sampleFlow.analyzedFingerprint && els.sampleReplies.value.trim()) {
        sampleFlow.analyzedFingerprint = getSampleFingerprint();
      }
      updateSampleCount();
      updateSampleFlowUI();
    }
    if (settings[storageKeys.customPresets]) {
      customPresets = settings[storageKeys.customPresets];
      renderPresetOptions();
    }
    if (settings[storageKeys.tonePresetId] && settings[storageKeys.tonePresetId] !== tonePresetId) {
      tonePresetId = settings[storageKeys.tonePresetId];
      applyPresetSelection(tonePresetId, settings[storageKeys.systemPrompt], false, { skipModeSync: true });
    } else if (settings[storageKeys.tonePresetId]) {
      applyPresetSelection(tonePresetId, settings[storageKeys.systemPrompt], false, { skipModeSync: true });
    }

    if (!settings[storageKeys.activeStyleMode]) {
      activeStyleMode = inferActiveStyleMode(settings);
    }

    updateStyleModeCardsUI();
    updateLearnedPromptEditorVisibility();
    updateActiveStyleBanner();
  }

  function bindEvents() {
    if (els.tonePreset) els.tonePreset.addEventListener('change', onPresetChange);
    if (els.systemPrompt) els.systemPrompt.addEventListener('input', onSystemPromptInput);
    if (els.analyzeBtn) els.analyzeBtn.addEventListener('click', onAnalyzeSamples);
    if (els.sampleReplies) els.sampleReplies.addEventListener('input', onSampleRepliesInput);
    if (els.sampleFile) els.sampleFile.addEventListener('change', onSampleFileSelected);
    if (els.downloadSampleXlsxBtn) {
      els.downloadSampleXlsxBtn.addEventListener('click', onDownloadSampleXlsxTemplate);
    }
    if (els.downloadSampleTxtBtn) {
      els.downloadSampleTxtBtn.addEventListener('click', onDownloadSampleTxtTemplate);
    }
    if (els.learnedSystemPrompt) {
      els.learnedSystemPrompt.addEventListener('input', onLearnedSystemPromptInput);
    }
    if (els.learnedSystemPromptPaste) {
      els.learnedSystemPromptPaste.addEventListener('input', onLearnedSystemPromptInput);
    }
    if (els.styleModeList) {
      els.styleModeList.querySelectorAll('.style-mode-head').forEach((btn) => {
        btn.addEventListener('mousedown', (event) => {
          event.preventDefault();
        });
        btn.addEventListener('click', () => {
          const mode = btn.closest('.style-mode-card')?.dataset.mode;
          if (mode) selectStyleMode(mode);
        });
      });
    }
  }

  function onDownloadSampleXlsxTemplate() {
    try {
      const rows = getSampleReplyTemplateRows();
      const sheet = XLSX.utils.aoa_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, '샘플답글');
      XLSX.writeFile(workbook, `${label}_답글샘플_양식.xlsx`);
    } catch (err) {
      setSampleFlowStatus(`양식 다운로드 오류: ${err.message}`, 'error');
    }
  }

  function onDownloadSampleTxtTemplate() {
    try {
      const text = getSampleReplyTemplateText();
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${label}_답글샘플_양식.txt`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setSampleFlowStatus(`양식 다운로드 오류: ${err.message}`, 'error');
    }
  }

  return {
    initFromSettings,
    renderPresetOptions,
    getSystemPrompt,
    patchSettings,
    syncFromSettings,
    bindEvents,
    updateSampleFlowUI,
    updateStyleModeCardsUI,
    updateActiveStyleBanner,
    selectStyleMode,
    markSampleLoaded,
    getSampleFlow: () => sampleFlow,
    setSampleFlowStatus,
  };
}
