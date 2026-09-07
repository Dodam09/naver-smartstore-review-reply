/**
 * 샘플 답글 파싱 (텍스트·엑셀)
 */
const REPLY_COLUMN_ALIASES = [
  '판매자답글',
  '판매자 답글',
  '답글내용',
  '답글 내용',
  '답글',
  'seller_reply',
  'seller reply',
  'reply',
  'comment',
];

function normalizeHeader(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function detectReplyColumn(headers) {
  const normalized = headers.map((h) => normalizeHeader(h));
  const aliases = REPLY_COLUMN_ALIASES.map(normalizeHeader);
  return normalized.findIndex((h) => aliases.includes(h));
}

function parseReplySamplesFromWorkbookRows(rows) {
  if (!rows?.length) return [];

  const headers = rows[0].map((h) => String(h).trim());
  const col = detectReplyColumn(headers);
  if (col < 0) {
    throw new Error(
      `답글 컬럼을 찾지 못했습니다. (판매자답글, 답글내용 등)\n헤더: ${headers.join(', ')}`
    );
  }

  const samples = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const text = String(row[col] ?? '').trim();
    if (text.length >= 8) samples.push(text);
  }
  return samples;
}

function parseReplySamplesFromText(text) {
  return splitSampleText(text);
}

function getSampleReplyTemplateRows() {
  return [['판매자답글'], [''], [''], ['']];
}

function getSampleReplyTemplateText() {
  return ['(여기에 예전 답글 1)', '(여기에 예전 답글 2)', '(여기에 예전 답글 3)'].join(
    '\n\n---\n\n'
  );
}
