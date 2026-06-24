importScripts('config.js');

let isRunning = false;

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
    });

    sendResponse({ ok: true, started: true });
    return false;
  }

  if (message.type === 'GET_JOB_STATUS') {
    chrome.storage.local.get([CONFIG.PROGRESS_KEY], (data) => {
      sendResponse({ ok: true, job: data[CONFIG.PROGRESS_KEY] || null, isRunning });
    });
    return true;
  }
});

async function runGenerate(payload) {
  const { rows, apiKey, systemPrompt, model } = payload;
  if (!rows?.length) throw new Error('처리할 리뷰가 없습니다.');
  if (!apiKey) throw new Error('API 키가 없습니다.');

  isRunning = true;
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
      const reply = await generateReply(apiKey, systemPrompt, row, model);
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
      await sleep(400);
    } catch (err) {
      failed++;
      lastError = err.message;
      console.error(`글번호 ${row.id} 실패:`, err);
    }
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
      `답글 검토 화면에서 확인·수정 후 [일괄 확인]을 눌러주세요.`,
    finishedAt: Date.now(),
    openReview: success > 0,
  });

  isRunning = false;
}

async function generateReply(apiKey, systemPrompt, row, model) {
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
