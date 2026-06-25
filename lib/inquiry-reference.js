/**
 * 상품문의 기존 Q&A에서 유사 참고 답변 선택
 */
function tokenizeInquiryText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

function scoreInquiryReference(targetRow, candidate) {
  let score = 0;

  const targetProduct = String(targetRow.product || '').trim().toLowerCase();
  const candidateProduct = String(candidate.product || '').trim().toLowerCase();
  if (targetProduct && candidateProduct) {
    if (targetProduct === candidateProduct) score += 8;
    else if (targetProduct.includes(candidateProduct) || candidateProduct.includes(targetProduct)) {
      score += 5;
    } else {
      const targetTokens = tokenizeInquiryText(targetProduct);
      const candidateTokens = tokenizeInquiryText(candidateProduct);
      const overlap = targetTokens.filter((t) => candidateTokens.includes(t)).length;
      score += Math.min(overlap * 2, 6);
    }
  }

  const targetTokens = new Set(tokenizeInquiryText(targetRow.content));
  const questionTokens = tokenizeInquiryText(candidate.question || candidate.content);
  let shared = 0;
  for (const token of questionTokens) {
    if (targetTokens.has(token)) shared += 1;
  }
  score += Math.min(shared, 10);

  if ((candidate.answer || candidate.reply || '').length >= 8) score += 1;
  return score;
}

function pickSimilarInquiryReferences(targetRow, catalog, limit = 2) {
  const list = (catalog || []).filter(
    (item) => item && (item.answer || item.reply) && String(item.answer || item.reply).trim().length >= 8
  );
  if (!list.length) return [];

  const ranked = list
    .map((item) => ({
      item,
      score: scoreInquiryReference(targetRow, item),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  const picked = [];
  const seen = new Set();
  for (const entry of ranked) {
    const answer = String(entry.item.answer || entry.item.reply || '').trim();
    const key = answer.slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push({
      id: entry.item.id,
      product: entry.item.product || '',
      question: entry.item.question || entry.item.content || '',
      answer,
      score: entry.score,
    });
    if (picked.length >= limit) break;
  }

  return picked;
}
