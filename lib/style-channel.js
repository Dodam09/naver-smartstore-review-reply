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

  function initFromSettings(settings) {
    if (settings[storageKeys.sampleReplies]) {
      els.sampleReplies.value = settings[storageKeys.sampleReplies];
    }
    customPresets = settings[storageKeys.customPresets] || [];
    tonePresetId = settings[storageKeys.tonePresetId] || 'default';
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
      applyPresetSelection(tonePresetId, settings[storageKeys.systemPrompt], false);
    } else {
      applyPresetSelection('default', null, false);
    }

    renderPresetOptions();
    updateSampleCount();
    updateSampleFlowUI();
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

  function applyPresetSelection(presetId, overridePrompt, save = true) {
    isApplyingPreset = true;
    tonePresetId = presetId;
    els.tonePreset.value = presetId;

    if (presetId === CUSTOM_PRESET_ID) {
      if (overridePrompt != null) els.systemPrompt.value = overridePrompt;
      els.presetNote.textContent = `[${label}] 직접 작성 모드입니다. 아래 지침을 자유롭게 수정하세요.`;
    } else {
      const preset = findChannelPreset(presetId);
      const prompt = overridePrompt ?? preset?.prompt ?? getDefaultPrompt();
      els.systemPrompt.value = prompt;
      els.presetNote.textContent = preset
        ? `[${label}] 「${preset.name}」 프리셋이 적용되었습니다. 수정하면 직접 작성으로 전환됩니다.`
        : `[${label}] 프리셋 지침이 적용되었습니다.`;
    }

    isApplyingPreset = false;
    if (save) scheduleSaveSampleFlow();
    if (save) onSettingsDirty();
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
      els.presetNote.textContent = `[${label}] 직접 작성 모드입니다. 아래 지침을 자유롭게 수정하세요.`;
    }
    onSettingsDirty();
  }

  function getSystemPrompt() {
    return els.systemPrompt.value.trim() || getDefaultPrompt();
  }

  function patchSettings(settings) {
    return {
      [storageKeys.systemPrompt]: els.systemPrompt.value.trim(),
      [storageKeys.tonePresetId]: tonePresetId,
      [storageKeys.customPresets]: customPresets,
      [storageKeys.sampleReplies]: els.sampleReplies.value,
      [storageKeys.sampleFlow]: sampleFlow,
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
    els.sampleCount.textContent = `샘플 ${count}개${count >= 2 ? ' · 분석 가능' : ' · 2개 이상 필요'}`;
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
      if (!sampleFlow.loadedAt || sampleFlow.source === 'paste') {
        markSampleLoaded({ source: 'paste', sourceLabel: '직접 입력', count });
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

  function updateSampleFlowUI() {
    const count = normalizeSamples(parseReplySamplesFromText(els.sampleReplies.value)).length;
    const hasSamples = count >= 2;
    const isAnalyzed =
      !!sampleFlow.analyzedAt && sampleFlow.analyzedFingerprint === getSampleFingerprint();
    const isApplied = tonePresetId === learnedPresetId && findChannelPreset(learnedPresetId);
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
      els.openStylePickBtn.textContent = '판매자센터 답글 선택 · 스타일 분석';
      els.openStylePickBtn.classList.remove('loading');
    }

    if (isAnalyzingSamples || sampleFlow.analyzing) {
      if (els.analyzeBtn) {
        els.analyzeBtn.disabled = true;
        els.analyzeBtn.classList.add('loading');
        els.analyzeBtn.textContent = '분석 중...';
      }
      setSampleFlowStatus(`Gemini가 ${label} 답글 스타일을 분석하는 중입니다...`, 'loading');
      return;
    }

    if (els.analyzeBtn) {
      els.analyzeBtn.disabled = false;
      els.analyzeBtn.classList.remove('loading');
      if (isAnalyzed) {
        els.analyzeBtn.textContent = `✓ 분석 완료 (${sampleFlow.analyzedCount}개) · 다시 분석`;
        els.analyzeBtn.classList.add('done');
      } else {
        els.analyzeBtn.textContent = '샘플 분석 → 프롬프트 생성';
        els.analyzeBtn.classList.remove('done');
      }
    }

    if (sampleFlow.lastError && !hasSamples && !isAnalyzed) {
      setSampleFlowStatus(sampleFlow.lastError, 'error');
      return;
    }

    if (isAnalyzed && isApplied) {
      setSampleFlowStatus(
        `✓ 완료 · ${sampleFlow.sourceLabel || '샘플'} ${count}개 → 분석 ${sampleFlow.analyzedCount}개\n「내 스타일」 프리셋이 ${label} 답변 생성에 적용 중입니다.`,
        'success'
      );
      return;
    }

    if (isAnalyzed) {
      setSampleFlowStatus(
        `✓ 분석 완료 · ${sampleFlow.analyzedCount}개\n톤 프리셋에서 「내 스타일」을 선택하세요.`,
        'success'
      );
      return;
    }

    if (hasSamples && sampleFlow.loadedAt) {
      const next = needsReanalysis
        ? '샘플이 변경되어 다시 분석이 필요합니다.'
        : '[샘플 분석 → 프롬프트 생성] 버튼을 눌러 주세요.';
      setSampleFlowStatus(
        `✓ ${sampleFlow.sourceLabel || '샘플'} ${count}개 준비됨\n${next}`,
        needsReanalysis ? 'warn' : 'success'
      );
      return;
    }

    if (count > 0 && count < 2) {
      setSampleFlowStatus('샘플이 1개뿐입니다. 1개 더 추가해 주세요.', 'warn');
      return;
    }

    setSampleFlowStatus(
      features.stylePick
        ? `${label} 답글 샘플 2개 이상을 준비한 뒤 [샘플 분석]을 누르세요.\n판매자센터 답글은 [답글 선택 · 스타일 분석]을 사용할 수 있습니다.`
        : `${label} 답글 샘플 2개 이상을 붙여넣은 뒤 [샘플 분석]을 누르세요.`
    );
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
        `✓ 파일에서 샘플 ${samples.length}개를 불러왔습니다.\n다음: [샘플 분석 → 프롬프트 생성]을 누르세요.`,
        'success'
      );
    } catch (err) {
      setSampleFlowStatus(`샘플 파일 오류: ${err.message}`, 'error');
      updateSampleFlowUI();
    }
  }

  async function onAnalyzeSamples() {
    const apiKey = getApiKey();
    if (!apiKey || apiKey.includes('YOUR_GEMINI')) {
      setSampleFlowStatus('Gemini API 키를 [설정] 탭에서 먼저 입력하세요.', 'warn');
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

      customPresets = response.customPresets || customPresets;
      tonePresetId = response.tonePresetId || learnedPresetId;
      renderPresetOptions();
      sampleFlow = { ...sampleFlow, ...(response.sampleFlow || {}) };
      sampleFlow.analyzedFingerprint = getSampleFingerprint(samples);
      isAnalyzingSamples = false;
      applyPresetSelection(learnedPresetId, response.prompt, true);
      setSampleFlowStatus(
        `✓ 분석 완료 · 샘플 ${response.sampleCount}개로 「내 스타일」 프리셋을 만들었습니다.\n${label} AI 답변 생성 시 이 톤이 적용됩니다.`,
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
    if (settings[storageKeys.sampleFlow] || settings[storageKeys.sampleReplies] != null) {
      if (settings[storageKeys.sampleReplies] != null) {
        els.sampleReplies.value = settings[storageKeys.sampleReplies];
      }
      sampleFlow = { ...createEmptySampleFlow(), ...(settings[storageKeys.sampleFlow] || {}) };
      resetStaleSampleFlowFlags();
      updateSampleCount();
      updateSampleFlowUI();
    }
    if (settings[storageKeys.customPresets]) {
      customPresets = settings[storageKeys.customPresets];
      renderPresetOptions();
    }
    if (settings[storageKeys.tonePresetId] && settings[storageKeys.tonePresetId] !== tonePresetId) {
      tonePresetId = settings[storageKeys.tonePresetId];
      applyPresetSelection(tonePresetId, settings[storageKeys.systemPrompt], false);
    }
  }

  function bindEvents() {
    els.tonePreset.addEventListener('change', onPresetChange);
    els.systemPrompt.addEventListener('input', onSystemPromptInput);
    els.analyzeBtn.addEventListener('click', onAnalyzeSamples);
    els.sampleReplies.addEventListener('input', onSampleRepliesInput);
    if (els.sampleFile) els.sampleFile.addEventListener('change', onSampleFileSelected);
    if (els.downloadSampleXlsxBtn) {
      els.downloadSampleXlsxBtn.addEventListener('click', onDownloadSampleXlsxTemplate);
    }
    if (els.downloadSampleTxtBtn) {
      els.downloadSampleTxtBtn.addEventListener('click', onDownloadSampleTxtTemplate);
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
    markSampleLoaded,
    getSampleFlow: () => sampleFlow,
    setSampleFlowStatus,
  };
}
