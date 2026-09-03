export function normalizeSamples(samples) {
  const unique = [];
  const seen = new Set();
  for (const raw of samples || []) {
    const s = String(raw).replace(/\r\n/g, '\n').trim();
    if (s.length < 8) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    unique.push(s);
  }
  return unique.slice(0, 20);
}

export function buildAnalyzeMetaPrompt(context, normalizedSamples) {
  const sampleBlock = normalizedSamples.map((s, i) => `[${i + 1}]\n${s}`).join('\n\n');
  const isInquiry = context === 'inquiry';

  if (isInquiry) {
    return `당신은 네이버 스마트스토어 판매자 답글 스타일 분석 전문가입니다.
아래는 실제 사장님이 작성한 **상품문의** 판매자 답글 샘플입니다. 말투, 문장 길이, 인사·안내 표현, 이모지 사용, 종결어미, 자주 쓰는 표현, 피해야 할 표현을 분석한 뒤, 같은 스타일로 고객 상품문의 답글을 작성하게 할 **시스템 지시문(system instruction)** 을 한국어로 작성하세요.

규칙:
- 출력은 시스템 지시문 본문만 (설명·제목·따옴표·마크다운 없이)
- 5~12문장 분량
- "복붙 티 나지 않게", "문의 내용의 질문에 구체적으로 답변"을 반드시 포함
- 공개된 상품 정보는 문의 질문에 맞게 검색해 확인된 사실을 답하도록 지시. 확인되지 않은 사실은 지어내지 말 것
- 리뷰 감사 인사 위주가 아닌, 문의 Q&A·안내 톤으로 작성하도록 지시
- 샘플에 없는 이모지·유행어를 무리하게 추가하지 말 것
- 스마트스토어 상품문의 판매자 답글임을 명시

샘플 답글:
${sampleBlock}`;
  }

  return `당신은 네이버 스마트스토어 판매자 답글 스타일 분석 전문가입니다.
아래는 실제 사장님이 작성한 판매자 답글 샘플입니다. 말투, 문장 길이, 인사·감사 표현, 이모지 사용, 종결어미, 자주 쓰는 표현, 피해야 할 표현을 분석한 뒤, 같은 스타일로 고객 리뷰 답글을 작성하게 할 **시스템 지시문(system instruction)** 을 한국어로 작성하세요.

규칙:
- 출력은 시스템 지시문 본문만 (설명·제목·따옴표·마크다운 없이)
- 5~12문장 분량
- "복붙 티 나지 않게", "리뷰 내용에 구체적으로 반응"을 반드시 포함
- 샘플에 없는 이모지·유행어를 무리하게 추가하지 말 것
- 스마트스토어 판매자 답글임을 명시

샘플 답글:
${sampleBlock}`;
}

export function buildReviewUserContent(row) {
  return [
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
}

export function inquiryNeedsWebSearch(row) {
  const text = `${row?.content || ''} ${row?.product || ''}`;
  if (!String(row?.content || '').trim()) return false;

  const fact =
    /성분|균주|함량|원료|원산지|제조국|제조사|원단|재질|소재|사이즈|치수|실측|호환|스펙|사양|전압|와트|용량|구성품|세트\s*구성|인증|kc|식약처|사용법|용법|급여량|알레르기|알러지|칼로리|단백질|카페인|도수|중량|무게|크기|가로|세로|높이|몇\s*(ml|g|kg|cm|mm|w|mah)|들어있|포함되|무슨\s*(균|성분|원단|재질|소재|용량)|어떤\s*(균|성분|원단|재질)|차이점|비교|효능|효과|방수|충전|배터리|호환되|포스트바이오틱|프로바이오틱|프리바이오틱/i;

  const logistics =
    /배송|출고|도착|택배|송장|재고|품절|발송|입고|교환|반품|환불|취소|결제|입금|언제\s*(와|오|출발|발송|도착|나와)/;

  if (fact.test(text)) return true;
  if (logistics.test(text)) return false;
  return false;
}

export function buildProductFactLookupPrompt(row) {
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
    '반드시 검색할 항목:',
    '- 프로바이오틱스/유산균 균주명(예: KT-11, Lactobacillus crispatus)',
    '- 프리바이오틱스·소화효소 등 함께 배합된 성분',
    '- 포스트바이오틱스(사균체·대사산물)를 별도 원료로 넣는지 여부',
    '',
    '검색·검증 규칙:',
    `- 검색어에 상품명 "${product || ''}"을 반드시 포함하세요. 필요하면 "균주", "KT-11", "프로바이오틱스", "보도"도 같이 검색하세요.`,
    '- 이 상품명·브랜드와 일치하는 공식몰/상세/보도자료만 사용하세요.',
    '- 다른 브랜드·다른 제품·사람용 유산균·유사 이름의 타 제품 정보는 전부 버리세요.',
    '- 고객이 포스트바이오틱스를 물어도, 이 제품의 프로바이오틱스 균주·프리바이오틱스·효소 정보는 facts에 넣으세요.',
    '- "상세/보도에 포스트바이오틱스 원료 배합이 명시되지 않음"처럼 확인된 부정 사실도 facts에 넣으세요.',
    '- 균주·성분·스펙은 모호한 표현 말고 고유명으로 적으세요. 예: "KT-11", "Lactobacillus crispatus".',
    '- "프리미엄 균주", "엄선된 유산균"처럼 이름 없는 표현은 facts에 넣지 마세요.',
    '- 정말 못 찾은 항목만 missing에 적으세요. 관련 성분을 찾았으면 facts를 비우지 마세요.',
    '- 추측·일반론·다른 제품에서 흔한 표현(예: 17종 혼합)을 이 상품 사실처럼 쓰지 마세요.',
    '',
    '출력은 JSON만 (설명·마크다운 금지):',
    '{"matchedProduct":true,"facts":["사실1"],"missing":["못 찾은 항목"],"discardedOtherProducts":true}',
  ]
    .filter(Boolean)
    .join('\n');
}

export function parseProductFactLookup(rawText) {
  const text = String(rawText || '').trim();
  if (!text) {
    return { matchedProduct: false, facts: [], missing: ['검색 결과 없음'] };
  }

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

export function buildInquiryUserContent(row, references = [], options = {}) {
  const webSearch = options.webSearch === true;
  const verifiedFacts = Array.isArray(options.verifiedFacts) ? options.verifiedFacts : null;
  const missingFacts = Array.isArray(options.missingFacts) ? options.missingFacts : [];
  const refBlock =
    references.length > 0
      ? [
          '아래는 비슷한 과거 상품문의와 실제 판매자 답변입니다. 말투·안내 방식을 참고하되, 새 문의에 맞게 작성하세요.',
          ...references.map(
            (ref, index) =>
              `[참고 ${index + 1}]\n문의: ${ref.question}\n답변: ${ref.answer}`
          ),
          '',
        ].join('\n')
      : '';

  const factBlock =
    verifiedFacts && verifiedFacts.length
      ? [
          '[이 상품에서 확인된 사실 — 질문에 해당하면 답글 본문에 고유명으로 반드시 쓰세요]',
          ...verifiedFacts.map((f, i) => `${i + 1}. ${f}`),
          '',
        ].join('\n')
      : verifiedFacts
        ? '[확인된 사실 없음 — 구체 성분·균주·수치를 절대 지어내지 마세요. 다만 "담당 부서 확인"으로 답 전체를 대체하지 마세요.]\n'
        : '';

  const missingBlock =
    missingFacts.length > 0
      ? `[확인되지 않은 항목]\n${missingFacts.map((f) => `- ${f}`).join('\n')}\n`
      : '';

  const hasFacts = Array.isArray(verifiedFacts) && verifiedFacts.length > 0;
  const rules = verifiedFacts
    ? [
        '- 문의의 핵심 질문에 첫 1~2문장에서 바로 답하세요. 돌려 말하지 마세요.',
        '- 위 "확인된 사실"이 하나라도 있으면 그걸로 먼저 답하세요. 답글 전체를 "확인 불가/담당 부서 확인"으로 대체하지 마세요.',
        '- 금지 문구: "확인된 정보가 없어", "정확한 안내가 어렵습니다", "담당 부서에 확인 후", "잠시만 기다려 주세요"(사실 문의 회피용).',
        '- 고객이 포스트바이오틱스를 물었고 확인된 사실에 프로바이오틱스 균주가 있으면: 이 제품은 프로바이오틱스(및 관련 성분) 제품이며 해당 균주명을 말하고, 포스트바이오틱스 별도 원료 여부는 확인된 범위만 말하세요.',
        '- 위 "확인된 사실"에 있는 균주명·성분명·수치·스펙은 답글에 고유명으로 반드시 포함하세요.',
        '- "상세페이지를 확인해 주세요", "균주 정보를 다시 보시면"처럼 확인된 사실을 고객에게 떠넘기지 마세요.',
        '- "엄선된 균주들", "프리미엄 유산균"처럼 이름 없이 애둘러 쓰지 마세요. 확인된 이름이 있으면 그 이름을 쓰세요.',
        '- 확인된 사실에 없는 균주명·성분명·함량·개수(예: 17종)는 절대 추가하지 마세요.',
        '- 다른 제품·일반 상식으로 빈칸을 채우지 마세요.',
        hasFacts
          ? '- 확인되지 않은 항목이 있으면, 확인된 내용을 말한 뒤에만 그 항목을 짧게 보완 안내하세요.'
          : '- 확인된 사실이 없을 때만, 공개 정보에서 확인하지 못했다고 짧게 말하고 지어내지 마세요. 담당 부서 확인으로 미루지 마세요.',
      ]
    : webSearch
      ? [
          '- 문의의 핵심 질문에 바로 답하세요. 돌려 말하지 마세요.',
          `- 검색할 때 반드시 상품명 "${String(row?.product || '').trim()}"을 포함하세요.`,
          '- 이 상품(동일 브랜드·제품명)의 공식/상세 정보만 사용하세요. 다른 제품 정보는 버리세요.',
          '- 확인된 균주·성분·수치는 고유명으로 바로 말하고, 상세페이지 확인을 떠넘기지 마세요.',
          '- 없는 균주·성분·수치는 지어내지 마세요.',
          '- "담당 부서에 확인 후", "확인된 정보가 없어 안내가 어렵습니다"로 답 전체를 대체하지 마세요.',
        ]
      : [
          '- 문의의 핵심 질문에 바로 답하세요.',
          '- 문의·상품명·참고 답변에 있는 정보로만 답하세요. 없는 수치·스펙은 지어내지 마세요.',
          '- 확인이 더 필요하면 그 부분만 확인 후 안내하겠다고 하세요.',
          '- 질문과 무관한 광고 문구로 둘러대지 마세요.',
        ];

  return [
    refBlock,
    factBlock,
    missingBlock,
    row.product && `상품명: ${row.product}`,
    row.productNo && `상품번호: ${row.productNo}`,
    row.writer && `문의자: ${row.writer}`,
    row.secret != null && `비밀문의: ${row.secret ? '예' : '아니오'}`,
    `문의 내용:\n${row.content}`,
    '작성 규칙:',
    ...rules,
    '위 상품문의에 대한 판매자 답글만 출력하세요. 따옴표나 접두어 없이 본문만.',
  ]
    .filter(Boolean)
    .join('\n');
}
