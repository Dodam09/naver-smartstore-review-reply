importScripts(
  'config.js',
  'config.local.js',
  'lib/lookup-days.js',
  'lib/tone-presets.js',
  'lib/tone-profile.js',
  'lib/inquiry-reference.js',
  'lib/inquiry-search.js',
  'lib/reply-scrub.js',
  'lib/ai-proxy.js',
  'lib/analytics.js'
);

let isRunning = false;
let isInquiryRunning = false;
let stopRequested = false;
let inquiryStopRequested = false;
let abortController = null;
let inquiryAbortController = null;

function enableSidePanelOnActionClick() {
  if (!chrome.sidePanel?.setPanelBehavior) return;
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
    console.warn('사이드 패널 설정 실패:', err);
  });
}

enableSidePanelOnActionClick();
chrome.runtime.onInstalled.addListener(async (details) => {
  enableSidePanelOnActionClick();
  if (details.reason === 'install') {
    await trackAnalyticsEvent('install', { reason: 'install' });
  }
});

chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'BILLING_SUBSCRIPTION_UPDATED') return false;
  refreshAccountUsage({ force: true })
    .then(() => sendResponse({ ok: true }))
    .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
  return true;
});

async function notifyUsageLimit(message) {
  const summary = String(message || '이번 달 답글 생성 한도에 도달했습니다.')
    .split('\n')[0]
    .slice(0, 240);
  try {
    await chrome.notifications.create(`usage-limit-${Date.now()}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: '답글 생성 한도 도달',
      message: summary,
      priority: 2,
    });
  } catch (err) {
    console.warn('한도 알림 표시 실패:', err);
  }
}

async function notifyConfirmInquiryNeeded(count) {
  if (!count) return;
  try {
    await chrome.notifications.create(`confirm-inquiry-${Date.now()}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: '확인이 필요한 답글이 있어요',
      message: `반품·배송 등 ${count}건은 초안이 있으니 검토 탭에서 확인한 뒤 올려 주세요.`,
      priority: 2,
    });
  } catch (err) {
    console.warn('확인 필요 알림 표시 실패:', err);
  }
}

async function notifyManualInquiryNeeded(count) {
  if (!count) return;
  try {
    await chrome.notifications.create(`manual-inquiry-${Date.now()}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: '직접 작성할 문의가 있어요',
      message: `참고·지침이 없는 ${count}건은 AI가 쓰지 않았습니다. 검토 탭에서 직접 작성해 주세요.`,
      priority: 2,
    });
  } catch (err) {
    console.warn('직접 작성 알림 표시 실패:', err);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'FOCUS_STYLE_SETUP' || message.type === 'OPEN_WORK_AFTER_STYLE') {
    (async () => {
      const channel = message.channel === 'inquiry' ? 'inquiry' : 'review';
      const key = message.type === 'FOCUS_STYLE_SETUP' ? 'uxFocusStyle' : 'uxAfterStyle';
      try {
        await chrome.storage.local.set({ [key]: { channel, at: Date.now() } });
        let windowId = _sender.tab?.windowId;
        if (windowId == null) {
          const win = await chrome.windows.getCurrent();
          windowId = win?.id;
        }
        if (windowId != null) await chrome.sidePanel.open({ windowId });
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }

  if (message.type === 'OPEN_SIDE_PANEL') {
    (async () => {
      try {
        let windowId = _sender.tab?.windowId;
        if (windowId == null) {
          const win = await chrome.windows.getCurrent();
          windowId = win?.id;
        }
        if (windowId == null) throw new Error('창을 찾을 수 없습니다.');
        await chrome.sidePanel.open({ windowId });
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }

  if (message.type === 'BILLING_SUBSCRIPTION_UPDATED') {
    refreshAccountUsage({ force: true })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true;
  }

  if (message.type === 'KAKAO_LOGIN') {
    trackAnalyticsEvent('login_click', { provider: 'kakao' });
    startKakaoLoginFlow()
      .then(async (data) => {
        await trackAnalyticsEvent('login_success', { provider: 'kakao' });
        sendResponse({ ok: true, data });
      })
      .catch(async (err) => {
        await trackAnalyticsEvent('login_fail', { provider: 'kakao', error: String(err?.message || err).slice(0, 120) });
        sendResponse({ ok: false, error: err.message || String(err) });
      });
    return true;
  }

  if (message.type === 'TRACK_ANALYTICS') {
    const event = message.payload?.event;
    const meta = message.payload?.meta;
    trackAnalyticsEvent(event, meta)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === 'CANCEL_SUBSCRIPTION') {
    cancelSubscription()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }

  if (message.type === 'START_GENERATE') {
    if (isRunning) {
      sendResponse({ ok: false, error: '이미 답변 생성이 진행 중입니다.' });
      return false;
    }

    const rows = message.payload?.rows || [];
    if (!rows.length) {
      sendResponse({ ok: false, error: '처리할 리뷰가 없습니다.' });
      return false;
    }

    (async () => {
      try {
        const check = await ensureReplyGenerationAllowed(rows.length);
        if (!check.ok) {
          sendResponse({ ok: false, error: check.message });
          return;
        }

        isRunning = true;
        stopRequested = false;
        abortController = new AbortController();

        await patchJobProgress(CONFIG.PROGRESS_KEY, {
          status: 'running',
          total: rows.length,
          current: 0,
          success: 0,
          failed: 0,
          currentId: '',
          message: '답변 생성 준비 중...',
          startedAt: Date.now(),
          finishedAt: null,
          lastError: '',
        });

        runGenerate(message.payload)
          .catch(async (err) => {
            if (stopRequested || err?.name === 'AbortError') return;
            await updateProgress({
              status: 'error',
              message: `오류: ${err.message}`,
              lastError: err.message,
              finishedAt: Date.now(),
            });
          })
          .finally(() => {
            isRunning = false;
            stopRequested = false;
            abortController = null;
          });

        sendResponse({ ok: true, started: true });
      } catch (err) {
        isRunning = false;
        abortController = null;
        sendResponse({ ok: false, error: err.message || '시작 실패' });
      }
    })();

    return true;
  }

  if (message.type === 'STOP_GENERATE') {
    if (!isRunning) {
      sendResponse({ ok: false, error: '진행 중인 생성 작업이 없습니다.' });
      return false;
    }
    stopRequested = true;
    abortController?.abort();
    sendResponse({ ok: true, stopping: true });
    return false;
  }

  if (message.type === 'GET_JOB_STATUS') {
    chrome.storage.local.get([CONFIG.PROGRESS_KEY], async (data) => {
      let job = data[CONFIG.PROGRESS_KEY] || null;
      job = await healStaleJob(job, isRunning, CONFIG.PROGRESS_KEY);
      sendResponse({ ok: true, job, isRunning });
    });
    return true;
  }

  if (message.type === 'START_GENERATE_INQUIRIES') {
    if (isInquiryRunning) {
      sendResponse({ ok: false, error: '이미 문의 답변 생성이 진행 중입니다.' });
      return false;
    }

    const rows = message.payload?.rows || [];
    if (!rows.length) {
      sendResponse({ ok: false, error: '처리할 상품문의가 없습니다.' });
      return false;
    }

    const progressKey = CONFIG.INQUIRY_PROGRESS_KEY || 'smartstoreInquiryJobProgress';

    (async () => {
      try {
        const estimatedAiCount = rows.filter((row) => !isLogisticsInquiry(row)).length;
        const check = await ensureReplyGenerationAllowed(estimatedAiCount);
        if (!check.ok) {
          sendResponse({ ok: false, error: check.message });
          return;
        }

        isInquiryRunning = true;
        inquiryStopRequested = false;
        inquiryAbortController = new AbortController();

        await storageSet({
          [progressKey]: {
            status: 'running',
            total: rows.length,
            current: 0,
            success: 0,
            failed: 0,
            manual: 0,
            currentId: '',
            message: '답변 생성 준비 중...',
            startedAt: Date.now(),
            finishedAt: null,
            lastError: '',
            useReference: message.payload?.useReference !== false,
            referenceCount: 0,
            updatedAt: Date.now(),
          },
        });

        runGenerateInquiries(message.payload)
          .catch(async (err) => {
            if (inquiryStopRequested || err?.name === 'AbortError') return;
            await updateInquiryProgress({
              status: 'error',
              message: `오류: ${err.message}`,
              lastError: err.message,
              finishedAt: Date.now(),
            });
          })
          .finally(() => {
            isInquiryRunning = false;
            inquiryStopRequested = false;
            inquiryAbortController = null;
          });

        sendResponse({ ok: true, started: true });
      } catch (err) {
        isInquiryRunning = false;
        inquiryAbortController = null;
        sendResponse({ ok: false, error: err.message || '시작 실패' });
      }
    })();

    return true;
  }

  if (message.type === 'STOP_GENERATE_INQUIRIES') {
    if (!isInquiryRunning) {
      sendResponse({ ok: false, error: '진행 중인 문의 생성 작업이 없습니다.' });
      return false;
    }
    inquiryStopRequested = true;
    inquiryAbortController?.abort();
    sendResponse({ ok: true, stopping: true });
    return false;
  }

  if (message.type === 'GET_INQUIRY_JOB_STATUS') {
    const progressKey = CONFIG.INQUIRY_PROGRESS_KEY || 'smartstoreInquiryJobProgress';
    chrome.storage.local.get([progressKey], async (data) => {
      let job = data[progressKey] || null;
      job = await healStaleJob(job, isInquiryRunning, progressKey);
      sendResponse({ ok: true, job, isRunning: isInquiryRunning });
    });
    return true;
  }

  if (message.type === 'TEST_GENERATE_INQUIRY') {
    runTestInquiryReply(message.payload || {})
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }

  if (message.type === 'REGENERATE_INQUIRY_DRAFT') {
    regenerateInquiryDraftItem(message.payload || {})
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }

  if (message.type === 'ANALYZE_TONE_SAMPLES') {
    analyzeToneSamples(message.payload)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }

  if (message.type === 'FETCH_SELLER_SAMPLES_JOB') {
    runFetchSellerSamplesJob(message.payload || {})
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }

  if (message.type === 'FETCH_SELLER_REPLY_CATALOG_JOB') {
    const catalogDays = clampLookupDays(message.payload?.days, { min: 0, max: 730, fallback: 7 });
    relaySellerTabMessage(
      'FETCH_SELLER_REPLY_CATALOG',
      { ...(message.payload || {}), days: catalogDays },
      catalogFetchTimeoutMs(catalogDays)
    )
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }

  if (message.type === 'INQUIRY_CATALOG_PROGRESS') {
    chrome.runtime
      .sendMessage({ type: 'INQUIRY_CATALOG_PROGRESS_UI', payload: message.payload || {} })
      .catch(() => {});
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'FETCH_INQUIRY_REPLY_CATALOG_JOB') {
    runFetchInquiryReplyCatalogJob(message.payload || {}, sendResponse);
    return true;
  }

  if (message.type === 'RELAY_SELLER_TAB') {
    const { messageType, payload } = message.payload || {};
    relaySellerTabMessage(messageType, payload || {})
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }

  if (message.type === 'ANALYZE_TONE_SAMPLES_JOB') {
    runAnalyzeToneJob(message.payload || {})
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }

  if (message.type === 'DRAFT_KNOWLEDGE_FROM_INQUIRIES_JOB') {
    draftKnowledgeFromInquiries(message.payload || {})
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }
});

async function runGenerate(payload) {
  const { rows, apiKey, model } = payload;
  if (!rows?.length) throw new Error('처리할 리뷰가 없습니다.');
  await ensureAiCredentials(apiKey);

  const systemPrompt = String(payload.systemPrompt || '').trim();
  if (!systemPrompt || isLegacyBuiltinPrompt(systemPrompt)) {
    throw new Error(
      '답글 지침이 없습니다. 사이드 패널에서 기존 답글로 말투를 만든 뒤 다시 시도해 주세요.'
    );
  }

  isRunning = true;
  stopRequested = false;
  abortController = new AbortController();
  const signal = abortController.signal;
  const total = rows.length;
  let success = 0;
  let failed = 0;
  let lastError = '';

  const draftItems = [];

  await storageSet({ [CONFIG.APPLY_ENABLED_KEY]: false });
  await storageSet({ [CONFIG.STORAGE_KEY]: {} });

  await updateProgress({
    status: 'running',
    total,
    current: 0,
    success: 0,
    failed: 0,
    currentId: '',
    message: `답변 생성 시작 (0/${total})`,
    startedAt: Date.now(),
    finishedAt: null,
    lastError: '',
  });

  for (let i = 0; i < rows.length; i++) {
    if (stopRequested || signal.aborted) break;

    const row = rows[i];
    await updateProgress({
      status: 'running',
      total,
      current: i + 1,
      success,
      failed,
      currentId: row.id,
      message: `답변 생성 중 (${i + 1}/${total}) — 글번호 ${row.id}`,
      lastError,
    });

    try {
      const reply = await generateReply(apiKey, systemPrompt, row, model, signal);
      if (stopRequested || signal.aborted) break;

      draftItems.push({
        id: row.id,
        reviewContent: row.content,
        product: row.product || '',
        rating: row.rating || '',
        reviewType: row.reviewType || '',
        writer: row.writer || '',
        option: row.option || '',
        reply,
      });
      success++;
      await storageSet({
        [CONFIG.DRAFT_KEY]: {
          items: [...draftItems],
          updatedAt: Date.now(),
        },
      });

      if (stopRequested || signal.aborted) break;
      await sleep(400, signal);
    } catch (err) {
      if (stopRequested || signal.aborted || err.name === 'AbortError') break;
      failed++;
      lastError = err.message;
      if (isUsageLimitError(err)) {
        await notifyUsageLimit(lastError);
        break;
      }
      console.error(`글번호 ${row.id} 실패:`, err);
    }
  }

  if (stopRequested || signal.aborted) {
    const processed = success + failed;
    await updateProgress({
      status: 'stopped',
      total,
      current: processed,
      success,
      failed,
      currentId: '',
      lastError,
      message:
        `중지됨: 성공 ${success}건 저장됨 (전체 ${total}건 중 ${processed}건 처리).` +
        (failed > 0 ? ` 실패 ${failed}건.` : '') +
        '\n작업 화면의 「2. 답글 검토」 탭에서 확인·수정 후 일괄 확인하세요.',
      finishedAt: Date.now(),
    });
    isRunning = false;
    stopRequested = false;
    abortController = null;
    return;
  }

  if (isUsageLimitError({ message: lastError })) {
    const processed = success + failed;
    await updateProgress({
      status: 'limit_reached',
      total,
      current: processed,
      success,
      failed,
      currentId: '',
      lastError,
      message: formatUsageLimitMessage(lastError, success),
      finishedAt: Date.now(),
    });
    isRunning = false;
    stopRequested = false;
    abortController = null;
    return;
  }

  const errorHint =
    failed > 0 && success === 0 && lastError
      ? `\n\n원인: ${lastError}`
      : failed > 0 && lastError
        ? `\n\n최근 오류: ${lastError}`
        : '';

  await updateProgress({
    status: success > 0 ? 'done' : failed > 0 ? 'error' : 'done',
    total,
    current: total,
    success,
    failed,
    currentId: '',
    lastError,
    message:
      success > 0
        ? `완료: 성공 ${success}건, 실패 ${failed}건.${errorHint}\n` +
          `작업 화면 「2. 답글 검토」 탭에서 확인·수정 후 [일괄 확인]을 눌러주세요.`
        : `답글 생성 실패 (${failed}건).${errorHint}`,
    finishedAt: Date.now(),
  });

  isRunning = false;
  stopRequested = false;
  abortController = null;
}

function storeInquiryReplyKeys(map, rowId, reply) {
  const text = String(reply || '').trim();
  if (!text) return;
  const id = String(rowId);
  const norm = id.replace(/[^\d]/g, '');
  map[id] = text;
  if (norm) map[norm] = text;
}

async function runGenerateInquiries(payload) {
  let { rows, apiKey, systemPrompt, model, useReference, referenceDays, referenceSelectedIds } =
    payload;
  if (!rows?.length) throw new Error('처리할 상품문의가 없습니다.');
  await ensureAiCredentials(apiKey);

  systemPrompt = String(systemPrompt || '').trim();
  if (!systemPrompt || isLegacyBuiltinPrompt(systemPrompt)) {
    throw new Error(
      '응대 지침이 없습니다. 사이드 패널에서 기존 답글로 지침서를 만든 뒤 다시 시도해 주세요.'
    );
  }
  // 배송·재고 문의는 과거 답변 참고가 핵심이라 기본으로 켭니다.
  const shouldUseReference = useReference !== false;

  const storageKey = CONFIG.INQUIRY_STORAGE_KEY || 'smartstoreInquiryReplies';
  const applyKey = CONFIG.INQUIRY_APPLY_ENABLED_KEY || 'smartstoreInquiryApplyEnabled';
  const draftKey = CONFIG.INQUIRY_DRAFT_KEY || 'smartstoreInquiryDraft';
  const total = rows.length;
  const signal = inquiryAbortController?.signal;

  try {
    await updateInquiryProgress({
      status: 'running',
      total,
      current: 0,
      success: 0,
      failed: 0,
      manual: 0,
      currentId: '',
      message: '답변 생성 준비 중...',
      startedAt: Date.now(),
      finishedAt: null,
      lastError: '',
      useReference: shouldUseReference,
      referenceCount: 0,
    });

    let referenceCatalog = [];
    const settingsData = await storageGet([CONFIG.SETTINGS_KEY]);
    const settings = settingsData[CONFIG.SETTINGS_KEY] || {};
    const userGuidelines = normalizeUserInquiryGuidelines(settings.inquiryUserGuidelines);

    if (shouldUseReference) {
      try {
        await updateInquiryProgress({
          status: 'running',
          total,
          current: 0,
          success: 0,
          failed: 0,
          manual: 0,
          currentId: '',
          message: '참고 답변 불러오는 중...',
          useReference: true,
          referenceCount: 0,
        });
        referenceCatalog = await loadInquiryReferenceCatalog(referenceDays || 90);
        if (Array.isArray(referenceSelectedIds) && referenceSelectedIds.length) {
          const idSet = new Set(referenceSelectedIds.map(String));
          referenceCatalog = referenceCatalog.filter((item) => idSet.has(String(item.id)));
        }
      } catch (err) {
        console.warn('기존 문의 답변 참고 로드 실패:', err);
      }
    }
    referenceCatalog = mergeInquiryReferenceCatalog(referenceCatalog, userGuidelines);

    let success = 0;
    let failed = 0;
    let confirmCount = 0;
    let manualCount = 0;
    let lastError = '';
    const existingReplies = (await storageGet([storageKey]))[storageKey] || {};
    const replyMap = { ...existingReplies };
    const draftItems = [];

    await storageSet({ [applyKey]: false });

    for (const row of rows) {
      delete replyMap[String(row.id)];
      const norm = String(row.id).replace(/[^\d]/g, '');
      if (norm) delete replyMap[norm];
    }
    await storageSet({ [storageKey]: replyMap });

    await updateInquiryProgress({
      status: 'running',
      total,
      current: 0,
      success: 0,
      failed: 0,
      manual: 0,
      confirm: 0,
      currentId: '',
      message: `문의 답변 생성 시작 (0/${total})`,
      lastError: '',
      useReference: shouldUseReference,
      referenceCount: referenceCatalog.length,
    });

    for (let i = 0; i < rows.length; i++) {
      if (inquiryStopRequested || signal.aborted) break;

      const row = rows[i];
      const references = referenceCatalog.length
        ? pickInquiryReferencesForRow(row, referenceCatalog)
        : await loadInquiryReferencesForRow(row);

      await updateInquiryProgress({
        status: 'running',
        total,
        current: i + 1,
        success,
        failed,
        manual: manualCount,
        confirm: confirmCount,
        currentId: row.id,
        message: `문의 답변 생성 중 (${i + 1}/${total}) — 문의번호 ${row.id}`,
        lastError,
        useReference: shouldUseReference,
        referenceCount: referenceCatalog.length,
      });

      try {
        if (shouldDeferInquiryToManual(row, references, settings)) {
          draftItems.push({
            id: row.id,
            inquiryContent: row.content,
            product: row.product || '',
            productNo: String(row.productNo || '').replace(/[^\d]/g, ''),
            writer: row.writer || '',
            secret: !!row.secret,
            reply: '',
            aiReply: '',
            originalReply: '',
            needsManual: true,
            learnAsGuideline: true,
            needsConfirm: false,
            confirmReason: '',
            manualReason: getManualInquiryReason(row, references, settings),
            referenceIds: [],
            judgment: null,
            usedKnowledge: [],
            evidence: null,
            missingFields: [],
          });
          success++;
          manualCount++;

          await storageSet({
            [storageKey]: { ...replyMap },
            [draftKey]: {
              items: [...draftItems],
              updatedAt: Date.now(),
            },
          });
          continue;
        }

        const generated = await generateInquiryReply(
          apiKey,
          systemPrompt,
          row,
          model,
          signal,
          references
        );
        if (inquiryStopRequested || signal.aborted) break;

        const replyRaw = typeof generated === 'string' ? generated : generated?.text;
        const serverMeta = typeof generated === 'object' && generated?.fromServer ? generated : null;
        const knowledgeMeta = pickInquiryKnowledgeMeta(serverMeta);
        const confirm = serverMeta
          ? {
              needsManual: !!serverMeta.needsManual || !String(replyRaw || '').trim(),
              needsConfirm: !!serverMeta.needsConfirm,
              reason:
                serverMeta.reason ||
                serverMeta.evidence?.confirmReason ||
                (serverMeta.evidence?.missingFields || []).join(', ') ||
                '',
            }
          : evaluateInquiryReplyConfirm(row, replyRaw, references, [], systemPrompt);
        if (confirm.needsManual || !String(replyRaw || '').trim()) {
          draftItems.push({
            id: row.id,
            inquiryContent: row.content,
            product: row.product || '',
            productNo: String(row.productNo || '').replace(/[^\d]/g, ''),
            writer: row.writer || '',
            secret: !!row.secret,
            reply: '',
            aiReply: '',
            originalReply: '',
            needsManual: true,
            learnAsGuideline: true,
            needsConfirm: false,
            confirmReason: '',
            manualReason:
              confirm.reason ||
              '참고·확인된 사실에 없는 구체 내용을 지어내 직접 작성으로 넘겼습니다.',
            referenceIds: references.map((ref) => ref.id),
            evidence: knowledgeMeta.evidence,
            confirmationId: knowledgeMeta.confirmationId,
            judgment: knowledgeMeta.judgment,
            usedKnowledge: knowledgeMeta.usedKnowledge,
            missingFields: knowledgeMeta.missingFields,
          });
          success++;
          manualCount++;

          await storageSet({
            [storageKey]: { ...replyMap },
            [draftKey]: {
              items: [...draftItems],
              updatedAt: Date.now(),
            },
          });
          continue;
        }

        const reply = replyRaw;
        storeInquiryReplyKeys(replyMap, row.id, reply);
        draftItems.push({
          id: row.id,
          inquiryContent: row.content,
          product: row.product || '',
          productNo: String(row.productNo || '').replace(/[^\d]/g, ''),
          writer: row.writer || '',
          secret: !!row.secret,
          reply,
          aiReply: reply,
          originalReply: reply,
          needsManual: false,
          learnAsGuideline: false,
          needsConfirm: confirm.needsConfirm,
          confirmReason: confirm.reason,
          manualReason: '',
          referenceIds: references.map((ref) => ref.id),
          evidence: knowledgeMeta.evidence,
          confirmationId: knowledgeMeta.confirmationId,
          missingFields: knowledgeMeta.missingFields,
          judgment: knowledgeMeta.judgment,
          usedKnowledge: knowledgeMeta.usedKnowledge,
        });
        success++;
        if (confirm.needsConfirm) confirmCount++;

        await storageSet({
          [storageKey]: { ...replyMap },
          [draftKey]: {
            items: [...draftItems],
            updatedAt: Date.now(),
          },
        });

        if (inquiryStopRequested || signal.aborted) break;
        await sleep(400, signal);
      } catch (err) {
        if (inquiryStopRequested || signal.aborted || err.name === 'AbortError') break;
        failed++;
        lastError = err.message;
        if (isUsageLimitError(err)) {
          await notifyUsageLimit(lastError);
          break;
        }
        console.error(`문의번호 ${row.id} 실패:`, err);
      }
    }

    if (inquiryStopRequested || signal.aborted) {
      const processed = success + failed;
      await updateInquiryProgress({
        status: 'stopped',
        total,
        current: processed,
        success,
        failed,
        manual: manualCount,
        confirm: confirmCount,
        currentId: '',
        lastError,
        message:
          `중지됨: AI ${success - manualCount}건` +
          (manualCount > 0 ? `, 직접 작성 ${manualCount}건` : '') +
          (confirmCount > 0 ? `, 확인 필요 ${confirmCount}건` : '') +
          ` 저장됨 (전체 ${total}건 중 ${processed}건 처리).` +
          (failed > 0 ? ` 실패 ${failed}건.` : '') +
          '\n작업 화면 「2. 답글 검토」 탭에서 확인·수정 후 자동 입력을 활성화하세요.',
        finishedAt: Date.now(),
      });
      if (manualCount > 0) await notifyManualInquiryNeeded(manualCount);
      if (confirmCount > 0) await notifyConfirmInquiryNeeded(confirmCount);
      return;
    }

    if (isUsageLimitError({ message: lastError })) {
      const processed = success + failed;
      await updateInquiryProgress({
        status: 'limit_reached',
        total,
        current: processed,
        success,
        failed,
        manual: manualCount,
        confirm: confirmCount,
        currentId: '',
        lastError,
        message: formatUsageLimitMessage(lastError, success),
        finishedAt: Date.now(),
      });
      if (manualCount > 0) await notifyManualInquiryNeeded(manualCount);
      if (confirmCount > 0) await notifyConfirmInquiryNeeded(confirmCount);
      return;
    }

    const errorHint =
      failed > 0 && success === 0 && lastError
        ? `\n\n원인: ${lastError}`
        : failed > 0 && lastError
          ? `\n\n최근 오류: ${lastError}`
          : '';

    const aiCount = Math.max(0, success - manualCount);
    const doneOk = success > 0;
    await updateInquiryProgress({
      status: doneOk ? 'done' : 'error',
      total,
      current: total,
      success,
      failed,
      manual: manualCount,
      confirm: confirmCount,
      currentId: '',
      lastError,
      message: doneOk
        ? `완료: AI ${aiCount}건` +
          (manualCount > 0 ? `, 직접 작성 ${manualCount}건` : '') +
          (confirmCount > 0 ? `, 확인 필요 ${confirmCount}건` : '') +
          (failed > 0 ? `, 실패 ${failed}건` : '') +
          `.${errorHint}\n` +
          (manualCount > 0
            ? `참고·지침이 없는 ${manualCount}건은 「2. 답글 검토」에서 직접 작성해 주세요. 작성한 답글은 다음 문의 지침으로 저장됩니다.`
            : confirmCount > 0
              ? `반품·배송 등 ${confirmCount}건은 「2. 답글 검토」에서 확인한 뒤 올려 주세요.`
              : `작업 화면 「2. 답글 검토」 탭에서 확인·수정 후 [자동 입력 모드]를 눌러주세요.`)
        : `답변 생성 실패 (${failed}건).${errorHint}`,
      finishedAt: Date.now(),
    });
    if (manualCount > 0) await notifyManualInquiryNeeded(manualCount);
    if (confirmCount > 0) await notifyConfirmInquiryNeeded(confirmCount);
  } catch (err) {
    if (!inquiryStopRequested && err.name !== 'AbortError') {
      await updateInquiryProgress({
        status: 'error',
        message: `오류: ${err.message}`,
        lastError: err.message,
        finishedAt: Date.now(),
      });
    }
    throw err;
  }
}

function getDefaultInquirySystemPrompt() {
  return '';
}


function splitInquirySampleAnswers(text) {
  return String(text || '')
    .split(/\n\s*---\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8)
    .slice(0, 20);
}

async function loadInquiryReferencesForRow(row) {
  const cacheKey = CONFIG.INQUIRY_REFERENCE_CACHE_KEY || 'smartstoreInquiryReferenceCache';
  const data = await storageGet([cacheKey, CONFIG.SETTINGS_KEY]);
  const settings = data[CONFIG.SETTINGS_KEY] || {};
  const userGuidelines = normalizeUserInquiryGuidelines(settings.inquiryUserGuidelines);
  const catalog = mergeInquiryReferenceCatalog(data[cacheKey]?.catalog || [], userGuidelines);
  if (catalog.length) {
    const fromCatalog = pickInquiryReferencesForRow(row, catalog);
    if (fromCatalog.length) return fromCatalog;
  }

  const sampleText = settings.inquirySampleReplies || '';
  const answers = splitInquirySampleAnswers(sampleText);
  if (!answers.length) return [];
  return pickInquiryReferencesFromAnswers(row, answers, 4);
}

async function loadInquiryReferenceCatalog(days) {
  const lookupDays = clampLookupDays(days, { min: 0, max: 365, fallback: 7 });
  const cacheKey = CONFIG.INQUIRY_REFERENCE_CACHE_KEY || 'smartstoreInquiryReferenceCache';
  const data = await storageGet([cacheKey]);
  const cache = data[cacheKey];
  const maxAgeMs = 60 * 60 * 1000;

  if (
    cache?.catalog?.length &&
    cache.fetchedAt &&
    Date.now() - cache.fetchedAt < maxAgeMs &&
    (cache.days ?? 0) >= lookupDays
  ) {
    return cache.catalog;
  }

  const response = await relayInquiryTabMessage(
    'FETCH_INQUIRY_REPLY_CATALOG',
    { days: lookupDays, maxItems: 80 },
    resolveCatalogTimeoutMs(lookupDays)
  );

  const catalog = response.catalog || [];
  const validIds = new Set(catalog.map((item) => String(item.id)));
  const keptSelected = (cache?.selectedIds || []).map(String).filter((id) => validIds.has(id));
  const selectedIds = keptSelected.length
    ? keptSelected
    : catalog.map((item) => String(item.id));

  await storageSet({
    [cacheKey]: {
      catalog,
      selectedIds,
      fetchedAt: Date.now(),
      days: lookupDays,
      withAnswerCount: catalog.length,
    },
  });
  return catalog;
}

async function analyzeToneSamples(payload) {
  const { apiKey, samples, model, context = 'review' } = payload;
  await ensureAiCredentials(apiKey);

  if (useAiProxy()) {
    const data = await postAiApi('/api/analyze-tone', {
      samples,
      pairs: payload.pairs || [],
      context,
      model: model || CONFIG.GEMINI_MODEL,
      previousToneProfile: payload.previousToneProfile || null,
    });
    return {
      prompt: data.prompt,
      toneProfile: data.toneProfile || null,
      usedFallback: !!data.usedFallback,
      fallbackReason: data.fallbackReason || '',
      sampleCount: data.sampleCount,
    };
  }

  throw new Error(
    '확장에서 Gemini를 직접 호출할 수 없습니다. API_BASE_URL 서버 프록시를 설정하세요.'
  );
}

async function draftKnowledgeFromInquiries(payload) {
  const { apiKey, pairs, model } = payload || {};
  await ensureAiCredentials(apiKey);

  if (!useAiProxy()) {
    throw new Error(
      '확장에서 Gemini를 직접 호출할 수 없습니다. API_BASE_URL 서버 프록시를 설정하세요.'
    );
  }

  const data = await postAiApi('/api/knowledge/draft-from-inquiries', {
    pairs: pairs || [],
    model: model || CONFIG.GEMINI_MODEL,
  });

  return {
    draft: data.draft || { products: [], policies: {}, warnings: [] },
    sampleCount: data.sampleCount || 0,
    parseFailed: !!data.parseFailed,
  };
}

function normalizeAnalysisSamples(samples) {
  return normalizeSamples(samples);
}

async function callGeminiText(_apiKey, _userText, _model, _options = {}) {
  // 클라이언트 직접 호출 금지 — 서버 프록시(/api/*)만 사용
  throw new Error(
    '확장에서 Gemini를 직접 호출할 수 없습니다. API_BASE_URL 서버 프록시를 설정하세요.'
  );
}

async function generateReply(apiKey, systemPrompt, row, model, signal) {
  if (useAiProxy()) {
    const data = await postAiApi(
      '/api/generate-reply',
      {
        channel: 'review',
        systemPrompt,
        row,
        model: model || CONFIG.GEMINI_MODEL,
      },
      signal
    );
    await trackAnalyticsEvent('generate_success', { channel: 'review' });
    return scrubGeneratedReply(data.text);
  }

  throw new Error(
    '확장에서 Gemini를 직접 호출할 수 없습니다. API_BASE_URL 서버 프록시를 설정하세요.'
  );
}

function pickInquiryKnowledgeMeta(serverMeta) {
  if (!serverMeta || typeof serverMeta !== 'object') {
    return {
      judgment: null,
      usedKnowledge: [],
      evidence: null,
      missingFields: [],
      confirmationId: null,
    };
  }
  const evidence = serverMeta.evidence || null;
  const usedKnowledge = Array.isArray(serverMeta.usedKnowledge)
    ? serverMeta.usedKnowledge
    : Array.isArray(evidence?.usedKnowledge)
      ? evidence.usedKnowledge
      : [];
  return {
    judgment: serverMeta.judgment || evidence?.judgment || null,
    usedKnowledge,
    evidence,
    missingFields: Array.isArray(evidence?.missingFields)
      ? evidence.missingFields
      : Array.isArray(serverMeta.missingFields)
        ? serverMeta.missingFields
        : [],
    confirmationId: serverMeta.confirmation?.id || serverMeta.confirmationId || null,
  };
}

async function regenerateInquiryDraftItem(payload = {}) {
  const draftKey = CONFIG.INQUIRY_DRAFT_KEY || 'smartstoreInquiryDraft';
  const storageKey = CONFIG.INQUIRY_STORAGE_KEY || 'smartstoreInquiryReplies';
  const applyKey = CONFIG.INQUIRY_APPLY_ENABLED_KEY || 'smartstoreInquiryApplyEnabled';
  const id = String(payload.id || '').trim();
  if (!id) throw new Error('문의 번호가 없습니다.');

  const data = await storageGet([draftKey, storageKey, CONFIG.SETTINGS_KEY]);
  const draft = data[draftKey] || { items: [] };
  const items = Array.isArray(draft.items) ? [...draft.items] : [];
  const index = items.findIndex((item) => String(item.id) === id);
  if (index < 0) throw new Error('해당 문의 초안을 찾을 수 없습니다.');

  const current = items[index];
  const settings = data[CONFIG.SETTINGS_KEY] || {};
  const apiKey = payload.apiKey || settings.apiKey || '';
  await ensureAiCredentials(apiKey);

  const systemPrompt = String(payload.systemPrompt || '').trim();
  if (!systemPrompt || isLegacyBuiltinPrompt(systemPrompt)) {
    throw new Error(
      '응대 지침이 없습니다. 「답변 스타일 설정」에서 기존 답글로 지침서를 먼저 만들어 주세요.'
    );
  }

  const row = {
    id: current.id,
    content: current.inquiryContent || '',
    product: current.product || '',
    productNo: String(current.productNo || payload.productNo || '').replace(/[^\d]/g, ''),
    secret: !!current.secret,
    writer: current.writer || '',
  };
  if (!String(row.content || '').trim()) throw new Error('문의 내용이 없습니다.');

  const check = await ensureReplyGenerationAllowed(1);
  if (!check.ok) throw new Error(check.message);

  let references = [];
  try {
    references = await loadInquiryReferencesForRow(row);
  } catch (_) {
    references = [];
  }

  const generated = await generateInquiryReply(
    apiKey,
    systemPrompt,
    row,
    payload.model || CONFIG.GEMINI_MODEL,
    null,
    references
  );
  const text = typeof generated === 'string' ? generated : generated?.text;
  const serverMeta = typeof generated === 'object' && generated ? generated : null;
  const knowledgeMeta = pickInquiryKnowledgeMeta(serverMeta);
  const session = await loadAuthSession();

  let nextItem;
  if (serverMeta?.fromServer) {
    const needsManual = !!serverMeta.needsManual || !String(text || '').trim();
    if (needsManual) {
      nextItem = {
        ...current,
        productNo: row.productNo,
        reply: '',
        aiReply: '',
        originalReply: '',
        needsManual: true,
        learnAsGuideline: true,
        needsConfirm: false,
        confirmReason: '',
        manualReason: serverMeta.reason || '답글을 만들지 못했습니다.',
        judgment: knowledgeMeta.judgment,
        usedKnowledge: knowledgeMeta.usedKnowledge,
        evidence: knowledgeMeta.evidence,
        missingFields: knowledgeMeta.missingFields,
        confirmationId: knowledgeMeta.confirmationId,
        referenceIds: references.map((ref) => ref.id),
      };
    } else {
      nextItem = {
        ...current,
        productNo: row.productNo,
        reply: text,
        aiReply: text,
        originalReply: text,
        needsManual: false,
        learnAsGuideline: false,
        needsConfirm: !!serverMeta.needsConfirm,
        confirmReason:
          serverMeta.reason ||
          serverMeta.evidence?.confirmReason ||
          (serverMeta.evidence?.missingFields || []).join(', ') ||
          '',
        manualReason: '',
        judgment: knowledgeMeta.judgment,
        usedKnowledge: knowledgeMeta.usedKnowledge,
        evidence: knowledgeMeta.evidence,
        missingFields: knowledgeMeta.missingFields,
        confirmationId: knowledgeMeta.confirmationId,
        referenceIds: references.map((ref) => ref.id),
      };
    }
  } else {
    const confirm = evaluateInquiryReplyConfirm(row, text, references, [], systemPrompt);
    if (confirm.needsManual || !String(text || '').trim()) {
      nextItem = {
        ...current,
        productNo: row.productNo,
        reply: '',
        aiReply: '',
        originalReply: '',
        needsManual: true,
        learnAsGuideline: true,
        needsConfirm: false,
        confirmReason: '',
        manualReason:
          confirm.reason ||
          '참고·확인된 사실에 없는 구체 내용을 지어내 직접 작성으로 넘겼습니다.',
        judgment: null,
        usedKnowledge: [],
        evidence: null,
        missingFields: [],
        confirmationId: null,
        referenceIds: references.map((ref) => ref.id),
      };
    } else {
      nextItem = {
        ...current,
        productNo: row.productNo,
        reply: text,
        aiReply: text,
        originalReply: text,
        needsManual: false,
        learnAsGuideline: false,
        needsConfirm: confirm.needsConfirm,
        confirmReason: confirm.reason,
        manualReason: '',
        judgment: null,
        usedKnowledge: [],
        evidence: null,
        missingFields: [],
        confirmationId: null,
        referenceIds: references.map((ref) => ref.id),
      };
    }
  }

  items[index] = nextItem;
  const replyMap = { ...(data[storageKey] || {}) };
  if (nextItem.reply) storeInquiryReplyKeys(replyMap, nextItem.id, nextItem.reply);
  else {
    delete replyMap[String(nextItem.id)];
    const norm = String(nextItem.id).replace(/[^\d]/g, '');
    if (norm) delete replyMap[norm];
  }

  await storageSet({
    [draftKey]: { items, updatedAt: Date.now() },
    [storageKey]: replyMap,
    [applyKey]: false,
  });

  return {
    item: nextItem,
    usage: session?.usage || check.usage || null,
    judgment: nextItem.judgment || null,
    usedKnowledge: nextItem.usedKnowledge || [],
  };
}

async function runTestInquiryReply(payload = {}) {
  const content = String(payload.content || '').trim();
  if (!content) throw new Error('테스트 문의를 입력해 주세요.');

  const apiKey = payload.apiKey;
  await ensureAiCredentials(apiKey);

  const row = {
    id: 'test',
    content,
    product: String(payload.product || '').trim(),
    productNo: String(payload.productNo || '').replace(/[^\d]/g, ''),
    secret: false,
  };
  const systemPrompt = String(payload.systemPrompt || '').trim();
  if (!systemPrompt || isLegacyBuiltinPrompt(systemPrompt)) {
    throw new Error(
      '응대 지침이 없습니다. 「답변 스타일 설정」에서 기존 답글로 지침서를 먼저 만들어 주세요.'
    );
  }

  let references = [];
  try {
    references = await loadInquiryReferencesForRow(row);
  } catch (_) {}

  if (!references.length) {
    const err = new Error(
      '테스트는 기존 판매자 답변을 1건 이상 참고해야 합니다. 「응대 지침서 만들기」에서 문의 답변을 먼저 불러오거나, 비슷한 과거 답변이 있는 문의로 다시 시도해 주세요.'
    );
    err.code = 'NO_REFERENCE';
    err.referenceCount = 0;
    throw err;
  }

  const check = await ensureReplyGenerationAllowed(1);
  if (!check.ok) throw new Error(check.message);

  const generated = await generateInquiryReply(
    apiKey,
    systemPrompt,
    row,
    payload.model || CONFIG.GEMINI_MODEL,
    null,
    references
  );
  const text = typeof generated === 'string' ? generated : generated?.text;
  const serverMeta = typeof generated === 'object' && generated ? generated : null;

  const session = await loadAuthSession();
  if (serverMeta?.fromServer) {
    const needsManual = serverMeta.needsManual || !String(text || '').trim();
    if (needsManual) {
      return {
        deferred: true,
        needsManual: true,
        needsConfirm: false,
        reason: serverMeta.reason || '답글을 만들지 못했습니다.',
        text: '',
        usage: session?.usage || check.usage || null,
        referenceCount: references.length,
        evidence: serverMeta.evidence || null,
        confirmation: serverMeta.confirmation || null,
      };
    }
    return {
      deferred: false,
      needsManual: false,
      needsConfirm: !!serverMeta.needsConfirm,
      reason:
        serverMeta.reason ||
        serverMeta.evidence?.confirmReason ||
        (serverMeta.evidence?.missingFields || []).join(', ') ||
        '',
      text,
      usage: session?.usage || check.usage || null,
      referenceCount: references.length,
      evidence: serverMeta.evidence || null,
      confirmation: serverMeta.confirmation || null,
      judgment: serverMeta.judgment || serverMeta.evidence?.judgment || null,
      usedKnowledge: serverMeta.usedKnowledge || [],
    };
  }

  const confirm = evaluateInquiryReplyConfirm(row, text, references, [], systemPrompt);
  if (confirm.needsManual || !String(text || '').trim()) {
    return {
      deferred: true,
      needsManual: true,
      needsConfirm: false,
      reason:
        confirm.reason ||
        '참고·확인된 사실에 없는 구체 내용을 지어내 직접 작성으로 넘겼습니다.',
      text: '',
      usage: session?.usage || check.usage || null,
      referenceCount: references.length,
    };
  }
  return {
    deferred: false,
    needsManual: false,
    needsConfirm: confirm.needsConfirm,
    reason: confirm.reason,
    text,
    usage: session?.usage || check.usage || null,
    referenceCount: references.length,
  };
}

async function generateInquiryReply(apiKey, systemPrompt, row, model, signal, references = []) {
  if (useAiProxy()) {
    const data = await postAiApi(
      '/api/generate-reply',
      {
        channel: 'inquiry',
        systemPrompt,
        row,
        references,
        model: model || CONFIG.GEMINI_MODEL,
      },
      signal
    );
    await trackAnalyticsEvent('generate_success', { channel: 'inquiry' });
    return {
      fromServer: true,
      text: scrubGeneratedReply(data.text),
      needsConfirm: !!data.needsConfirm,
      reason: data.evidence?.confirmReason || '',
      evidence: data.evidence || null,
      confirmation: data.confirmation || null,
      judgment: data.judgment || data.evidence?.judgment || null,
      usedKnowledge: data.usedKnowledge || [],
      needsManual: false,
    };
  }

  throw new Error(
    '확장에서 Gemini를 직접 호출할 수 없습니다. API_BASE_URL 서버 프록시를 설정하세요.'
  );
}

async function groundInquiryReplyText(_apiKey, row, draft, references, verifiedFacts, _model, _signal, guidelines = '') {
  // 클라이언트 직접 Gemini 호출 제거 — 서버 프록시 경로만 사용
  const reply = String(draft || '').trim();
  if (!reply) return '';
  const grounding = assessInquiryReplyGrounding(row, reply, references, verifiedFacts, guidelines);
  return grounding.grounded ? reply : '';
}

function normalizeReviewId(id) {
  return String(id).replace(/[^\d]/g, '');
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    if (!signal) return;
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true }
    );
  });
}

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(data) {
  return new Promise((resolve) => chrome.storage.local.set(data, resolve));
}

async function patchJobProgress(storageKey, progress) {
  const data = await storageGet([storageKey]);
  const prev = data[storageKey] || {};
  const next = {
    ...prev,
    ...progress,
    updatedAt: Date.now(),
  };
  if (next.status === 'running') {
    next.startedAt = progress.startedAt ?? prev.startedAt ?? Date.now();
    if (!('finishedAt' in progress)) next.finishedAt = null;
  }
  await storageSet({ [storageKey]: next });
  return next;
}

async function updateProgress(progress) {
  await patchJobProgress(CONFIG.PROGRESS_KEY, progress);
}

async function updateInquiryProgress(progress) {
  await patchJobProgress(CONFIG.INQUIRY_PROGRESS_KEY || 'smartstoreInquiryJobProgress', progress);
}

function emptySampleFlow() {
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

const STALE_JOB_MS = 5 * 60 * 1000;
const STALE_SAMPLE_FLOW_MS = 45 * 1000;

async function healStaleJob(job, activelyRunning, storageKey) {
  if (!job || job.status !== 'running') return job;

  const lastBeat = job.updatedAt || job.startedAt || 0;
  if (activelyRunning && !lastBeat) return job;

  const idleMs = lastBeat ? Date.now() - lastBeat : STALE_JOB_MS + 1;
  const isInquiryJob =
    storageKey === (CONFIG.INQUIRY_PROGRESS_KEY || 'smartstoreInquiryJobProgress');

  if (activelyRunning) {
    if (idleMs <= STALE_JOB_MS) return job;
    if (isInquiryJob) {
      inquiryStopRequested = true;
      inquiryAbortController?.abort();
    } else {
      stopRequested = true;
      abortController?.abort();
    }
  }

  const healed = {
    ...job,
    status: 'error',
    message: activelyRunning
      ? '생성 작업 시간이 초과되었습니다. 다시 시도해 주세요.'
      : '생성 작업이 중단되었습니다. 다시 시도해 주세요.',
    finishedAt: Date.now(),
  };
  await storageSet({ [storageKey]: healed });
  return healed;
}

async function healStaleSampleFlows() {
  const data = await storageGet([CONFIG.SETTINGS_KEY]);
  const settings = data[CONFIG.SETTINGS_KEY];
  if (!settings) return;

  const now = Date.now();
  let changed = false;
  const next = { ...settings };

  for (const flowKey of ['sampleFlow', 'inquirySampleFlow']) {
    const flow = settings[flowKey];
    if (!flow) continue;
    const patched = { ...emptySampleFlow(), ...flow };
    let flowChanged = false;

    if (patched.fetching) {
      const started = patched.fetchStartedAt || 0;
      if (!started || now - started > STALE_SAMPLE_FLOW_MS) {
        patched.fetching = false;
        patched.fetchStartedAt = null;
        if (!patched.lastError) {
          patched.lastError = '가져오기가 중단되었습니다. 다시 시도해 주세요.';
          patched.lastErrorAt = now;
        }
        flowChanged = true;
      }
    }

    if (patched.analyzing) {
      const started = patched.analyzeStartedAt || 0;
      if (!started || now - started > STALE_SAMPLE_FLOW_MS) {
        patched.analyzing = false;
        patched.analyzeStartedAt = null;
        if (!patched.lastError) {
          patched.lastError = '분석이 중단되었습니다. 다시 시도해 주세요.';
          patched.lastErrorAt = now;
        }
        flowChanged = true;
      }
    }

    if (flowChanged) {
      next[flowKey] = patched;
      changed = true;
    }
  }

  if (changed) {
    await storageSet({ [CONFIG.SETTINGS_KEY]: next });
  }
}

healStaleSampleFlows();

async function patchSampleFlow(flowPatch, sampleReplies) {
  const data = await storageGet([CONFIG.SETTINGS_KEY]);
  const settings = data[CONFIG.SETTINGS_KEY] || {};
  const sampleFlow = { ...emptySampleFlow(), ...(settings.sampleFlow || {}), ...flowPatch };
  await storageSet({
    [CONFIG.SETTINGS_KEY]: {
      ...settings,
      sampleFlow,
      ...(sampleReplies != null ? { sampleReplies } : {}),
    },
  });
}

function formatSampleFetchError(message) {
  const msg = String(message || '가져오기 실패');
  if (/Cannot access contents of the page|must request permission to access the respective host/i.test(msg)) {
    return (
      '판매자센터 페이지 접근 권한이 없습니다.\n\n' +
      '1. chrome://extensions → 이 확장 [세부정보]\n' +
      '2. [사이트 액세스]를 "모든 사이트에서" 또는 sell.smartstore.naver.com 허용\n' +
      '3. https://sell.smartstore.naver.com 상품문의/리뷰 탭을 연 뒤 F5\n' +
      '4. 확장 새로고침 후 다시 시도'
    );
  }
  if (/Receiving end does not exist|Could not establish connection/i.test(msg)) {
    return (
      '판매자센터 페이지와 연결되지 않았습니다.\n\n' +
      '1. [리뷰 관리] 또는 [상품문의] 페이지(sell.smartstore.naver.com)에서 F5\n' +
      '2. chrome://extensions 에서 확장 프로그램 [새로고침]\n' +
      '3. 다시 시도'
    );
  }
  return msg;
}

const SELLER_TAB_URLS = [
  'https://sell.smartstore.naver.com/*',
  'https://sell.storefarm.naver.com/*',
  'https://sell.shop.naver.com/*',
];
const SELLER_TAB_URL = SELLER_TAB_URLS[0];
const SELLER_HOST_RE =
  /^https:\/\/sell\.(?:smartstore|storefarm|shop)\.naver\.com\//i;
const INQUIRY_CONTENT_SCRIPT_FILES = ['config.js', 'config.local.js', 'content-inquiry-import.js'];
const SELLER_CONTENT_SCRIPT_FILES = [
  'config.js',
  'config.local.js',
  'content.js',
  'content-import.js',
  'content-submit.js',
  'content-inquiry-import.js',
  'content-inquiry-fill.js',
];

function resolveCatalogTimeoutMs(days) {
  const clamped = clampLookupDays(days, { min: 0, max: 730, fallback: 7 });
  if (clamped <= 1) return 90000;
  return catalogFetchTimeoutMs(clamped);
}

function runFetchInquiryReplyCatalogJob(payload, sendResponse) {
  (async () => {
    try {
      const catalogDays = clampLookupDays(payload?.days, { min: 0, max: 365, fallback: 7 });
      const result = await relayInquiryTabMessage(
        'FETCH_INQUIRY_REPLY_CATALOG',
        { ...payload, days: catalogDays },
        resolveCatalogTimeoutMs(catalogDays)
      );
      const cacheKey = CONFIG.INQUIRY_REFERENCE_CACHE_KEY || 'smartstoreInquiryReferenceCache';
      const existingData = await storageGet([cacheKey]);
      const prevCache = existingData[cacheKey];
      const catalog = result.catalog || [];
      const validIds = new Set(catalog.map((item) => String(item.id)));
      const keptSelected = (prevCache?.selectedIds || [])
        .map(String)
        .filter((id) => validIds.has(id));
      const selectedIds = keptSelected.length
        ? keptSelected
        : catalog.map((item) => String(item.id));

      await storageSet({
        [cacheKey]: {
          catalog,
          selectedIds,
          fetchedAt: Date.now(),
          days: result.days ?? catalogDays,
          withAnswerCount: result.withAnswerCount || catalog.length || 0,
        },
      });
      sendResponse({ ok: true, ...result, selectedIds });
    } catch (err) {
      sendResponse({ ok: false, error: err.message || String(err) });
    }
  })();
}

function scoreSellerTab(tab) {
  const url = String(tab.url || '');
  let score = 0;
  if (/review/i.test(url)) score += 20;
  if (/comment|inquir|contents/i.test(url)) score += 18;
  if (/sell\.smartstore\.naver\.com/i.test(url)) score += 5;
  if (/sell\.(?:storefarm|shop)\.naver\.com/i.test(url)) score += 3;
  if (tab.active) score += 3;
  return score;
}

async function getSellerTab() {
  const tabs = await chrome.tabs.query({ url: SELLER_TAB_URLS });
  const usable = (tabs || []).filter((tab) => SELLER_HOST_RE.test(String(tab.url || '')));
  if (!usable.length) {
    throw new Error(
      'NO_SELLER_TAB\n판매자센터 리뷰·문의 페이지가 열려 있지 않습니다. https://sell.smartstore.naver.com 을 연 뒤 다시 가져오기를 누르세요.'
    );
  }
  return usable.slice().sort((a, b) => scoreSellerTab(b) - scoreSellerTab(a))[0];
}

async function assertSellerTabInjectable(tab) {
  const fresh = tab?.id != null ? await chrome.tabs.get(tab.id).catch(() => tab) : tab;
  const url = String(fresh?.url || '');
  if (!SELLER_HOST_RE.test(url)) {
    throw new Error(
      formatSampleFetchError(
        `Cannot access contents of the page. Extension manifest must request permission to access the respective host.\n현재 탭: ${url || '(없음)'}`
      )
    );
  }
  return fresh;
}

function pingInquiryTab(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: 'SS_INQUIRY_PING' }, (response) => {
      resolve(!chrome.runtime.lastError && response?.ok === true);
    });
  });
}

async function injectInquiryContentScripts(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      files: INQUIRY_CONTENT_SCRIPT_FILES,
    });
  } catch (err) {
    throw new Error(formatSampleFetchError(String(err.message || err)));
  }
}

async function ensureInquiryTabReady(tabId) {
  if (await pingInquiryTab(tabId)) return;

  try {
    await injectInquiryContentScripts(tabId);
  } catch (err) {
    throw new Error(formatSampleFetchError(String(err.message || err)));
  }

  await sleep(300);
  if (await pingInquiryTab(tabId)) return;

  throw new Error(
    formatSampleFetchError(
      'Could not establish connection.\n상품문의 페이지에서 F5 후 chrome://extensions 새로고침을 해 주세요.'
    )
  );
}

function sendTabMessage(tabId, messageType, payload, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('판매자센터 응답 시간이 초과되었습니다.\n상품문의 페이지를 새로고침(F5)한 뒤 다시 시도하세요.'));
    }, Math.max(timeoutMs, 30000));

    chrome.tabs.sendMessage(tabId, { type: messageType, payload }, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (chrome.runtime.lastError) {
        reject(new Error(formatSampleFetchError(chrome.runtime.lastError.message)));
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

async function relayInquiryTabMessage(messageType, payload, timeoutMs = 90000) {
  const tab = await assertSellerTabInjectable(await getSellerTab());
  await ensureInquiryTabReady(tab.id);
  return sendTabMessage(tab.id, messageType, payload, timeoutMs);
}

function pingSellerTab(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: 'SS_REVIEW_PING' }, (response) => {
      resolve(!chrome.runtime.lastError && response?.ok === true);
    });
  });
}

async function injectSellerContentScripts(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      files: SELLER_CONTENT_SCRIPT_FILES,
    });
  } catch (err) {
    throw new Error(formatSampleFetchError(String(err.message || err)));
  }
}

async function ensureSellerTabReady(tabId) {
  if (await pingSellerTab(tabId)) return;

  try {
    await injectSellerContentScripts(tabId);
  } catch (err) {
    throw new Error(formatSampleFetchError(String(err.message || err)));
  }

  await sleep(200);
  if (await pingSellerTab(tabId)) return;

  throw new Error(formatSampleFetchError('Could not establish connection'));
}

function catalogFetchTimeoutMs(days) {
  if (days >= 365) return 240000;
  if (days >= 180) return 180000;
  return 120000;
}

async function relaySellerTabMessage(messageType, payload, timeoutMs = 90000) {
  const tab = await assertSellerTabInjectable(await getSellerTab());
  await ensureSellerTabReady(tab.id);
  return sendTabMessage(tab.id, messageType, payload, timeoutMs);
}

async function runFetchSellerSamplesJob(payload) {
  const days = clampLookupDays(payload.days, { min: 0, max: 730, fallback: 7 });
  const maxSamples = Math.max(2, Math.min(20, Number(payload.maxSamples) || 15));

  await patchSampleFlow({
    fetching: true,
    fetchStartedAt: Date.now(),
    analyzing: false,
    lastError: '',
    lastErrorAt: null,
  });

  try {
    const response = await relaySellerTabMessage(
      'FETCH_SELLER_REPLY_SAMPLES',
      { days, maxSamples },
      catalogFetchTimeoutMs(days)
    );
    const sampleText = (response.samples || []).join('\n\n---\n\n');

    await patchSampleFlow(
      {
        fetching: false,
        fetchStartedAt: null,
        lastError: '',
        lastErrorAt: null,
        source: 'seller',
        sourceLabel: `판매자센터 (최근 ${days}일)`,
        loadedAt: Date.now(),
        loadedCount: response.sampleCount || response.samples?.length || 0,
        analyzedAt: null,
        analyzedCount: 0,
        analyzedFingerprint: '',
      },
      sampleText
    );

    return response;
  } catch (err) {
    await patchSampleFlow({
      fetching: false,
      fetchStartedAt: null,
      lastError: formatSampleFetchError(err.message),
      lastErrorAt: Date.now(),
    });
    throw err;
  }
}

async function runAnalyzeToneJob(payload) {
  const context = payload.context === 'inquiry' ? 'inquiry' : 'review';
  const isInquiry = context === 'inquiry';
  const learnedId = isInquiry ? 'inquiry-learned' : 'learned';
  const flowKey = isInquiry ? 'inquirySampleFlow' : 'sampleFlow';
  const presetsKey = isInquiry ? 'inquiryCustomPresets' : 'customPresets';
  const presetIdKey = isInquiry ? 'inquiryTonePresetId' : 'tonePresetId';
  const promptKey = isInquiry ? 'inquirySystemPrompt' : 'systemPrompt';
  const toneProfileKey = isInquiry ? 'inquiryToneProfile' : 'toneProfile';

  await patchSampleFlowByContext(context, {
    analyzing: true,
    analyzeStartedAt: Date.now(),
    lastError: '',
    lastErrorAt: null,
  });

  try {
    const dataBefore = await storageGet([CONFIG.SETTINGS_KEY]);
    const settingsBefore = dataBefore[CONFIG.SETTINGS_KEY] || {};
    const result = await analyzeToneSamples({
      ...payload,
      context,
      previousToneProfile: payload.previousToneProfile || settingsBefore[toneProfileKey] || null,
    });
    const data = await storageGet([CONFIG.SETTINGS_KEY]);
    const settings = data[CONFIG.SETTINGS_KEY] || {};
    const learned = {
      id: learnedId,
      name: `내 스타일 (샘플 ${result.sampleCount}개)`,
      prompt: result.prompt,
      toneProfile: result.toneProfile || null,
      updatedAt: Date.now(),
    };
    const customPresets = [
      learned,
      ...(settings[presetsKey] || []).filter((p) => p.id !== learnedId),
    ];
    const nextSampleFlow = {
      ...emptySampleFlow(),
      ...(settings[flowKey] || {}),
      analyzing: false,
      analyzeStartedAt: null,
      analyzedAt: Date.now(),
      analyzedCount: result.sampleCount,
      lastError: '',
      lastErrorAt: null,
    };

    if (payload.skipPersist) {
      await patchSampleFlowByContext(context, {
        analyzing: false,
        analyzeStartedAt: null,
        analyzedAt: Date.now(),
        analyzedCount: result.sampleCount,
        lastError: '',
        lastErrorAt: null,
      });
    } else {
      await storageSet({
        [CONFIG.SETTINGS_KEY]: {
          ...settings,
          [presetsKey]: customPresets,
          [presetIdKey]: learnedId,
          [promptKey]: result.prompt,
          [toneProfileKey]: result.toneProfile || null,
          [flowKey]: nextSampleFlow,
        },
      });
    }

    return {
      ...result,
      context,
      customPresets,
      tonePresetId: learnedId,
      prompt: result.prompt,
      sampleFlow: nextSampleFlow,
    };
  } catch (err) {
    await patchSampleFlowByContext(context, {
      analyzing: false,
      analyzeStartedAt: null,
      lastError: String(err.message || '분석 실패'),
      lastErrorAt: Date.now(),
    });
    throw err;
  }
}

async function patchSampleFlowByContext(context, flowPatch, sampleReplies) {
  const isInquiry = context === 'inquiry';
  const flowKey = isInquiry ? 'inquirySampleFlow' : 'sampleFlow';
  const repliesKey = isInquiry ? 'inquirySampleReplies' : 'sampleReplies';
  const data = await storageGet([CONFIG.SETTINGS_KEY]);
  const settings = data[CONFIG.SETTINGS_KEY] || {};
  const sampleFlow = { ...emptySampleFlow(), ...(settings[flowKey] || {}), ...flowPatch };
  await storageSet({
    [CONFIG.SETTINGS_KEY]: {
      ...settings,
      [flowKey]: sampleFlow,
      ...(sampleReplies != null ? { [repliesKey]: sampleReplies } : {}),
    },
  });
}
