/**
 * 상품문의 기존 Q&A에서 유사 참고 답변·같은 상품 지식 선택
 */
const PRODUCT_NAME_NOISE = new Set([
  '무료배송',
  '당일발송',
  '정품',
  '본품',
  '사은품',
  '증정',
  '세트',
  '기획',
  '할인',
  '특가',
  '대용량',
  '국내산',
  '수제',
  '프리미엄',
  '추천',
  '선물',
  '신상',
  '인기',
  '베스트',
]);

function tokenizeInquiryText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

function productNoOf(item) {
  return String(item?.productNo || '').replace(/[^\d]/g, '');
}

function productNameOf(item) {
  return String(item?.product || '').trim().toLowerCase();
}

function isSameInquiryProduct(a, b) {
  const noA = productNoOf(a);
  const noB = productNoOf(b);
  if (noA && noB && noA === noB) return true;

  const nameA = productNameOf(a);
  const nameB = productNameOf(b);
  if (!nameA || !nameB) return false;
  if (nameA === nameB) return true;
  if (nameA.includes(nameB) || nameB.includes(nameA)) return true;

  const tokensA = tokenizeInquiryText(nameA).filter((t) => !PRODUCT_NAME_NOISE.has(t) && !/^\d/.test(t));
  const tokensB = new Set(
    tokenizeInquiryText(nameB).filter((t) => !PRODUCT_NAME_NOISE.has(t) && !/^\d/.test(t))
  );
  const overlap = tokensA.filter((t) => tokensB.has(t));
  return overlap.length >= 2 || (overlap.length >= 1 && overlap[0].length >= 3 && overlap[0] === tokensA[0]);
}

function catalogAnswer(item) {
  return String(item?.answer || item?.reply || '').trim();
}

function toReference(item, score) {
  return {
    id: item.id,
    product: item.product || '',
    productNo: productNoOf(item),
    question: item.question || item.content || '',
    answer: catalogAnswer(item),
    score,
  };
}

function scoreInquiryReference(targetRow, candidate) {
  let score = 0;

  if (isSameInquiryProduct(targetRow, candidate)) score += 14;

  const targetProduct = productNameOf(targetRow);
  const candidateProduct = productNameOf(candidate);
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

  if (catalogAnswer(candidate).length >= 8) score += 1;
  return score;
}

function answeredCatalog(catalog) {
  return (catalog || []).filter((item) => item && catalogAnswer(item).length >= 8);
}

function pickSimilarInquiryReferences(targetRow, catalog, limit = 2) {
  const list = answeredCatalog(catalog);
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
    const answer = catalogAnswer(entry.item);
    const key = answer.slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(toReference(entry.item, entry.score));
    if (picked.length >= limit) break;
  }

  return picked;
}

function pickSameProductInquiryReferences(targetRow, catalog, limit = 6) {
  const list = answeredCatalog(catalog).filter((item) => isSameInquiryProduct(targetRow, item));
  if (!list.length) return [];

  const ranked = list
    .map((item) => ({
      item,
      score: scoreInquiryReference(targetRow, item) + Math.min(catalogAnswer(item).length / 80, 4),
    }))
    .sort((a, b) => b.score - a.score);

  const picked = [];
  const seen = new Set();
  for (const entry of ranked) {
    const answer = catalogAnswer(entry.item);
    const key = answer.slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(toReference(entry.item, entry.score));
    if (picked.length >= limit) break;
  }
  return picked;
}

function pickInquiryKnowledgeReferences(targetRow, catalog, options = {}) {
  const sameProductLimit = options.sameProductLimit ?? 6;
  const similarLimit = options.similarLimit ?? 2;
  const same = pickSameProductInquiryReferences(targetRow, catalog, sameProductLimit);
  const similar = pickSimilarInquiryReferences(targetRow, catalog, similarLimit + sameProductLimit);
  const picked = [];
  const seen = new Set();

  for (const item of [...same, ...similar]) {
    const key = String(item.id || '') || item.answer.slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(item);
    if (picked.length >= sameProductLimit + similarLimit) break;
  }
  return picked;
}
