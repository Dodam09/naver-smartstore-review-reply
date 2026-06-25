importScripts('config.js', 'lib/lookup-days.js', 'lib/inquiry-reference.js');

let isRunning = false;
let isInquiryRunning = false;
let stopRequested = false;
let inquiryStopRequested = false;
let abortController = null;
let inquiryAbortController = null;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'START_GENERATE') {
    if (isRunning) {
      sendResponse({ ok: false, error: '이미 답변 생성이 진행 중입니다.' });
      return false;
    }

    runGenerate(message.payload).catch(async (err) => {
      await updateProgress({
        status: 'error',
        message: `오류: ${err.message}`,
        lastError: err.message,
        finishedAt: Date.now(),
      });
      isRunning = false;
      stopRequested = false;
      abortController = null;
    });

    sendResponse({ ok: true, started: true });
    return false;
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

    runGenerateInquiries(message.payload).catch(async (err) => {
      await updateInquiryProgress({
        status: 'error',
        message: `오류: ${err.message}`,
        lastError: err.message,
        finishedAt: Date.now(),
      });
      isInquiryRunning = false;
      inquiryStopRequested = false;
      inquiryAbortController = null;
    });

    sendResponse({ ok: true, started: true });
    return false;
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

  if (message.type === 'FETCH_INQUIRY_REPLY_CATALOG_JOB') {
    const catalogDays = clampLookupDays(message.payload?.days, { min: 0, max: 365, fallback: 7 });
    relaySellerTabMessage(
      'FETCH_INQUIRY_REPLY_CATALOG',
      { ...(message.payload || {}), days: catalogDays },
      catalogFetchTimeoutMs(Math.min(catalogDays, 180))
    )
      .then(async (result) => {
        const cacheKey =
          CONFIG.INQUIRY_REFERENCE_CACHE_KEY || 'smartstoreInquiryReferenceCache';
        await storageSet({
          [cacheKey]: {
            catalog: result.catalog || [],
            fetchedAt: Date.now(),
            days: result.days || catalogDays,
            withAnswerCount: result.withAnswerCount || result.catalog?.length || 0,
          },
        });
        sendResponse({ ok: true, ...result });
      })
      .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
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
});

async function runGenerate(payload) {
  const { rows, apiKey, systemPrompt, model } = payload;
  if (!rows?.length) throw new Error('처리할 리뷰가 없습니다.');
  if (!apiKey) throw new Error('API 키가 없습니다.');

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

  const errorHint =
    failed > 0 && success === 0 && lastError
      ? `\n\n원인: ${lastError}`
      : failed > 0 && lastError
        ? `\n\n최근 오류: ${lastError}`
        : '';

  await updateProgress({
    status: 'done',
    total,
    current: total,
    success,
    failed,
    currentId: '',
    lastError,
    message:
      `완료: 성공 ${success}건, 실패 ${failed}건.${errorHint}\n` +
      `작업 화면 「2. 답글 검토」 탭에서 확인·수정 후 [일괄 확인]을 눌러주세요.`,
    finishedAt: Date.now(),
  });

  isRunning = false;
  stopRequested = false;
  abortController = null;
}

async function runGenerateInquiries(payload) {
  const { rows, apiKey, systemPrompt, model, useReference, referenceDays } = payload;
  if (!rows?.length) throw new Error('처리할 상품문의가 없습니다.');
  if (!apiKey) throw new Error('API 키가 없습니다.');

  const storageKey = CONFIG.INQUIRY_STORAGE_KEY || 'smartstoreInquiryReplies';
  const applyKey = CONFIG.INQUIRY_APPLY_ENABLED_KEY || 'smartstoreInquiryApplyEnabled';
  const draftKey = CONFIG.INQUIRY_DRAFT_KEY || 'smartstoreInquiryDraft';

  let referenceCatalog = [];
  if (useReference !== false) {
    try {
      referenceCatalog = await loadInquiryReferenceCatalog(referenceDays || 90);
    } catch (err) {
      console.warn('기존 문의 답변 참고 로드 실패:', err);
    }
  }

  isInquiryRunning = true;
  inquiryStopRequested = false;
  inquiryAbortController = new AbortController();
  const signal = inquiryAbortController.signal;
  const total = rows.length;
  let success = 0;
  let failed = 0;
  let lastError = '';
  const replyMap = {};
  const draftItems = [];

  await storageSet({ [applyKey]: false });
  await storageSet({ [storageKey]: {} });

  await updateInquiryProgress({
    status: 'running',
    total,
    current: 0,
    success: 0,
    failed: 0,
    currentId: '',
    message: `문의 답변 생성 시작 (0/${total})`,
    startedAt: Date.now(),
    finishedAt: null,
    lastError: '',
    useReference: useReference !== false,
    referenceCount: referenceCatalog.length,
  });

  for (let i = 0; i < rows.length; i++) {
    if (inquiryStopRequested || signal.aborted) break;

    const row = rows[i];
    const references = referenceCatalog.length
      ? pickSimilarInquiryReferences(row, referenceCatalog, 2)
      : [];

    await updateInquiryProgress({
      status: 'running',
      total,
      current: i + 1,
      success,
      failed,
      currentId: row.id,
      message: `문의 답변 생성 중 (${i + 1}/${total}) — 문의번호 ${row.id}`,
      lastError,
      useReference: useReference !== false,
      referenceCount: referenceCatalog.length,
    });

    try {
      const reply = await generateInquiryReply(
        apiKey,
        systemPrompt,
        row,
        model,
        signal,
        references
      );
      if (inquiryStopRequested || signal.aborted) break;

      replyMap[String(row.id)] = reply;
      draftItems.push({
        id: row.id,
        inquiryContent: row.content,
        product: row.product || '',
        writer: row.writer || '',
        secret: !!row.secret,
        reply,
        referenceIds: references.map((ref) => ref.id),
      });
      success++;

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
      currentId: '',
      lastError,
      message:
        `중지됨: 성공 ${success}건 저장됨 (전체 ${total}건 중 ${processed}건 처리).` +
        (failed > 0 ? ` 실패 ${failed}건.` : '') +
        '\n작업 화면 「2. 답글 검토」 탭에서 확인·수정 후 자동 입력을 활성화하세요.',
      finishedAt: Date.now(),
    });
    if (success > 0) await storageSet({ [applyKey]: true });
    isInquiryRunning = false;
    inquiryStopRequested = false;
    inquiryAbortController = null;
    return;
  }

  const errorHint =
    failed > 0 && success === 0 && lastError
      ? `\n\n원인: ${lastError}`
      : failed > 0 && lastError
        ? `\n\n최근 오류: ${lastError}`
        : '';

  await updateInquiryProgress({
    status: 'done',
    total,
    current: total,
    success,
    failed,
    currentId: '',
    lastError,
    message:
      `완료: 성공 ${success}건, 실패 ${failed}건.${errorHint}\n` +
      `작업 화면 「2. 답글 검토」 탭에서 확인·수정 후 [자동 입력 모드]를 눌러주세요.`,
    finishedAt: Date.now(),
  });

  if (success > 0) await storageSet({ [applyKey]: true });

  isInquiryRunning = false;
  inquiryStopRequested = false;
  inquiryAbortController = null;
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

  const response = await relaySellerTabMessage(
    'FETCH_INQUIRY_REPLY_CATALOG',
    { days: lookupDays, maxItems: 80 },
    catalogFetchTimeoutMs(Math.min(Math.max(lookupDays, 1), 180))
  );

  const catalog = response.catalog || [];
  await storageSet({
    [cacheKey]: {
      catalog,
      fetchedAt: Date.now(),
      days: lookupDays,
      withAnswerCount: catalog.length,
    },
  });
  return catalog;
}

async function analyzeToneSamples(payload) {
  const { apiKey, samples, model, context = 'review' } = payload;
  if (!apiKey) throw new Error('API 키가 없습니다.');
  const normalized = normalizeAnalysisSamples(samples);
  if (normalized.length < 2) {
    throw new Error('분석할 샘플 답글이 2개 이상 필요합니다.');
  }

  const sampleBlock = normalized.map((s, i) => `[${i + 1}]\n${s}`).join('\n\n');
  const isInquiry = context === 'inquiry';
  const metaPrompt = isInquiry
    ? `당신은 네이버 스마트스토어 판매자 답글 스타일 분석 전문가입니다.
아래는 실제 사장님이 작성한 **상품문의** 판매자 답글 샘플입니다. 말투, 문장 길이, 인사·안내 표현, 이모지 사용, 종결어미, 자주 쓰는 표현, 피해야 할 표현을 분석한 뒤, 같은 스타일로 고객 상품문의 답글을 작성하게 할 **시스템 지시문(system instruction)** 을 한국어로 작성하세요.

규칙:
- 출력은 시스템 지시문 본문만 (설명·제목·따옴표·마크다운 없이)
- 5~12문장 분량
- "복붙 티 나지 않게", "문의 내용의 질문에 구체적으로 답변"을 반드시 포함
- 리뷰 감사 인사 위주가 아닌, 문의 Q&A·안내 톤으로 작성하도록 지시
- 샘플에 없는 이모지·유행어를 무리하게 추가하지 말 것
- 스마트스토어 상품문의 판매자 답글임을 명시

샘플 답글:
${sampleBlock}`
    : `당신은 네이버 스마트스토어 판매자 답글 스타일 분석 전문가입니다.
아래는 실제 사장님이 작성한 판매자 답글 샘플입니다. 말투, 문장 길이, 인사·감사 표현, 이모지 사용, 종결어미, 자주 쓰는 표현, 피해야 할 표현을 분석한 뒤, 같은 스타일로 고객 리뷰 답글을 작성하게 할 **시스템 지시문(system instruction)** 을 한국어로 작성하세요.

규칙:
- 출력은 시스템 지시문 본문만 (설명·제목·따옴표·마크다운 없이)
- 5~12문장 분량
- "복붙 티 나지 않게", "리뷰 내용에 구체적으로 반응"을 반드시 포함
- 샘플에 없는 이모지·유행어를 무리하게 추가하지 말 것
- 스마트스토어 판매자 답글임을 명시

샘플 답글:
${sampleBlock}`;

  const prompt = await callGeminiText(apiKey, metaPrompt, model, { temperature: 0.35 });
  if (!prompt || prompt.length < 30) {
    throw new Error('스타일 분석 결과가 너무 짧습니다. 샘플을 더 추가해 보세요.');
  }

  return {
    prompt: prompt.trim(),
    sampleCount: normalized.length,
  };
}

function normalizeAnalysisSamples(samples) {
  const unique = [];
  const seen = new Set();
  for (const raw of samples || []) {
    const s = String(raw).replace(/\r\n/g, '\n').trim();
    if (s.length < 8) continue;
    const key = s.slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(s);
  }
  return unique.slice(0, 20);
}

async function callGeminiText(apiKey, userText, model, options = {}) {
  const geminiModel = model || CONFIG.GEMINI_MODEL;
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: {
        temperature: options.temperature ?? 0.7,
      },
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    let message = errBody.slice(0, 300);
    try {
      const parsed = JSON.parse(errBody);
      message = parsed.error?.message || message;
    } catch (_) {}
    throw new Error(`Gemini ${response.status}: ${message}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts
    ?.map((p) => p.text)
    .join('')
    .trim();
  if (!text) throw new Error('빈 응답');
  return text;
}

async function generateReply(apiKey, systemPrompt, row, model, signal) {
  const userContent = [
    row.product && `상품명: ${row.product}`,
    row.reviewType && `리뷰구분: ${row.reviewType}`,
    row.rating && `구매자평점: ${row.rating}점`,
    row.writer && `작성자: ${row.writer}`,
    row.option && `옵션: ${row.option}`,
    `리뷰 내용:\n${row.content}`,
    '위 리뷰에 대한 판매자 답글만 출력하세요. 따옴표나 접두어 없이 본문만.',
  ]
    .filter(Boolean)
    .join('\n');

  const geminiModel = model || CONFIG.GEMINI_MODEL;
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: userContent }],
        },
      ],
      generationConfig: {
        temperature: 0.7,
      },
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    let message = errBody.slice(0, 300);
    try {
      const parsed = JSON.parse(errBody);
      message = parsed.error?.message || message;
    } catch (_) {}
    throw new Error(`Gemini ${response.status}: ${message}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts
    ?.map((p) => p.text)
    .join('')
    .trim();
  if (!text) throw new Error('빈 응답');
  return text;
}

async function generateInquiryReply(apiKey, systemPrompt, row, model, signal, references = []) {
  const refBlock =
    references.length > 0
      ? [
          '아래는 비슷한 과거 상품문의와 실제 판매자 답변입니다. 말투·안내 방식을 참고하되, 새 문의에 맞게 작성하세요.',
          ...references.map(
            (ref, index) =>
              `[참고 ${index + 1}]\n문의: ${ref.question}\n답변: ${ref.answer}`
          ),
          '',
        ].join('\n')
      : '';

  const userContent = [
    refBlock,
    row.product && `상품명: ${row.product}`,
    row.writer && `문의자: ${row.writer}`,
    row.secret != null && `비밀문의: ${row.secret ? '예' : '아니오'}`,
    `문의 내용:\n${row.content}`,
    '위 상품문의에 대한 판매자 답글만 출력하세요. 따옴표나 접두어 없이 본문만.',
  ]
    .filter(Boolean)
    .join('\n');

  const geminiModel = model || CONFIG.GEMINI_MODEL;
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: userContent }],
        },
      ],
      generationConfig: {
        temperature: 0.7,
      },
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    let message = errBody.slice(0, 300);
    try {
      const parsed = JSON.parse(errBody);
      message = parsed.error?.message || message;
    } catch (_) {}
    throw new Error(`Gemini ${response.status}: ${message}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts
    ?.map((p) => p.text)
    .join('')
    .trim();
  if (!text) throw new Error('빈 응답');
  return text;
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

async function updateProgress(progress) {
  await storageSet({ [CONFIG.PROGRESS_KEY]: progress });
}

async function updateInquiryProgress(progress) {
  const key = CONFIG.INQUIRY_PROGRESS_KEY || 'smartstoreInquiryJobProgress';
  await storageSet({ [key]: progress });
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

const STALE_JOB_MS = 60 * 1000;
const STALE_SAMPLE_FLOW_MS = 45 * 1000;

async function healStaleJob(job, activelyRunning, storageKey) {
  if (!job || job.status !== 'running' || activelyRunning) return job;

  const started = job.startedAt || job.updatedAt || 0;
  if (started && Date.now() - started <= STALE_JOB_MS) return job;

  const healed = {
    ...job,
    status: 'error',
    message: '생성 작업이 중단되었습니다. 다시 시도해 주세요.',
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

const SELLER_TAB_URL = 'https://sell.smartstore.naver.com/*';
const SELLER_CONTENT_SCRIPT_FILES = [
  'config.js',
  'lib/lookup-days.js',
  'content.js',
  'content-import.js',
  'content-submit.js',
  'content-inquiry-import.js',
  'content-inquiry-fill.js',
];

function scoreSellerTab(tab) {
  const url = String(tab.url || '');
  let score = 0;
  if (/review/i.test(url)) score += 20;
  if (/comment|inquir|contents/i.test(url)) score += 18;
  if (/sell\.smartstore\.naver\.com/i.test(url)) score += 5;
  if (tab.active) score += 3;
  return score;
}

async function getSellerTab() {
  const tabs = await chrome.tabs.query({ url: SELLER_TAB_URL });
  if (!tabs.length) {
    throw new Error(
      '판매자센터 탭이 없습니다.\n[sell.smartstore.naver.com] 리뷰 관리 페이지를 연 뒤 다시 시도하세요.'
    );
  }
  return tabs.slice().sort((a, b) => scoreSellerTab(b) - scoreSellerTab(a))[0];
}

function pingSellerTab(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: 'SS_REVIEW_PING' }, (response) => {
      resolve(!chrome.runtime.lastError && response?.ok === true);
    });
  });
}

async function injectSellerContentScripts(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    files: SELLER_CONTENT_SCRIPT_FILES,
  });
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
  const tab = await getSellerTab();
  await ensureSellerTabReady(tab.id);

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('판매자센터 응답 시간이 초과되었습니다.\n리뷰 관리 페이지를 새로고침(F5)한 뒤 다시 시도하세요.'));
    }, timeoutMs);

    chrome.tabs.sendMessage(tab.id, { type: messageType, payload }, (response) => {
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

  await patchSampleFlowByContext(context, {
    analyzing: true,
    analyzeStartedAt: Date.now(),
    lastError: '',
    lastErrorAt: null,
  });

  try {
    const result = await analyzeToneSamples({ ...payload, context });
    const data = await storageGet([CONFIG.SETTINGS_KEY]);
    const settings = data[CONFIG.SETTINGS_KEY] || {};
    const learned = {
      id: learnedId,
      name: `내 스타일 (샘플 ${result.sampleCount}개)`,
      prompt: result.prompt,
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

    await storageSet({
      [CONFIG.SETTINGS_KEY]: {
        ...settings,
        [presetsKey]: customPresets,
        [presetIdKey]: learnedId,
        [promptKey]: result.prompt,
        [flowKey]: nextSampleFlow,
      },
    });

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
