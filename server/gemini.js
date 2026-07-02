const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

function getApiKey() {
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (!key) throw new Error('서버 GEMINI_API_KEY가 설정되지 않았습니다.');
  return key;
}

function parseGeminiError(status, errBody) {
  let message = String(errBody || '').slice(0, 300);
  try {
    const parsed = JSON.parse(errBody);
    message = parsed.error?.message || message;
  } catch (_) {}
  return `API 오류 (${status}): ${message}`;
}

function extractText(data) {
  const text = data.candidates?.[0]?.content?.parts
    ?.map((p) => p.text)
    .join('')
    .trim();
  if (!text) throw new Error('빈 응답');
  return text;
}

export async function generateText(userText, { model, temperature = 0.7 } = {}) {
  const geminiModel = model || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${encodeURIComponent(getApiKey())}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: { temperature },
    }),
  });

  if (!response.ok) {
    throw new Error(parseGeminiError(response.status, await response.text()));
  }

  return extractText(await response.json());
}

export async function generateWithSystem(systemPrompt, userContent, { model, temperature = 0.7 } = {}) {
  const geminiModel = model || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${encodeURIComponent(getApiKey())}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userContent }] }],
      generationConfig: { temperature },
    }),
  });

  if (!response.ok) {
    throw new Error(parseGeminiError(response.status, await response.text()));
  }

  return extractText(await response.json());
}
