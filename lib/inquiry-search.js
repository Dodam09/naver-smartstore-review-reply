function getInquiryQuestionText(row) {
  return String(row?.content || '').trim();
}

function isLogisticsInquiry(row) {
  const text = getInquiryQuestionText(row);
  if (!text) return false;
  return /배송|출고|도착|택배|송장|재고|품절|발송|입고|교환|반품|환불|취소|결제|입금|언제\s*(와|오|출발|발송|도착|나와)/.test(
    text
  );
}

function inquiryNeedsWebSearch(row) {
  const text = `${getInquiryQuestionText(row)} ${row?.product || ''}`;
  if (!getInquiryQuestionText(row)) return false;

  const fact =
    /성분|균주|함량|원료|원산지|제조국|제조사|원단|재질|소재|사이즈|치수|실측|호환|스펙|사양|전압|와트|용량|구성품|세트\s*구성|인증|kc|식약처|사용법|용법|급여량|알레르기|알러지|칼로리|단백질|카페인|도수|중량|무게|크기|가로|세로|높이|몇\s*(ml|g|kg|cm|mm|w|mah)|들어있|포함되|무슨\s*(균|성분|원단|재질|소재|용량)|어떤\s*(균|성분|원단|재질)|차이점|비교|효능|효과|방수|충전|배터리|호환되|포스트바이오틱|프로바이오틱|프리바이오틱/i;

  if (fact.test(text)) return true;
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

function shouldDeferInquiryToManual(row, references) {
  if (!isLogisticsInquiry(row)) return false;
  return !hasUsefulLogisticsReference(references);
}

function getManualInquiryReason(row) {
  const text = getInquiryQuestionText(row);
  if (/재고|품절|입고/.test(text)) return '재고·입고는 확인이 필요해 직접 작성해 주세요.';
  if (/배송|출고|발송|도착|택배|송장|언제/.test(text)) {
    return '배송·출고 일정은 확인이 필요해 직접 작성해 주세요.';
  }
  if (/교환|반품|환불|취소/.test(text)) {
    return '교환·반품 안내는 확인이 필요해 직접 작성해 주세요.';
  }
  return '비슷한 과거 답변이 없어 직접 작성해 주세요.';
}

function buildProductFactLookupPrompt(row) {
  const product = String(row?.product || '').trim();
  const productNo = String(row?.productNo || '').trim();
  return [
    '당신은 스마트스토어 상품 정보 검증기입니다.',
    '아래 상품에 대해서만 웹에서 공개된 사실을 찾고, JSON만 출력하세요.',
    '',
    `상품명: ${product || '(없음)'}`,
    productNo ? `상품번호: ${productNo}` : '',
    `고객 질문:\n${row?.content || ''}`,
    '',
    '검색·검증 규칙:',
    `- 검색어에 상품명 "${product || ''}"을 반드시 포함하세요.`,
    '- 이 상품명·브랜드와 일치하는 공식몰/상세/보도자료만 사용하세요.',
    '- 다른 브랜드·다른 제품·사람용 유산균·유사 이름의 타 제품 정보는 전부 버리세요.',
    '- 질문에 답하는 데 필요한 확인된 사실만 facts에 넣으세요.',
    '- 균주·성분·스펙은 모호한 표현 말고 고유명으로 적으세요. 예: "KT-11", "Lactobacillus crispatus".',
    '- "프리미엄 균주", "엄선된 유산균"처럼 이름 없는 표현은 facts에 넣지 마세요.',
    '- 확실하지 않으면 facts에 넣지 말고 missing에 적으세요.',
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
  const product = String(options.product || '').trim();

  if (hasVerifiedFacts) {
    return [
      '- 문의의 핵심 질문에 첫 1~2문장에서 바로 답하세요. 돌려 말하지 마세요.',
      '- 위 "확인된 사실"에 있는 균주명·성분명·수치·스펙은 답글에 고유명으로 반드시 포함하세요.',
      '- "상세페이지를 확인해 주세요", "균주 정보를 다시 보시면"처럼 확인된 사실을 고객에게 떠넘기지 마세요.',
      '- "엄선된 균주들", "프리미엄 유산균"처럼 이름 없이 애둘러 쓰지 마세요. 확인된 이름이 있으면 그 이름을 쓰세요.',
      '- 확인된 사실에 없는 균주명·성분명·함량·개수는 절대 추가하지 마세요.',
      '- 다른 제품·일반 상식으로 빈칸을 채우지 마세요.',
      '- 확인되지 않은 항목만 짧게 확인 후 안내하겠다고 말하세요.',
    ];
  }

  if (webSearch) {
    return [
      '- 문의의 핵심 질문에 바로 답하세요. 돌려 말하지 마세요.',
      `- 검색할 때 반드시 상품명 "${product}"을 포함하세요.`,
      '- 이 상품(동일 브랜드·제품명)의 공식/상세 정보만 사용하세요. 다른 제품 정보는 버리세요.',
      '- 확인된 균주·성분·수치는 고유명으로 바로 말하고, 상세페이지 확인을 떠넘기지 마세요.',
      '- 없는 균주·성분·수치는 지어내지 마세요.',
    ];
  }

  return [
    '- 문의에 적힌 질문에 직접 답하세요.',
    '- 문의·상품명·참고 답변에 있는 정보로만 답하세요. 없는 수치·스펙은 지어내지 마세요.',
    '- 배송·재고·출고는 참고 답변에 있는 안내만 따르고, 없는 일정·재고 숫자는 지어내지 마세요.',
    '- 확인이 더 필요하면 그 부분만 확인 후 안내하겠다고 하세요.',
    '- 질문과 무관한 광고 문구로 둘러대지 마세요.',
  ];
}
