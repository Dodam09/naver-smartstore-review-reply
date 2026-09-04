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
  const question = String(row?.content || '').trim();
  if (!question) return false;

  const fact =
    /성분|균주|함량|원료|원산지|제조국|제조사|원단|재질|소재|사이즈|치수|실측|호환|스펙|사양|전압|와트|용량|구성품|세트\s*구성|인증|kc|식약처|사용법|용법|급여량|칼로리|단백질|카페인|도수|중량|무게|크기|가로|세로|높이|몇\s*(ml|g|kg|cm|mm|w|mah)|들어있|포함되|무슨\s*(균|성분|원단|재질|소재|용량)|어떤\s*(균|성분|원단|재질)|차이점|비교|방수|충전|배터리|호환되|포스트바이오틱|프로바이오틱|프리바이오틱/i;

  const logistics =
    /배송|출고|도착|택배|송장|재고|품절|발송|입고|교환|반품|환불|취소|결제|입금|언제\s*(와|오|출발|발송|도착|나와)/;

  if (fact.test(question)) return true;
  if (logistics.test(question)) return false;
  return false;
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

export function buildProductSearchKeywords(product, question = '') {
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

export function buildProductFactLookupPrompt(row, references = []) {
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
          '아래는 이 상품(또는 비슷한 문의)에 대한 실제 판매자 답변입니다.',
          '말투뿐 아니라 상품 정보·특징으로 사용하세요. 웹에 없는 판매자만 아는 안내(사용법, 구성 차이, 후기에서 확인한 특징 등)가 있으면 새 문의에 맞게 활용하세요.',
          '다른 상품 답변의 스펙은 가져오지 마세요. 과거 답에 없는 고유명·수치는 지어내지 마세요.',
          ...references.map(
            (ref, index) =>
              `[참고 ${index + 1}${ref.product ? ` · ${ref.product}` : ''}]\n문의: ${ref.question}\n답변: ${ref.answer}`
          ),
          '',
        ].join('\n')
      : '';

  const factBlock =
    verifiedFacts && verifiedFacts.length
      ? [
          '[이 상품에서 확인된 사실 — 질문에 답할 때만 쓰세요. 질문과 무관한 스펙은 나열하지 마세요]',
          ...verifiedFacts.map((f, i) => `${i + 1}. ${f}`),
          '',
        ].join('\n')
      : verifiedFacts
        ? '[확인된 사실 없음 — 구체 스펙·고유명·수치를 절대 지어내지 마세요. 다만 "담당 부서 확인"으로 답 전체를 대체하지 마세요.]\n'
        : '';

  const missingBlock =
    missingFacts.length > 0
      ? `[확인되지 않은 항목]\n${missingFacts.map((f) => `- ${f}`).join('\n')}\n`
      : '';

  const hasFacts = Array.isArray(verifiedFacts) && verifiedFacts.length > 0;
  const hasSellerRefs = references.length > 0;
  const isReturn = /교환|반품|환불|취소/.test(String(row?.content || ''));
  const isSuitability =
    /먹어도|먹여도|섭취|급여|사용해도|써도\s*(돼|되)|가능한가|괜찮을까|해도\s*될|해도\s*되|개월|몇\s*살|\d+\s*살|연령|나이|노견|노령|지간염|피부염|아토피|알러지|알레르기|설사|변비|질환/.test(
      String(row?.content || '')
    );
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
  const rules = verifiedFacts
    ? [
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
        hasFacts
          ? '- 확인되지 않은 항목이 있으면, 확인된 내용을 말한 뒤에만 그 항목을 짧게 보완 안내하세요.'
          : hasSellerRefs
            ? '- 웹에서 확인된 사실이 없어도, 같은 상품의 과거 판매자 답변에 있는 정보로 답하세요. 담당 부서 확인으로 미루지 마세요.'
            : '- 확인된 사실이 없을 때만, 공개 정보에서 확인하지 못했다고 짧게 말하고 지어내지 마세요. 담당 부서 확인으로 미루지 마세요.',
        ...returnRules,
        ...suitabilityRules,
      ]
    : webSearch
      ? [
          '- 문의의 핵심 질문에 바로 답하세요. 돌려 말하지 마세요.',
          hasSellerRefs
            ? '- 같은 상품의 과거 판매자 답변을 1차 자료로 쓰고, 웹 검색은 부족한 부분만 보완하세요.'
            : `- 검색할 때 반드시 상품명 "${String(row?.product || '').trim()}"을 포함하세요.`,
          '- 이 상품(동일 브랜드·제품명)의 공식/상세 정보와 판매자 과거 답변만 사용하세요. 다른 제품 정보는 버리세요.',
          '- 확인된 고유명·수치·스펙은 바로 말하고, 상세페이지 확인을 떠넘기지 마세요.',
          '- 없는 스펙·수치는 지어내지 마세요.',
          '- "담당 부서에 확인 후", "확인된 정보가 없어 안내가 어렵습니다"로 답 전체를 대체하지 마세요.',
          ...returnRules,
          ...suitabilityRules,
        ]
      : [
          '- 문의의 핵심 질문에 바로 답하세요.',
          '- 문의·상품명·참고 답변에 있는 정보로만 답하세요. 없는 수치·스펙은 지어내지 마세요.',
          hasSellerRefs
            ? '- 같은 상품의 과거 판매자 답변에 있는 특징·스펙·사용 안내는 웹에 없어도 사용하세요.'
            : '- 확인이 더 필요하면 그 부분만 확인 후 안내하겠다고 하세요.',
          '- 질문과 무관한 광고 문구로 둘러대지 마세요.',
          ...returnRules,
          ...suitabilityRules,
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
