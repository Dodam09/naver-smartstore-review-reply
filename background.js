importScripts('config.js');

let isRunning = false;
let stopRequested = false;
let abortController = null;

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
    chrome.storage.local.get([CONFIG.PROGRESS_KEY], (data) => {
      sendResponse({ ok: true, job: data[CONFIG.PROGRESS_KEY] || null, isRunning });
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
    const catalogDays = Math.max(7, Math.min(730, Number(message.payload?.days) || 730));
    relaySellerTabMessage(
      'FETCH_SELLER_REPLY_CATALOG',
      { ...(message.payload || {}), days: catalogDays },
      catalogFetchTimeoutMs(catalogDays)
    )
      .then((result) => sendResponse({ ok: true, ...result }))
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

async function analyzeToneSamples(payload) {
  const { apiKey, samples, model } = payload;
  if (!apiKey) throw new Error('API 키가 없습니다.');
  const normalized = normalizeAnalysisSamples(samples);
  if (normalized.length < 2) {
    throw new Error('분석할 샘플 답글이 2개 이상 필요합니다.');
  }

  const sampleBlock = normalized.map((s, i) => `[${i + 1}]\n${s}`).join('\n\n');
  const metaPrompt = `당신은 네이버 스마트스토어 판매자 답글 스타일 분석 전문가입니다.
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
      '1. [리뷰 관리] 페이지(sell.smartstore.naver.com)에서 F5\n' +
      '2. chrome://extensions 에서 확장 프로그램 [새로고침]\n' +
      '3. 다시 시도'
    );
  }
  return msg;
}

const SELLER_TAB_URL = 'https://sell.smartstore.naver.com/*';
const SELLER_CONTENT_SCRIPT_FILES = ['config.js', 'content.js', 'content-import.js', 'content-submit.js'];

function scoreSellerTab(tab) {
  const url = String(tab.url || '');
  let score = 0;
  if (/review/i.test(url)) score += 20;
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
  if (days >= 365) return 180000;
  if (days >= 180) return 120000;
  return 90000;
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
  const days = Math.max(7, Math.min(730, Number(payload.days) || 180));
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
  await patchSampleFlow({
    analyzing: true,
    analyzeStartedAt: Date.now(),
    lastError: '',
    lastErrorAt: null,
  });

  try {
    const result = await analyzeToneSamples(payload);
    const data = await storageGet([CONFIG.SETTINGS_KEY]);
    const settings = data[CONFIG.SETTINGS_KEY] || {};
    const learned = {
      id: 'learned',
      name: `내 스타일 (샘플 ${result.sampleCount}개)`,
      prompt: result.prompt,
      updatedAt: Date.now(),
    };
    const customPresets = [
      learned,
      ...(settings.customPresets || []).filter((p) => p.id !== 'learned'),
    ];

    await storageSet({
      [CONFIG.SETTINGS_KEY]: {
        ...settings,
        customPresets,
        tonePresetId: 'learned',
        systemPrompt: result.prompt,
        sampleFlow: {
          ...emptySampleFlow(),
          ...(settings.sampleFlow || {}),
          analyzing: false,
          analyzeStartedAt: null,
          analyzedAt: Date.now(),
          analyzedCount: result.sampleCount,
          lastError: '',
          lastErrorAt: null,
        },
      },
    });

    return result;
  } catch (err) {
    const data = await storageGet([CONFIG.SETTINGS_KEY]);
    const settings = data[CONFIG.SETTINGS_KEY] || {};
    await patchSampleFlow({
      analyzing: false,
      analyzeStartedAt: null,
      lastError: String(err.message || '분석 실패'),
      lastErrorAt: Date.now(),
    });
    throw err;
  }
}
