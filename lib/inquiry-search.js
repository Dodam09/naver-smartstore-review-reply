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
    return '반품·교환은 판매자가 한 번 확인해야 해요. 초안을 검토한 뒤 올려 주세요.';
  }
  if (/재고|품절|입고/.test(text)) {
    return '재고·입고는 확인이 필요해요. 초안의 일정·수량을 검토해 주세요.';
  }
  if (/배송|출고|발송|도착|택배|송장|언제/.test(text)) {
    return '배송·출고 일정은 확인이 필요해요. 초안의 날짜·안내를 검토해 주세요.';
  }
  return '확인이 필요한 문의입니다. 초안을 검토한 뒤 올려 주세요.';
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
    '- 확인된 부정 사실(이 제품에 해당 원료/기능이 명시되지 않음)도 facts에 넣으세요.',
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
  const isSuitability = options.isSuitability === true;

  const returnRules = isReturn
    ? [
        '- 불편·증상에는 먼저 공감하세요.',
        '- 반품·교환 가능 여부는 단정하지 마세요. 확인 후 진행하겠다고 안내하세요.',
        '- 반품 신청 방법(이 문의 회신, 주문내역, 고객센터 등)은 과거 판매자 답변이 있으면 그대로 따르고, 없으면 이 문의로 남겨주시면 확인 후 안내하겠다고 하세요.',
        '- 없는 반품 주소·기한·수거 일정·환불 금액은 지어내지 마세요.',
      ]
    : [];
  const suitabilityRules = isSuitability
    ? [
        '- 가능 여부·주의사항을 첫 문장에서 답하세요. 성분·스펙 나열로 시작하지 마세요.',
        '- 같은 상품의 과거 판매자 답변에 연령·급여·증상 안내가 있으면 그 안내를 따르세요.',
        '- 과거 답변으로 가능하다고 안내된 내용을, 웹 상세에 없다고 뒤집어 "명시되어 있지 않습니다"라고 하지 마세요.',
        '- 질문하지 않은 전 성분·균주·배제 원료 목록을 나열하지 마세요. 질문에 도움이 되는 특징만 짧게 덧붙이세요.',
        '- 의학적 진단·완치 단정은 하지 마세요. 과거 판매자가 안내한 범위에서만 말하세요.',
      ]
    : [];

  if (hasVerifiedFacts) {
    return [
      '- 문의의 핵심 질문에 첫 1~2문장에서 바로 답하세요. 돌려 말하지 마세요.',
      hasSellerRefs
        ? '- 같은 상품의 과거 판매자 답변은 1차 자료입니다. 웹 검색보다 우선하고, 질문에 필요한 내용만 쓰세요.'
        : '',
      '- 위 "확인된 사실" 중 질문에 필요한 것만 쓰세요. 질문과 무관한 스펙은 나열하지 마세요.',
      '- 금지 문구: "확인된 정보가 없어", "정확한 안내가 어렵습니다", "담당 부서에 확인 후", "잠시만 기다려 주세요"(사실 문의 회피용).',
      '- 고객이 A 포함 여부를 물었고 확인된 사실에 관련 구성이 있으면: 그 고유명을 말하고, A 자체 포함 여부는 확인된 범위만 말하세요. 카테고리 일반론으로 빈칸을 채우지 마세요.',
      '- "상세페이지를 확인해 주세요"처럼 확인된 사실을 고객에게 떠넘기지 마세요.',
      '- "프리미엄", "엄선된"처럼 이름 없이 애둘러 쓰지 마세요. 확인된 이름이 있으면 그 이름을 쓰세요.',
      '- 확인된 사실에 없는 고유명·함량·개수는 절대 추가하지 마세요.',
      '- 다른 제품·일반 상식으로 빈칸을 채우지 마세요.',
      '- 확인되지 않은 항목이 있으면, 확인된 내용을 말한 뒤에만 그 항목을 짧게 보완 안내하세요.',
      ...returnRules,
      ...suitabilityRules,
    ].filter(Boolean);
  }

  if (webSearch) {
    return [
      '- 문의의 핵심 질문에 바로 답하세요. 돌려 말하지 마세요.',
      hasSellerRefs
        ? '- 같은 상품의 과거 판매자 답변을 1차 자료로 쓰고, 웹 검색은 부족한 부분만 보완하세요.'
        : `- 검색할 때 반드시 상품명 "${product}"을 포함하세요.`,
      '- 이 상품(동일 브랜드·제품명)의 공식/상세 정보와 판매자 과거 답변만 사용하세요. 다른 제품 정보는 버리세요.',
      '- 확인된 고유명·수치·스펙은 바로 말하고, 상세페이지 확인을 떠넘기지 마세요.',
      '- 없는 스펙·수치는 지어내지 마세요.',
      '- "담당 부서에 확인 후", "확인된 정보가 없어 안내가 어렵습니다"로 답 전체를 대체하지 마세요.',
      ...returnRules,
      ...suitabilityRules,
    ];
  }

  return [
    '- 문의에 적힌 질문에 직접 답하세요.',
    '- 문의·상품명·참고 답변에 있는 정보로만 답하세요. 없는 수치·스펙은 지어내지 마세요.',
    hasSellerRefs
      ? '- 같은 상품의 과거 판매자 답변에 있는 특징·스펙·사용 안내는 웹에 없어도 사용하세요.'
      : '- 배송·재고·출고는 참고 답변에 있는 안내만 따르고, 없는 일정·재고 숫자는 지어내지 마세요.',
    '- 확인이 더 필요하면 그 부분만 확인 후 안내하겠다고 하세요.',
    '- 질문과 무관한 광고 문구로 둘러대지 마세요.',
    ...returnRules,
    ...suitabilityRules,
  ];
}
