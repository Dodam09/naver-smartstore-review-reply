function getInquiryQuestionText(row) {
  return String(row?.content || '').trim();
}

function isReturnInquiry(row) {
  const text = getInquiryQuestionText(row);
  if (!text) return false;
  return /교환|반품|환불|취소/.test(text);
}

function isResolutionInquiry(row) {
  const text = getInquiryQuestionText(row);
  if (!text) return false;
  return isReturnInquiry(row) || /변질|상했|파손|불량|지연/.test(text);
}

function isLogisticsInquiry(row) {
  const text = getInquiryQuestionText(row);
  if (!text) return false;
  return /배송|출고|도착|택배|송장|재고|품절|발송|입고|교환|반품|환불|취소|결제|입금|언제\s*(와|오|출발|발송|도착|나와)/.test(
    text
  );
}

function inquiryNeedsConfirm(row) {
  return isReturnInquiry(row) || isLogisticsInquiry(row);
}

function getConfirmInquiryReason(row) {
  const text = getInquiryQuestionText(row);
  if (/교환|반품|환불|취소/.test(text)) {
    return '반품·환불 대신 대체 방안 초안입니다. 확인 후 올려 주세요.';
  }
  if (/재고|품절|입고/.test(text)) {
    return '재고·입고는 확인이 필요해요. 초안의 일정·수량을 검토해 주세요.';
  }
  if (/배송|출고|발송|도착|택배|송장|언제/.test(text)) {
    return '배송·출고 일정은 확인이 필요해요. 초안의 날짜·안내를 검토해 주세요.';
  }
  return '확인이 필요한 문의입니다. 초안을 검토한 뒤 올려 주세요.';
}

function pickInquiryReferencesForRow(row, catalog) {
  const factQuestion = inquiryNeedsWebSearch(row);
  return pickInquiryKnowledgeReferences(row, catalog, factQuestion
    ? { sameProductLimit: 6, similarLimit: 2 }
    : { sameProductLimit: 8, similarLimit: 6 });
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

function shouldDeferInquiryToManual() {
  return false;
}

function getManualInquiryReason(row) {
  return getConfirmInquiryReason(row);
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

  const returnRules = isReturn
    ? [
        '- 불편에는 짧게 공감하되, 죄송·사과 문구는 넣지 마세요.',
        '- 반품·환불·취소를 제안하거나 진행하지 마세요. 대체 방안만 안내하세요.',
        '- 대체 방안은 같은 상품의 과거 판매자 답변을 따르세요. (일정 안내, 보관·사용 방법, 기다려 달라는 안내 등)',
        '- 고객이 "해 주세요"처럼 처리 요청을 명확히 하지 않았다면 취소·반품·환불 단어를 쓰지 마세요. "혹시 원하시면"도 금지입니다.',
        '- 명확한 처리 요청이 있을 때만, 가능 여부를 단정하지 말고 확인 후 안내하겠다고 하세요.',
        '- "다시 남겨 주세요", "고객센터로 연락 주세요"로 답을 넘기지 마세요.',
        '- 없는 반품 주소·기한·수거 일정·환불 금액은 지어내지 마세요.',
      ]
    : [];
  const commonPriorityRules = [
    '- 죄송·사과 문구는 넣지 마세요. 공감은 짧게 하고 안내로 이어가세요.',
    '- 문의에 적힌 조건 그대로 답하세요. 더 넓은 질문으로 바꿔 답하지 마세요.',
    '- 상품 소개나 종류 설명으로 질문을 대체하지 마세요.',
    '- 질문하지 않은 스펙·구성 목록을 나열하지 마세요. 질문에 필요한 내용만 쓰세요.',
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
      '- 확인된 사실에 없는 고유명·함량·개수는 절대 추가하지 마세요.',
      '- 다른 제품·일반 상식으로 빈칸을 채우지 마세요.',
      ...commonPriorityRules,
      ...returnRules,
    ].filter(Boolean);
  }

  return [
    '- 이 문의는 스펙 조사가 아닙니다. 과거 판매자 답변을 분석해 이번 문의에 맞게 새로 쓰세요.',
    '- 비슷한 문의의 결론(가능/주의/방법)과 설명 방식을 따르세요. 일반 상식이나 상품 소개로 새로 만들지 마세요.',
    '- 첫 문장에서 상품이 무엇인지 소개하지 마세요. 물은 조건부터 답하세요.',
    '- "상세페이지를 참고하세요"로 사용법·가능 여부를 떠넘기지 마세요.',
    '- 과거 답변에 없는 상담 권고("전문가/병원에 문의하세요")는 넣지 마세요.',
    hasSellerRefs
      ? '- 과거 답변에 없는 고유명·수치는 추가하지 마세요.'
      : '- 참고 답변이 없으면 문의·상품명에 있는 범위만 짧게 답하세요. 없는 사실은 지어내지 마세요.',
    '- 과거 판매자 답변에 있는 안내를, 웹 상세에 없다고 해서 뒤집지 마세요.',
    ...commonPriorityRules,
    ...returnRules,
  ];
}
