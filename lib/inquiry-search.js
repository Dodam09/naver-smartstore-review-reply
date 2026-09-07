function getInquiryQuestionText(row) {
  return String(row?.content || '').trim();
}

function isReturnInquiry(row) {
  const text = getInquiryQuestionText(row);
  if (!text) return false;
  return /교환|반품|환불|취소/.test(text);
}

function isLogisticsInquiry(row) {
  const text = getInquiryQuestionText(row);
  if (!text) return false;
  return /배송|출고|도착|택배|송장|재고|품절|발송|입고|교환|반품|환불|취소|결제|입금|출시|발매|런칭|언제\s*(와|오|출발|발송|도착|나와|출시|입고|판매)/.test(
    text
  );
}

function inquiryNeedsConfirm(row) {
  return isReturnInquiry(row) || isLogisticsInquiry(row) || isEligibilityInquiry(row);
}

function getConfirmInquiryReason(row) {
  const text = getInquiryQuestionText(row);
  if (/교환|반품|환불|취소/.test(text)) {
    return '반품·환불 안내 초안입니다. 내용 확인 후 올려 주세요.';
  }
  if (/재고|품절|입고/.test(text)) {
    return '재고·입고 일정 초안입니다. 수량·시점 확인 후 올려 주세요.';
  }
  if (/출시|발매|런칭/.test(text)) {
    return '출시·일정 문의 초안입니다. 안내할 시점 문구를 확인한 뒤 올려 주세요.';
  }
  if (/배송|출고|발송|도착|택배|송장|언제/.test(text)) {
    return '배송·출고 일정 초안입니다. 날짜·안내 확인 후 올려 주세요.';
  }
  if (isEligibilityInquiry(row)) {
    return '가능 여부·조건 문의 초안입니다. 단정 문구를 확인한 뒤 올려 주세요.';
  }
  return '확인이 필요한 초안입니다. 검토한 뒤 올려 주세요.';
}

function extractInquiryScheduleTokens(text) {
  const raw = String(text || '');
  const tokens = [];
  const seen = new Set();
  const push = (value) => {
    const token = String(value || '').replace(/\s+/g, '').toLowerCase();
    if (!token || token.length < 2 || seen.has(token)) return;
    seen.add(token);
    tokens.push(token);
  };
  for (const match of raw.matchAll(/(\d{2,4})\s*년/g)) push(`${match[1]}년`);
  for (const match of raw.matchAll(/(\d{1,2})\s*월/g)) push(`${match[1]}월`);
  for (const match of raw.matchAll(/(\d{1,2})\s*일/g)) push(`${match[1]}일`);
  for (const match of raw.matchAll(/(\d+)\s*(주|주일|개월)\s*(안|내|후|뒤)?/g)) {
    push(`${match[1]}${match[2]}${match[3] || ''}`);
  }
  for (const match of raw.matchAll(/이번\s*년도|금년|올해|내년|다음\s*달|이번\s*달|연내/g)) {
    push(match[0]);
  }
  return tokens;
}

function extractInquiryConcreteClaims(text) {
  const raw = String(text || '');
  const claims = [];
  const seen = new Set();
  const push = (value) => {
    const token = String(value || '').replace(/\s+/g, '').toLowerCase();
    if (!token || token.length < 2 || seen.has(token)) return;
    seen.add(token);
    claims.push(token);
  };

  for (const token of extractInquiryScheduleTokens(raw)) push(token);

  for (const match of raw.matchAll(/https?:\/\/[^\s)>\]]+/gi)) push(match[0].replace(/[.,;!?]+$/, ''));
  for (const match of raw.matchAll(/\bwww\.[^\s)>\]]+/gi)) push(match[0].replace(/[.,;!?]+$/, ''));
  for (const match of raw.matchAll(/[a-z0-9][a-z0-9-]{1,40}\.(?:com|net|kr|co\.kr|shop|store|cafe|site)/gi)) {
    push(match[0]);
  }

  for (const match of raw.matchAll(/(\d+(?:\.\d+)?)\s*(개|병|팩|세트|박스|포|장|ml|mL|ℓ|L|kg|g|원|%|호|회|인분)/g)) {
    push(`${match[1]}${match[2]}`);
  }

  for (const match of raw.matchAll(/([가-힣A-Za-z][가-힣A-Za-z0-9_-]{1,24})\s*(무상|무료)\s*(지급|제공|증정|나눔)/g)) {
    push(`${match[1]}${match[2]}${match[3]}`);
  }
  for (const match of raw.matchAll(/(무상|무료)\s*(지급|제공|증정|나눔)/g)) {
    push(`${match[1]}${match[2]}`);
  }

  return claims;
}

function buildInquiryAllowedFactBlob(row, references = [], verifiedFacts = [], guidelines = '') {
  return [
    row?.content,
    row?.question,
    row?.product,
    guidelines,
    ...(Array.isArray(references) ? references : []).flatMap((ref) => [
      ref?.question,
      ref?.content,
      ref?.answer,
      ref?.reply,
    ]),
    ...(Array.isArray(verifiedFacts) ? verifiedFacts : []),
  ]
    .map((part) => String(part || ''))
    .filter(Boolean)
    .join('\n');
}

function findUnsupportedInquiryClaims(reply, allowedBlob) {
  const claims = extractInquiryConcreteClaims(reply);
  if (!claims.length) return [];
  const allowedNorm = String(allowedBlob || '').replace(/\s+/g, '').toLowerCase();
  return claims.filter((claim) => !allowedNorm.includes(claim));
}

function replyIntroducesUnsupportedFacts(reply, allowedBlob) {
  return findUnsupportedInquiryClaims(reply, allowedBlob).length > 0;
}

function assessInquiryReplyGrounding(row, reply, references = [], verifiedFacts = [], guidelines = '') {
  const allowed = buildInquiryAllowedFactBlob(row, references, verifiedFacts, guidelines);
  const unsupported = findUnsupportedInquiryClaims(reply, allowed);
  return {
    grounded: unsupported.length === 0,
    unsupported,
    allowed,
  };
}

function evaluateInquiryReplyConfirm(row, reply, references = [], verifiedFacts = [], guidelines = '') {
  const grounding = assessInquiryReplyGrounding(row, reply, references, verifiedFacts, guidelines);
  if (!grounding.grounded) {
    return {
      needsConfirm: false,
      needsManual: true,
      reason: '참고·지침·확인된 사실에 없는 구체 내용이 있어 직접 작성으로 넘겼습니다.',
    };
  }
  if (inquiryNeedsConfirm(row)) {
    return { needsConfirm: true, needsManual: false, reason: getConfirmInquiryReason(row) };
  }
  return { needsConfirm: false, needsManual: false, reason: '' };
}

function buildInquiryGroundingRewritePrompt(row, draftReply, references = [], verifiedFacts = [], guidelines = '') {
  const allowed = buildInquiryAllowedFactBlob(row, references, verifiedFacts, guidelines);
  return [
    '아래 초안에서, 허용된 근거에 없는 구체 사실을 전부 삭제하세요.',
    '허용 근거: 참고 답변, 응대 지침(사장님이 저장한 지침), 확인된 사실, 문의문.',
    '구체 사실 예: 몇 월/며칠/몇 주/이번년도, 수량, URL/도메인, 무상·무료 혜택, 고유 수치, 없는 절차.',
    '근거에 있는 말투·안내는 남기고, 없는 내용은 지어내어 메우지 마세요.',
    '',
    '[허용된 근거 — 여기 없는 구체 사실은 답에 넣지 마세요]',
    allowed || '(근거 없음)',
    '',
    `상품명: ${row?.product || '(없음)'}`,
    `문의 내용:\n${row?.content || ''}`,
    '',
    '[수정 전 초안]',
    String(draftReply || '').trim(),
    '',
    '수정된 판매자 답글만 출력하세요. 따옴표나 설명 없이 본문만.',
  ].join('\n');
}

function isEligibilityInquiry(row) {
  const text = getInquiryQuestionText(row);
  if (!text) return false;
  return /(먹어도|먹여도|먹일|급여|섭취|사용해도|써도|발라도|입어도|해도\s*될|해도\s*되|해도\s*괜찮|괜찮을|괜찮나|가능한가|가능할까|가능한지|문제\s*없|부작용)/.test(
    text
  );
}

function isDefinitiveInquiryAnswer(text) {
  return /(됩니다|됩니다요|안\s*됩니다|불가|가능합니다|괜찮습니다|드셔도|먹여도\s*됩니다|급여\s*가능|사용\s*가능|문제\s*없습니다)/.test(
    String(text || '')
  );
}

function hasStrongEligibilityReference(row, references) {
  const list = Array.isArray(references) ? references : [];
  if (!list.length) return false;
  if (typeof referenceCoversInquiryConditions === 'function') {
    return list.some((ref) => referenceCoversInquiryConditions(row, ref));
  }
  return (list[0]?.score || 0) >= 14;
}

function filterInquiryReferencesForRow(row, references) {
  const list = Array.isArray(references) ? references.slice() : [];
  if (!list.length) return [];
  if (!isEligibilityInquiry(row)) return list;
  if (typeof referenceCoversInquiryConditions !== 'function') return list;
  return list.filter((ref) => referenceCoversInquiryConditions(row, ref));
}

function pickInquiryReferencesForRow(row, catalog) {
  const factQuestion = inquiryNeedsWebSearch(row);
  const picked = pickInquiryKnowledgeReferences(row, catalog, factQuestion
    ? { sameProductLimit: 6, similarLimit: 2 }
    : { sameProductLimit: 8, similarLimit: 6 });
  return filterInquiryReferencesForRow(row, picked);
}

function inquiryNeedsWebSearch(row) {
  const question = getInquiryQuestionText(row);
  if (!question) return false;

  const fact =
    /성분|균주|함량|원료|원산지|제조국|제조사|원단|재질|소재|사이즈|치수|실측|호환|스펙|사양|전압|와트|용량|구성품|세트\s*구성|인증|kc|식약처|사용법|용법|급여량|칼로리|단백질|카페인|도수|중량|무게|크기|가로|세로|높이|몇\s*(ml|g|kg|cm|mm|w|mah)|들어있|포함되|무슨\s*(균|성분|원단|재질|소재|용량)|어떤\s*(균|성분|원단|재질)|차이점|비교|방수|충전|배터리|호환되|포스트바이오틱|프로바이오틱|프리바이오틱/i;

  if (fact.test(question)) return true;
  if (isLogisticsInquiry(row)) return false;
  return false;
}

function hasUsefulLogisticsReference(references) {
  if (!Array.isArray(references) || !references.length) return false;
  const best = references[0];
  if ((best.score || 0) < 4) return false;
  const answer = String(best.answer || best.reply || '');
  return /배송|출고|발송|재고|입고|도착|택배|품절|교환|반품|당일|평일|영업일|\d\s*~\s*\d|\d일/.test(
    answer
  );
}

const INQUIRY_USER_GUIDELINE_LIMIT = 80;

function normalizeUserInquiryGuidelines(list, limit = INQUIRY_USER_GUIDELINE_LIMIT) {
  const out = [];
  const seen = new Set();
  for (const raw of list || []) {
    const question = String(raw?.question || raw?.content || '').replace(/\r\n/g, '\n').trim();
    const answer = String(raw?.answer || raw?.reply || '').replace(/\r\n/g, '\n').trim();
    if (answer.length < 8) continue;
    const sourceId = String(raw?.sourceId || raw?.id || '').trim();
    const key = sourceId || `${question.slice(0, 80)}\n${answer.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: sourceId || `user-guideline-${out.length + 1}`,
      sourceId: sourceId || '',
      question,
      answer,
      product: String(raw?.product || '').trim(),
      updatedAt: Number(raw?.updatedAt) || Date.now(),
    });
    if (out.length >= limit) break;
  }
  return out;
}

function userGuidelinesToCatalog(guidelines) {
  return normalizeUserInquiryGuidelines(guidelines).map((item, index) => ({
    id: item.sourceId || item.id || `user-guideline-${index + 1}`,
    question: item.question,
    content: item.question,
    answer: item.answer,
    reply: item.answer,
    product: item.product || '',
    source: 'user-guideline',
  }));
}

function mergeInquiryReferenceCatalog(catalog, guidelines) {
  const base = Array.isArray(catalog) ? catalog.slice() : [];
  const extra = userGuidelinesToCatalog(guidelines);
  if (!extra.length) return base;
  const ids = new Set(base.map((item) => String(item.id)));
  return [...extra.filter((item) => !ids.has(String(item.id))), ...base];
}

function hasUserInquiryPlaybook(settings = {}) {
  const prompt = String(settings?.inquirySystemPrompt || '').trim();
  if (prompt.length < 40) return false;
  if (typeof isLegacyBuiltinPrompt === 'function' && isLegacyBuiltinPrompt(prompt)) return false;

  const presetId = String(settings?.inquiryTonePresetId || 'default');
  if (presetId === 'inquiry-learned' || presetId === 'custom') return true;

  const mode = String(settings?.inquiryStyleActiveMode || '');
  if (mode === 'pick' || mode === 'paste' || mode === 'custom') return true;

  return false;
}

function shouldDeferInquiryToManual(row, references, settings = {}) {
  if (isEligibilityInquiry(row) && !hasStrongEligibilityReference(row, references)) {
    return true;
  }
  if (Array.isArray(references) && references.length > 0) return false;
  if (hasUserInquiryPlaybook(settings)) return false;
  return true;
}

function getManualInquiryReason(row, references, settings = {}) {
  if (isEligibilityInquiry(row) && !hasStrongEligibilityReference(row, references)) {
    return '가능 여부 문의인데, 같은 조건(연령·상태 등)의 과거 답변이 없습니다. 임의로 「됩니다」라고 쓰지 않습니다. 직접 작성해 주세요. 작성한 답글은 다음 지침으로 저장됩니다.';
  }
  if (Array.isArray(references) && references.length > 0) {
    return getConfirmInquiryReason(row);
  }
  if (hasUserInquiryPlaybook(settings)) {
    return '참고 답변이 부족합니다. 초안을 확인한 뒤 수정해 주세요.';
  }
  return '비슷한 과거 답변·내 응대 지침이 없어 AI가 임의로 쓰지 않습니다. 직접 작성해 주세요. 작성한 답글은 다음 비슷한 문의의 지침으로 저장됩니다.';
}

function shouldLearnEditedInquiryReply(item) {
  const now = String(item?.reply || item?.answer || '').trim();
  if (now.length < 8) return false;
  if (item?.learnAsGuideline || item?.needsManual) return true;

  const previous = String(item?.aiReply || item?.originalReply || '').trim();
  if (!previous || previous === now) return false;

  if (isEligibilityInquiry({ content: item?.inquiryContent || item?.question || '' })) return true;
  if (isDefinitiveInquiryAnswer(previous) || isDefinitiveInquiryAnswer(now)) return true;
  if (item?.needsConfirm) return true;
  return false;
}

function upsertUserInquiryGuidelines(existing, items, limit = INQUIRY_USER_GUIDELINE_LIMIT) {
  const merged = normalizeUserInquiryGuidelines(existing, limit);
  const byId = new Map(merged.map((item) => [String(item.sourceId || item.id), item]));

  for (const raw of items || []) {
    const answer = String(raw?.reply || raw?.answer || '').trim();
    if (answer.length < 8) continue;
    if (!shouldLearnEditedInquiryReply(raw) && !raw?.learnAsGuideline && !raw?.needsManual) continue;

    const question = String(raw?.inquiryContent || raw?.question || raw?.content || '').trim();
    const sourceId = String(raw?.id || raw?.sourceId || '').trim();
    const next = {
      id: sourceId || `user-guideline-${byId.size + 1}`,
      sourceId,
      question,
      answer,
      product: String(raw?.product || '').trim(),
      updatedAt: Date.now(),
    };
    const key = sourceId || `${question.slice(0, 80)}\n${answer.slice(0, 80)}`;
    byId.set(key, next);
  }

  return normalizeUserInquiryGuidelines([...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt), limit);
}

const PRODUCT_TITLE_NOISE =
  /^(무료배송|당일발송|정품|본품|사은품|증정|세트|기획|할인|특가|대용량|국내산|수제|프리미엄|추천|선물|신상|인기|베스트|리뷰|후기|한정|\d+[가-힣a-z%]*|[0-9]+)$/i;

function extractQuestionKeywords(content) {
  const stop =
    /^(이|그|저|좀|요|은|는|을|를|에|의|가|과|와|도|만|부터|까지|인가요|알려주세요|해주세요|있나요|해요|인가|뭐예요|뭐야|무슨|어떤|들어있|포함되)$/;
  return String(content || '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !stop.test(t))
    .slice(0, 4)
    .join(' ');
}

function buildProductSearchKeywords(product, question = '') {
  const raw = String(product || '')
    .replace(/[\[\](){}<>]/g, ' ')
    .replace(/[+/·,]/g, ' ')
    .trim();
  if (!raw) return { brand: '', core: '', queries: [] };

  const tokens = raw.split(/\s+/).filter(Boolean);
  const kept = tokens.filter((t) => !PRODUCT_TITLE_NOISE.test(t));
  const brand = kept[0] || tokens[0] || '';
  const core = kept.slice(0, 3).join(' ') || brand;
  const hint = extractQuestionKeywords(question);

  const queries = [
    core,
    hint ? `${core} ${hint}` : '',
    `${core} 상세`,
    brand && !core.startsWith(brand) ? `${brand} ${core}` : '',
  ].filter((q, i, arr) => q && arr.indexOf(q) === i);

  return { brand, core, queries };
}

function formatSellerReferenceBlock(references = []) {
  const list = Array.isArray(references) ? references.filter((ref) => ref?.answer) : [];
  if (!list.length) return '';
  return [
    '[이 상품에 대한 판매자 과거 답변 — 공개 웹에 없어도 이 상품의 사실·특징으로 사용]',
    ...list.slice(0, 8).map(
      (ref, index) =>
        `[판매자 안내 ${index + 1}]\n문의: ${ref.question || ''}\n답변: ${ref.answer}`
    ),
    '',
  ].join('\n');
}

function buildProductFactLookupPrompt(row, references = []) {
  const product = String(row?.product || '').trim();
  const productNo = String(row?.productNo || '').trim();
  const { brand, core, queries } = buildProductSearchKeywords(product, row?.content);
  const sellerBlock = formatSellerReferenceBlock(references);

  return [
    '당신은 스마트스토어 상품 정보 검증기입니다.',
    '아래 상품에 대해 판매자 과거 답변과 웹에서 공개된 사실을 모아 JSON만 출력하세요.',
    '',
    `상품명(원문): ${product || '(없음)'}`,
    brand ? `브랜드: ${brand}` : '',
    core ? `핵심 상품명: ${core}` : '',
    productNo ? `상품번호: ${productNo}` : '',
    `고객 질문:\n${row?.content || ''}`,
    sellerBlock,
    '',
    '반드시 검색할 항목:',
    '- 고객 질문에 답하는 데 필요한 사실(성분·원단·사이즈·호환·용량·사용법 등 질문에 해당하는 항목)',
    '- 고유명(모델명, 성분명, 규격, 인증명)이 확인되면 그대로 적기',
    '- 질문에 나온 항목이 이 제품에 있는지/없는지, 확인된 범위만',
    '',
    '검색 방법:',
    '- 스마트스토어 제목 전체를 그대로 검색하지 마세요. 옵션·수량·홍보 문구가 섞여 있어 결과가 잘 안 나옵니다.',
    '- 아래 검색어를 순서대로 여러 번 시도하세요.',
    ...queries.map((q) => `  · ${q}`),
    '- 공식몰·브랜드 사이트·보도자료·상세 페이지에서 확인하세요.',
    '',
    '검증 규칙:',
    `- 브랜드 "${brand || ''}"의 같은 제품 정보만 사용하세요.`,
    '- 위에 판매자 과거 답변이 있으면 그것을 1차 자료로 쓰세요. 웹에 없어도 그 상품의 사실입니다.',
    '- 판매자 과거 답변에 있는 스펙·성분·특징·사용법은 facts에 넣으세요.',
    '- 웹 검색과 판매자 안내가 다르면, 이 상품의 판매자 과거 답변을 우선하세요.',
    '- 다른 브랜드·다른 제품·유사 이름의 타 제품 정보는 전부 버리세요.',
    '- 고객이 A를 물었고 확인된 사실에 관련 구성이 있으면, 그 고유명을 facts에 넣으세요. 질문에 없는 카테고리 지식으로 채우지 마세요.',
    '- 고객이 포함·해당 여부를 물었고, 이 제품에 없거나 해당하지 않음이 확인되면 그 부정 사실을 facts에 넣으세요.',
    '- 상세페이지에 대상·연령·용법이 안 적혀 있다는 이유만으로 "명시되어 있지 않음"을 facts나 missing에 넣지 마세요. 판매자 과거 답변이 있으면 그 안내를 facts에 넣으세요.',
    '- 스펙은 모호한 표현 말고 고유명·수치로 적으세요.',
    '- "프리미엄", "엄선된"처럼 이름 없는 표현은 facts에 넣지 마세요.',
    '- 정말 못 찾은 항목만 missing에 적으세요. 관련 사실을 찾았으면 facts를 비우지 마세요.',
    '- 추측·일반론·다른 제품에서 흔한 표현을 이 상품 사실처럼 쓰지 마세요.',
    '',
    '출력은 JSON만:',
    '{"matchedProduct":true,"facts":["사실1"],"missing":["못 찾은 항목"],"discardedOtherProducts":true}',
  ]
    .filter(Boolean)
    .join('\n');
}

function parseProductFactLookup(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return { matchedProduct: false, facts: [], missing: ['검색 결과 없음'] };

  let jsonText = text;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) jsonText = fenced[1].trim();
  else {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) jsonText = text.slice(start, end + 1);
  }

  try {
    const parsed = JSON.parse(jsonText);
    const facts = Array.isArray(parsed.facts)
      ? parsed.facts.map((f) => String(f).trim()).filter(Boolean).slice(0, 12)
      : [];
    const missing = Array.isArray(parsed.missing)
      ? parsed.missing.map((f) => String(f).trim()).filter(Boolean).slice(0, 8)
      : [];
    return {
      matchedProduct: parsed.matchedProduct !== false && facts.length > 0,
      facts,
      missing,
    };
  } catch (_) {
    return { matchedProduct: false, facts: [], missing: ['사실 추출 실패'] };
  }
}

function buildInquiryAnswerRules(options = {}) {
  const webSearch = options.webSearch === true;
  const hasVerifiedFacts = options.hasVerifiedFacts === true;
  const hasSellerRefs = options.hasSellerRefs === true;
  const product = String(options.product || '').trim();
  const isReturn = options.isReturn === true;
  const isEligibility = options.isEligibility === true;

  const returnRules = isReturn
    ? [
        '- 없는 반품 주소·기한·수거 일정·환불 금액은 지어내지 마세요.',
        '- 고객이 "해 주세요"로 처리를 요청한 경우에만 확인 후 안내하겠다고 하세요. 그 전에는 대체 방안만 말하세요.',
      ]
    : [];
  const eligibilityRules = isEligibility
    ? [
        '- 가능 여부 문의입니다. 참고 답변에 고객이 물은 조건(연령·상태 등)이 함께 있을 때만 그 결론을 따르세요.',
        '- 참고에 없는 조건까지 일반화해 "됩니다/안 됩니다"라고 단정하지 마세요.',
      ]
    : [];
  const commonPriorityRules = [
    '- 최우선: 구체 사실은 참고 답변·응대 지침(사장님이 저장한 지침)·확인된 사실·문의문에 있는 것만 쓰세요. 어디에도 없으면 지어내지 마세요.',
    '- 근거에 없으면 그 내용을 빼세요. 추측으로 채우지 마세요.',
    '- 문의에 적힌 질문 그대로 답하세요. 더 넓은 질문으로 바꾸거나 상품 소개로 시작하지 마세요.',
    '- 고객이 처리해 달라고 명확히 요청하지 않은 조치(취소·반품·환불·고객센터·병원 상담)는 제안하지 마세요.',
    '- 죄송·사과 문구는 넣지 마세요. 공감은 짧게 하고 바로 안내하세요.',
    '- "상세페이지를 확인하세요", "다시 남겨 주세요"로 답을 넘기지 마세요.',
    '- 질문하지 않은 스펙 목록은 나열하지 마세요.',
  ];

  if (hasVerifiedFacts || webSearch) {
    return [
      '- 이 문의는 상품 사실(스펙·구성·호환·용량 등)이 필요합니다. 확인된 사실만 쓰세요.',
      '- 문의의 핵심 질문에 첫 1~2문장에서 바로 답하세요. 돌려 말하지 마세요.',
      hasSellerRefs
        ? '- 같은 상품의 과거 판매자 답변에 있는 사실도 확인된 사실로 쓰세요. 웹보다 우선합니다.'
        : product
          ? `- 검색할 때 반드시 상품명 "${product}"을 포함하세요.`
          : '',
      '- 위 "확인된 사실" 중 질문에 필요한 것만 쓰세요.',
      '- 금지 문구: "확인된 정보가 없어", "정확한 안내가 어렵습니다", "담당 부서에 확인 후", "잠시만 기다려 주세요"(사실 문의 회피용).',
      '- 고객이 A 포함 여부를 물었고 확인된 사실에 관련 구성이 있으면: 그 고유명을 말하고, A 자체 포함 여부는 확인된 범위만 말하세요.',
      '- "상세페이지를 확인해 주세요"처럼 확인된 사실을 고객에게 떠넘기지 마세요.',
      '- 확인된 사실에 없는 고유명·함량·개수·출시 월·날짜는 절대 추가하지 마세요.',
      '- 다른 제품·일반 상식으로 빈칸을 채우지 마세요.',
      ...commonPriorityRules,
      ...returnRules,
      ...eligibilityRules,
    ].filter(Boolean);
  }

  return [
    '- 이 문의는 스펙 조사가 아닙니다. 과거 판매자 답변을 분석해 이번 문의에 맞게 새로 쓰세요.',
    '- 비슷한 문의의 결론(가능/주의/방법)과 설명 방식을 따르세요. 일반 상식이나 상품 소개로 새로 만들지 마세요.',
    '- 첫 문장에서 상품이 무엇인지 소개하지 마세요. 물은 조건부터 답하세요.',
    '- "상세페이지를 참고하세요"로 사용법·가능 여부를 떠넘기지 마세요.',
    '- 과거 답변에 없는 상담 권고("전문가/병원에 문의하세요")는 넣지 마세요.',
    hasSellerRefs
      ? '- 과거 답변에 없는 구체 사실(고유명·수치·일정·URL·혜택)은 추가하지 마세요.'
      : '- 참고 답변이 없으면 문의·상품명에 있는 범위만 짧게 답하세요. 없는 사실은 지어내지 마세요.',
    '- 과거 판매자 답변에 있는 안내를, 웹 상세에 없다고 해서 뒤집지 마세요.',
    ...commonPriorityRules,
    ...returnRules,
    ...eligibilityRules,
  ].filter(Boolean);
}
