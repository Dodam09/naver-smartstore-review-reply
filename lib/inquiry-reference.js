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

const INQUIRY_INTENT_GROUPS = [
  ['먹어도', '먹여도', '먹일', '급여', '섭취', '사용해도', '써도', '발라도', '입어도', '해도', '괜찮을까', '괜찮나요'],
  ['개월', '개월령', '살', '연령', '나이', '유아', '어린이', '아기', '임산부', '수유', '시니어', '노령'],
  ['교환', '반품', '환불', '취소'],
  ['배송', '출고', '발송', '도착', '택배', '송장'],
  ['재고', '품절', '입고'],
];

const INQUIRY_CONDITION_STOP = new Set([
  '먹어도',
  '먹여도',
  '먹일',
  '급여',
  '섭취',
  '사용해도',
  '써도',
  '발라도',
  '입어도',
  '해도',
  '될까요',
  '되나요',
  '될까',
  '되나',
  '인가요',
  '할까요',
  '해주세요',
  '알려주세요',
  '있을까요',
  '있나요',
  '없어요',
  '문의',
  '상품',
  '제품',
  '구매',
  '주문',
  '고객',
  '안녕하세요',
  '감사합니다',
  '혹시',
  '그냥',
  '조금',
  '많이',
  '정말',
  '너무',
  '있어요',
  '해요',
  '입니다',
  '같은',
  '이런',
  '저런',
  '어떤',
  '무슨',
]);

function expandInquiryIntentTokens(tokens) {
  const set = new Set(tokens);
  for (const token of tokens) {
    for (const group of INQUIRY_INTENT_GROUPS) {
      if (group.some((word) => token.includes(word) || word.includes(token))) {
        for (const word of group) set.add(word);
      }
    }
  }
  return set;
}

function extractInquiryConditionTokens(text) {
  const raw = String(text || '');
  const conditions = [];
  const seen = new Set();

  const push = (value) => {
    const token = String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '');
    if (!token || token.length < 2 || INQUIRY_CONDITION_STOP.has(token) || seen.has(token)) return;
    seen.add(token);
    conditions.push(token);
  };

  for (const match of raw.matchAll(/(\d+)\s*(개월|개월령|살|세|주|일|kg|g|ml|cm|mm|호)/gi)) {
    push(`${match[1]}${match[2]}`);
  }

  for (const token of tokenizeInquiryText(raw)) {
    if (/^\d+$/.test(token)) continue;
    if (INQUIRY_CONDITION_STOP.has(token)) continue;
    if (INQUIRY_INTENT_GROUPS.some((group) => group.includes(token))) continue;
    push(token);
  }

  return conditions.slice(0, 12);
}

function conditionTokenMatches(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 2 && b.length >= 2 && (a.includes(b) || b.includes(a))) return true;
  return false;
}

function scoreInquiryConditionOverlap(targetText, candidateText) {
  const targetConditions = extractInquiryConditionTokens(targetText);
  if (!targetConditions.length) {
    return { overlap: 0, ratio: 1, missing: [], matched: [] };
  }

  const candidateConditions = extractInquiryConditionTokens(candidateText);
  const candidateBlob = String(candidateText || '').toLowerCase().replace(/\s+/g, '');
  const matched = [];
  const missing = [];

  for (const condition of targetConditions) {
    const hit =
      candidateConditions.some((other) => conditionTokenMatches(condition, other)) ||
      candidateBlob.includes(condition);
    if (hit) matched.push(condition);
    else missing.push(condition);
  }

  return {
    overlap: matched.length,
    ratio: matched.length / targetConditions.length,
    missing,
    matched,
  };
}

function referenceCoversInquiryConditions(targetRow, reference) {
  const question = String(targetRow?.content || targetRow?.question || '');
  const conditions = extractInquiryConditionTokens(question);
  const refQuestion = String(reference?.question || reference?.content || '');
  const refAnswer = String(reference?.answer || reference?.reply || '');
  const blob = `${refQuestion}\n${refAnswer}`;

  if (!conditions.length) {
    return (reference?.score || 0) >= 10;
  }

  const qOverlap = scoreInquiryConditionOverlap(question, refQuestion);
  const aOverlap = scoreInquiryConditionOverlap(question, refAnswer);
  const numeric = conditions.filter((token) => /\d/.test(token));
  if (numeric.length) {
    const blobNorm = blob.toLowerCase().replace(/\s+/g, '');
    const allNumericHit = numeric.every(
      (token) =>
        blobNorm.includes(token) ||
        qOverlap.matched.includes(token) ||
        aOverlap.matched.includes(token)
    );
    if (!allNumericHit) return false;
  }

  const overlap = qOverlap.overlap + aOverlap.overlap;
  if (conditions.length >= 2) {
    return qOverlap.ratio >= 0.5 || overlap >= Math.ceil(conditions.length * 0.5);
  }
  return qOverlap.overlap >= 1 || aOverlap.overlap >= 1;
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

  const targetTokens = expandInquiryIntentTokens(tokenizeInquiryText(targetRow.content));
  const questionTokens = expandInquiryIntentTokens(
    tokenizeInquiryText(candidate.question || candidate.content)
  );
  let shared = 0;
  for (const token of questionTokens) {
    if (targetTokens.has(token)) shared += 1;
  }
  score += Math.min(shared, 10);

  const answerTokens = expandInquiryIntentTokens(tokenizeInquiryText(catalogAnswer(candidate)));
  let answerShared = 0;
  for (const token of answerTokens) {
    if (targetTokens.has(token)) answerShared += 1;
  }
  score += Math.min(answerShared, 8);

  const conditionOverlap = scoreInquiryConditionOverlap(
    targetRow.content,
    `${candidate.question || candidate.content || ''}\n${catalogAnswer(candidate)}`
  );
  score += Math.min(conditionOverlap.overlap * 3, 12);
  if (conditionOverlap.ratio >= 0.5) score += 4;
  if (conditionOverlap.missing.length && conditionOverlap.overlap === 0) score -= 6;

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
  }
  picked.sort((a, b) => (b.score || 0) - (a.score || 0));
  return picked.slice(0, sameProductLimit + similarLimit);
}

function pickInquiryReferencesFromAnswers(targetRow, answers, limit = 4) {
  const catalog = (answers || [])
    .map((answer, index) => ({
      id: `sample-${index}`,
      question: '',
      content: '',
      answer: String(answer || '').trim(),
      product: '',
    }))
    .filter((item) => item.answer.length >= 8);
  return pickSimilarInquiryReferences(targetRow, catalog, limit);
}
