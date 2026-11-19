import {
  TONE_V2_VERSION,
  buildAnalyzeMetaPrompt,
  buildAnalyzeToneV2Prompt,
  getDefaultToneProfile,
  isValidToneProfile,
  normalizeToneProfile,
  parseToneProfileJson,
  renderToneProfileToSystemPrompt,
  resolveToneSystemPrompt,
  sanitizeLearnedStylePrompt,
  stripPolicyPromiseLines,
} from './tone-profile.js';

export {
  TONE_V2_VERSION,
  buildAnalyzeMetaPrompt,
  buildAnalyzeToneV2Prompt,
  getDefaultToneProfile,
  isValidToneProfile,
  normalizeToneProfile,
  parseToneProfileJson,
  renderToneProfileToSystemPrompt,
  resolveToneSystemPrompt,
  sanitizeLearnedStylePrompt,
  stripPolicyPromiseLines,
};

export function normalizeInquiryPairs(pairs, limit = 40) {
  const unique = [];
  const seen = new Set();
  for (const raw of pairs || []) {
    const question = String(raw?.question || raw?.content || '').replace(/\r\n/g, '\n').trim();
    const answer = String(raw?.answer || raw?.reply || '').replace(/\r\n/g, '\n').trim();
    if (answer.length < 8) continue;
    const key = `${question.slice(0, 80)}\n${answer.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({
      question,
      answer,
      productNo: String(raw?.productNo || '').trim(),
      productName: String(raw?.productName || raw?.product || '').trim(),
    });
    if (unique.length >= limit) break;
  }
  return unique;
}

/** 답변 완료 Q&A → 상품·배송 초안(판매자 확인용). 추측·효능 확정 금지. */
export function buildInquiryKnowledgeDraftPrompt(pairs) {
  const list = normalizeInquiryPairs(pairs, 30);
  const blocks = list.map((item, i) => {
    const meta = [
      item.productNo ? `상품번호: ${item.productNo}` : '',
      item.productName ? `상품명: ${item.productName}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    return [
      `### 페어 ${i + 1}${meta ? ` (${meta})` : ''}`,
      `[문의]\n${item.question || '(문의문 없음)'}`,
      `[판매자 답변]\n${item.answer}`,
    ].join('\n');
  });

  return [
    '역할: 스마트스토어 판매자의 과거 상품문의 Q&A만 보고, 상품·배송 지식 **초안**을 JSON으로 정리합니다.',
    '이 초안은 자동 확정이 아닙니다. 판매자가 확인·수정한 뒤에만 사실로 씁니다.',
    '',
    '규칙:',
    '- 판매자 답변에 **명시된 내용만** 적습니다. 문의문에만 있고 답에 확인되지 않은 스펙·일정은 넣지 않습니다.',
    '- 확실하지 않으면 빈 문자열("")로 둡니다. 추측·일반론·효능·치료·예방 주장을 만들지 않습니다.',
    '- 개별 주문 송장·출고일·도착 예정처럼 그때그때 달라지는 상태는 정책 초안에 넣지 않습니다.',
    '- 상품이 여러 개면 products 배열에 나눕니다. 상품번호를 알면 productNo에 넣고, 모르면 비웁니다.',
    '- policies는 스토어 공통(배송비·교환·환불·CS)만. 상품별 주의사항은 products.cautions에 둡니다.',
    '- warnings에는 모순·불확실·효능 언급 등 판매자가 확인할 메모를 짧게 적습니다.',
    '',
    '출력: JSON 객체만. 설명·마크다운·코드펜스 금지.',
    '{',
    '  "products": [',
    '    {',
    '      "productNo": "",',
    '      "productName": "",',
    '      "detailDescription": "",',
    '      "specs": "",',
    '      "usage": "",',
    '      "optionsCompat": "",',
    '      "cautions": "",',
    '      "extra": "",',
    '      "confidence": "low|medium|high"',
    '    }',
    '  ],',
    '  "policies": {',
    '    "shipping": "",',
    '    "exchangeReturn": "",',
    '    "refund": "",',
    '    "customerService": "",',
    '    "confidence": "low|medium|high"',
    '  },',
    '  "warnings": []',
    '}',
    '',
    '[과거 문의 Q&A]',
    blocks.join('\n\n') || '(없음)',
  ].join('\n');
}

function clipDraftText(value, max = 1200) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, max);
}

export function parseInquiryKnowledgeDraft(raw) {
  const text = String(raw || '')
    .replace(/```json/gi, '```')
    .replace(/```/g, '')
    .trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return {
      products: [],
      policies: {
        shipping: '',
        exchangeReturn: '',
        refund: '',
        customerService: '',
        confidence: 'low',
      },
      warnings: ['초안 JSON을 읽지 못했습니다. 다시 시도해 주세요.'],
      parseFailed: true,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return {
      products: [],
      policies: {
        shipping: '',
        exchangeReturn: '',
        refund: '',
        customerService: '',
        confidence: 'low',
      },
      warnings: ['초안 JSON 파싱에 실패했습니다.'],
      parseFailed: true,
    };
  }

  const conf = (v) => {
    const s = String(v || '').toLowerCase();
    return s === 'high' || s === 'medium' || s === 'low' ? s : 'low';
  };

  const products = (Array.isArray(parsed.products) ? parsed.products : [])
    .slice(0, 8)
    .map((p) => ({
      productNo: clipDraftText(p?.productNo, 64),
      productName: clipDraftText(p?.productName, 200),
      detailDescription: clipDraftText(p?.detailDescription),
      specs: clipDraftText(p?.specs),
      usage: clipDraftText(p?.usage),
      optionsCompat: clipDraftText(p?.optionsCompat),
      cautions: clipDraftText(p?.cautions),
      extra: clipDraftText(p?.extra),
      confidence: conf(p?.confidence),
    }))
    .filter(
      (p) =>
        p.productNo ||
        p.productName ||
        p.detailDescription ||
        p.specs ||
        p.usage ||
        p.optionsCompat ||
        p.cautions ||
        p.extra
    );

  const pol = parsed.policies || {};
  const policies = {
    shipping: clipDraftText(pol.shipping),
    exchangeReturn: clipDraftText(pol.exchangeReturn),
    refund: clipDraftText(pol.refund),
    customerService: clipDraftText(pol.customerService),
    confidence: conf(pol.confidence),
  };

  const warnings = (Array.isArray(parsed.warnings) ? parsed.warnings : [])
    .map((w) => clipDraftText(w, 240))
    .filter(Boolean)
    .slice(0, 12);

  return { products, policies, warnings, parseFailed: false };
}

/** 문의 페어는 답변 문장만 말투 분석에 사용 (정책·효능 추출 금지). */
export function buildInquiryPlaybookPrompt(pairs) {
  const list = normalizeInquiryPairs(pairs);
  const answers = list.map((item) => item.answer).filter(Boolean);
  return buildAnalyzeToneV2Prompt('inquiry', answers);
}

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

export function inferProductBrand(product) {
  return buildProductSearchKeywords(product).brand || '';
}

const STORE_PLACEHOLDER_RE =
  /[\[［【「『{(]\s*(?:스마트\s*)?(?:스토어|쇼핑몰|샵|숍|shop|store)\s*(?:이름|명)?\s*[\]］】」』})]|[\[［【「『{(]\s*(?:브랜드|상호|가게|판매자)(?:\s*(?:이름|명))?\s*[\]］】」』})]/gi;

function stripStorePlaceholders(text, replacement = '') {
  return String(text || '')
    .replace(STORE_PLACEHOLDER_RE, replacement)
    .replace(
      /[\[［【「『{(]\s*[^\]］】」』})\n]{0,24}(?:스마트\s*)?(?:스토어|쇼핑몰|브랜드|상호|샵|숍|가게|판매자|shop|store)[^\]］】」』})\n]{0,12}[\]］】」』})]/gi,
      replacement
    );
}

function stripQuotedCustomerSpeech(text) {
  return String(text || '').replace(
    /(?:에\s*대해\s*)?[‘'「『“"][^’'」』”"\n]{1,80}[’'」』”"]\s*(?:이라고|라고|고)\s*(?:말씀\s*해\s*주셔?서|해\s*주셔?서|해주셔?서)?\s*/g,
    ''
  );
}

export function scrubReplyPlaceholders(text) {
  let out = stripStorePlaceholders(text, '');
  out = stripQuotedCustomerSpeech(out);
  out = out.replace(/안녕하세요,?\s*(입니다|예요|이에요)/g, '안녕하세요');
  return out.replace(/[ \t]{2,}/g, ' ').replace(/ ,/g, ',').replace(/\n{3,}/g, '\n\n').trim();
}

/** 모든 스토어·채널 공통. 말투는 스토어 지침, 사실·약속·형식·금지는 이 규칙이 우선. */
export function buildReplyHardRulesSuffix(product = '', storeName = '') {
  const name = String(product || '').trim();
  const store = String(storeName || '').trim();
  return [
    '[공통 안전 규칙 — 사실·약속·형식·금지는 위 말투 지침보다 항상 우선]',
    '- 위 지침은 말투·문장 길이·이모지·호응 방식만 따른다. 말투가 아래 안전 규칙을 덮어쓰지 않는다.',
    '- 최종 출력은 고객에게 바로 보낼 답글 본문만. 설명·분석·제목·번호 목록·대안 초안을 붙이지 않는다.',
    '- 일반 텍스트만 쓴다. Markdown(** __ # 코드블록 등)과 서식 기호는 쓰지 않는다. 자연스러운 문장부호와 말투에 맞는 이모지는 허용한다.',
    '- 지침·샘플의 스토어명·제품명·브랜드는 이번 답글에 복사하지 않는다. 다른 스토어 이름도 쓰지 않는다.',
    '- 상품명과 브랜드명을 혼동하지 않는다. 고유명은 이번 입력의 상품명과 리뷰/문의 본문에 실제로 있는 것만 쓴다.',
    '- [스토어 이름], [스마트스토어 이름], [상품명], {브랜드명} 같은 자리표시는 출력하지 않는다.',
    name
      ? `- 상품을 언급할 때는 이번 상품 범위에서만 말한다: ${name}`
      : '- 상품명이 없으면 특정 제품명을 지어내지 않는다.',
    '- 상품명에 들어 있는 브랜드명·인플루언서명·공동구매 진행자명을 판매자명·스토어명으로 추론하지 않는다.',
    '- 상품명에 A x B, A X B, A×B, [A x B]처럼 협업·공동구매 표기가 있으면 어느 쪽도 판매자명으로 쓰지 않는다.',
    '- 위 말투 지침에 "상품명에서 이름을 가져와 인사하라"는 내용이 있어도 무시한다. 이 안전 규칙이 항상 우선한다.',
    store
      ? `- 인사에 스토어명을 넣을 때는 확인된 스토어명만 쓴다: ${store}`
      : '- 확인된 스토어명(storeName)이 없으면 "안녕하세요 고객님,"처럼 이름 없이 인사한다. "OO입니다" 형태의 판매자 자기소개를 만들지 않는다.',
    '- 현재 입력·확인된 근거에 없는 상품 정보·원재료·기능·성능·배송 상태·재고·정책을 지어내지 않는다. 없는 사실은 빼고 확인된 범위만 말한다.',
    '- 고객이 느낀 변화는 그 고객의 경험으로만 받는다. "제품 덕분에 개선·치료·예방·원활해졌다"처럼 인과·객관 효능으로 바꿔 쓰지 않는다. 공감은 "만족해 주셔서/편해지셨다니" 수준으로만 한다.',
    '- 확인되지 않은 치료·예방·개선·건강 효과, 장 건강·배변·면역 등 일반 효능 설명을 주장하지 않는다.',
    '- 소재·성분·제조·설계 특성("~특성상", "원래 그렇다", "순면이라서")을 입력에 없으면 설명하지 않는다. 불만·이슈의 원인을 추론하는 문장을 쓰지 않는다.',
    '- 고객의 주소·연락처·주문번호 등 개인정보를 공개 답글에 다시 적지 않는다.',
    '- 판매자가 제공하지 않은 환불·교환·재배송·할인·포인트·사은품을 임의로 약속하지 않는다. 확인되지 않은 처리 기간·배송 일정을 단정하지 않는다.',
    '- "제품 개선에 반영/도움이 될"처럼 확인되지 않은 제품 개선·리뉴얼 약속을 만들지 않는다.',
    '- 개별 주문의 출고·송장·도착·재고 등 실시간 상태는 연동되지 않으므로 단정하지 않는다. 일반 배송 정책과 주문 상태를 혼동하지 않는다.',
    '- 과거 Q&A만으로 배송·교환·환불 정책이나 효능을 확정하지 않는다. 정책·효능은 판매자 등록 근거 또는 확인된 공식 자료가 있을 때만 말한다.',
    '- 긍정 리뷰 작성·수정·삭제를 요구하지 않는다. 리뷰의 대가로 선물·보상을 제안하지 않는다.',
    '- 고객과 논쟁하지 않는다. 고객 잘못이나 미확인 문제 원인을 임의로 단정하지 않는다.',
    '- 공감은 짧게 가능하나, 과도한 사과·책임 인정 단정은 하지 않는다. 고객이 말하지 않은 내용을 과도하게 확대하지 않는다.',
    '- 고객 문장을 인용하거나 바꿔 다시 적지 않는다. \'…\'고 말씀해 주셔서로 받지 않는다. 짧은 칭찬은 "소중한 후기 감사합니다"로 끝낸다. 구체적 경험·문제가 있을 때만 그 사실에 호응한다.',
    '- 모든 답을 같은 문장 구조로 쓰지 않는다. 짧은 글에는 짧게, 구체 경험에는 그에 맞게 반응한다. 불필요한 감탄·이모지 반복은 피한다.',
  ].join('\n');
}

export function appendReplyHardRules(systemPrompt, row = {}) {
  const product = String(row?.product || '').trim();
  const storeName = String(row?.storeName || '').trim();
  return [sanitizeLearnedStylePrompt(systemPrompt), '', buildReplyHardRulesSuffix(product, storeName)].join('\n');
}

export function buildReviewUserContent(row) {
  const storeName = String(row?.storeName || '').trim();
  return [
    row.product && `이번 상품명: ${row.product}`,
    storeName && `확인된 스토어명: ${storeName}`,
    row.reviewType && `리뷰구분: ${row.reviewType}`,
    row.rating && `구매자평점: ${row.rating}점`,
    row.writer && `작성자: ${row.writer}`,
    row.option && `옵션: ${row.option}`,
    `리뷰 내용:\n${row.content}`,
    '시스템 공통 안전 규칙을 지키세요. 말투·이모지만 스토어 지침을 따르세요.',
    '짧은 칭찬은 "소중한 후기 감사합니다"로 끝내세요. 고객 말을 인용하거나 "말씀해 주셔서"로 받지 마세요.',
    '상품명의 브랜드·인플루언서·공동구매 진행자(예: [아밀리x조던누나])를 판매자명으로 쓰지 마세요. A x B 협업 표기의 어느 쪽도 판매자 인사에 넣지 마세요.',
    storeName
      ? `인사에 스토어명을 쓸 때는 확인된 스토어명("${storeName}")만 쓰세요.`
      : '확인된 스토어명이 없으면 "안녕하세요 고객님,"처럼 이름 없이 인사하세요. "조던누나입니다"처럼 상품명에서 뽑은 이름을 쓰지 마세요.',
    '불만·이슈 리뷰: 소재·공정·설계 원인("~특성상")을 추정하지 마세요. 경험 확인·공감·감사만 하세요.',
    '건강·컨디션 리뷰: 장 건강·배변·면역 등 일반 효능 설명을 넣지 마세요. 고객 경험에만 짧게 호응하세요.',
    '고객센터·채팅·전화·외부 문의 채널로 유도하지 마세요. 입력 또는 스토어 지침에 명시된 안내 경로가 있을 때만 그 경로를 말하세요.',
    '정보가 부족하면 추측·임의 약속 없이, 입력·지침에 있는 안내만 짧게 하세요.',
    '나쁜 예: "안녕하세요, 조던누나입니다." / "제품 덕분에 장 건강이 개선되고 배변이 원활해졌다니 기쁩니다." / "순면 소재 특성상 보풀이 생길 수 있습니다." / "\'아주 좋을 것 같다\'고 말씀해 주셔서 감사합니다."',
    '좋은 예: "안녕하세요 고객님, 소중한 후기 감사합니다." / "편해지셨다니 기쁩니다. 소중한 후기 감사합니다." / "보풀이 생기셔서 불편하셨을 것 같습니다. 말씀 남겨 주셔서 감사합니다."',
    '위 리뷰에 대한 판매자 답글 본문만 출력하세요.',
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
    '- 고객이 포함·해당 여부를 물었고, 이 제품에 없거나 해당하지 않음이 확인되면 그 부정 사실을 facts에 넣으세요.',
    '- 상세페이지에 대상·연령·용법이 안 적혀 있다는 이유만으로 "명시되어 있지 않음"을 facts나 missing에 넣지 마세요. 판매자 과거 답변이 있으면 그 안내를 facts에 넣으세요.',
    '- 스펙은 모호한 표현 말고 고유명·수치로 적으세요.',
    '- "프리미엄", "엄선된"처럼 이름 없는 표현은 facts에 넣지 마세요.',
    '- 정말 못 찾은 항목만 missing에 적으세요. 관련 사실을 찾았으면 facts를 비우지 마세요.',
    '- 추측·일반론·다른 제품에서 흔한 표현을 이 상품 사실처럼 쓰지 마세요.',
    '',
    '출력은 JSON만 (설명·마크다운 금지):',
    '{"matchedProduct":true,"facts":["사실1"],"sources":["https://공식출처"],"missing":["못 찾은 항목"],"discardedOtherProducts":true}',
    '- sources[i]는 facts[i]의 출처 URL 또는 공식 문서명. 출처를 확인하지 못한 사실은 facts에 넣지 마세요.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function parseProductFactLookup(rawText) {
  const text = String(rawText || '').trim();
  if (!text) {
    return { matchedProduct: false, facts: [], sources: [], missing: ['검색 결과 없음'] };
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
    const sources = Array.isArray(parsed.sources)
      ? parsed.sources.map((s) => String(s).trim()).filter(Boolean).slice(0, 12)
      : [];
    const missing = Array.isArray(parsed.missing)
      ? parsed.missing.map((f) => String(f).trim()).filter(Boolean).slice(0, 8)
      : [];
    // 출처가 하나도 없으면 공식 사실로 확정하지 않음
    const groundedFacts = sources.length ? facts : [];
    return {
      matchedProduct: parsed.matchedProduct !== false && groundedFacts.length > 0,
      facts: groundedFacts,
      sources,
      missing: sources.length ? missing : [...missing, '공식 출처 미확인'],
    };
  } catch (_) {
    return { matchedProduct: false, facts: [], sources: [], missing: ['사실 추출 실패'] };
  }
}

export function buildInquiryUserContent(row, references = [], options = {}) {
  const webSearch = options.webSearch === true;
  const verifiedFacts = Array.isArray(options.verifiedFacts) ? options.verifiedFacts : null;
  const missingFacts = Array.isArray(options.missingFacts) ? options.missingFacts : [];
  const judgment = String(options.judgment || '').trim();
  const factMode = verifiedFacts != null || webSearch;

  const judgmentBlock =
    judgment === 'REALTIME_REQUIRED'
      ? [
          '[서버 판정: REALTIME_REQUIRED — 변경 불가]',
          '- 주문·출고·송장·재고는 공식 조회 근거가 없습니다. 확정 수치·일정을 쓰지 마세요.',
          '- "확인 후 안내드리겠습니다" 수준만 작성하세요. 답변 가능하다고 단정하지 마세요.',
          '',
        ].join('\n')
      : judgment === 'SELLER_CONFIRM'
        ? [
            '[서버 판정: SELLER_CONFIRM — 변경 불가]',
            '- 서버가 판매자 확인이 필요하다고 판정했습니다. 이 판정을 뒤집지 마세요.',
            '- 위 "확인된 사실"에 있는 내용만 말하고, 나머지는 확인 후 안내하겠다고 하세요.',
            '- 과거 Q&A·추측으로 빈칸을 채우거나 "가능합니다/포함됩니다"처럼 단정하지 마세요.',
            '',
          ].join('\n')
        : judgment === 'ANSWERABLE'
          ? [
              '[서버 판정: ANSWERABLE — 변경 불가]',
              '- 아래 확인된 사실(및 승인 FAQ)만 근거로 답하세요. 근거 밖 사실을 추가하지 마세요.',
              '- 서버가 답변 가능으로 판정한 범위만 답하고, 임의로 "확인 필요"로 바꾸지 마세요.',
              '',
            ].join('\n')
          : '';
  const refBlock =
    references.length > 0
      ? [
          '아래는 과거 판매자 Q&A **참고 자료**입니다. 말투·응대 흐름만 참고하세요.',
          '과거 답변만으로 배송 정책·교환·환불 정책·효능·성분·호환을 확정하지 마세요. 그런 내용은 판매자 등록 상품정보·스토어 정책·확인된 공식 사실이 있을 때만 쓰세요.',
          '다른 상품 답변의 스펙은 가져오지 마세요. 과거 답에 없는 구체 사실(고유명·수치·일정·URL·혜택)은 지어내지 마세요.',
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
  const isEligibility =
    /(먹어도|먹여도|먹일|급여|섭취|사용해도|써도|발라도|입어도|해도\s*될|해도\s*되|해도\s*괜찮|괜찮을|괜찮나|가능한가|가능할까|가능한지|문제\s*없|부작용)/.test(
      String(row?.content || '')
    );
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
  // 스토어명·자리표시·원문 복붙·임의 약속 등은 system 공통 하드룰에 있음. 여기엔 문의 전용만.
  const commonPriorityRules = [
    '- 최우선: 구체 사실은 판매자 등록 상품정보·스토어 정책·확인된 공식 사실·문의문에 있는 것만 쓰세요. 과거 Q&A는 참고일 뿐 정책·효능을 확정하지 마세요.',
    '- 근거에 없으면 그 내용을 빼세요. 추측으로 채우지 마세요.',
    '- 문의에 적힌 질문 그대로 답하세요. 더 넓은 질문으로 바꾸거나 상품 소개로 시작하지 마세요.',
    '- 고객이 처리해 달라고 명확히 요청하지 않은 조치(취소·반품·환불·고객센터·병원 상담)는 제안하지 마세요.',
    '- 죄송·사과 문구는 넣지 마세요. 공감은 짧게 하고 바로 안내하세요.',
    '- "상세페이지를 확인하세요", "다시 남겨 주세요"로 답을 넘기지 마세요.',
    '- 질문하지 않은 스펙 목록은 나열하지 마세요.',
    '- 개별 주문 출고·송장·재고는 확인된 값이 없으면 단정하지 말고 확인 후 안내하겠다고 하세요.',
  ];
  const factRules = [
    '- 이 문의는 상품 사실(스펙·구성·호환·용량 등)이 필요합니다. 확인된 사실만 쓰세요.',
    '- 문의의 핵심 질문에 첫 1~2문장에서 바로 답하세요. 돌려 말하지 마세요.',
    '- 위 "확인된 사실" 중 질문에 필요한 것만 쓰세요. 출처가 표시된 사실만 사용하세요.',
    hasSellerRefs
      ? '- 과거 판매자 답변은 말투·응대 흐름 참고용입니다. 스펙·정책·효능을 과거 답만으로 확정하지 마세요.'
      : '',
    '- 금지 문구: 근거 없이 "됩니다/포함됩니다"처럼 단정하기. 확인된 사실이 없을 때는 추측하지 마세요.',
    '- 고객이 A 포함 여부를 물었고 확인된 사실에 관련 구성이 있으면: 그 고유명을 말하고, A 자체 포함 여부는 확인된 범위만 말하세요.',
    '- "상세페이지를 확인해 주세요"처럼 확인된 사실을 고객에게 떠넘기지 마세요.',
    '- 확인된 사실에 없는 고유명·함량·개수·출시 월·날짜는 절대 추가하지 마세요.',
    '- 다른 제품·일반 상식으로 빈칸을 채우지 마세요.',
    hasFacts
      ? '- 확인되지 않은 항목이 있으면, 확인된 내용을 말한 뒤에만 그 항목은 확인이 필요하다고 짧게 안내하세요.'
      : '- 확인된 사실이 없으면 추측하지 말고, 확인 후 안내드리겠다고 짧게 답하세요.',
  ];
  const sellerRules = [
    '- 이 문의는 스펙 조사가 아닙니다. 아래 과거 판매자 답변의 응대 흐름을 참고해 이번 문의에 맞게 새로 쓰세요.',
    '- 과거 Q&A만으로 배송·교환·환불 정책이나 효능을 확정하지 마세요.',
    '- 첫 문장에서 상품이 무엇인지 소개하지 마세요. 물은 조건부터 답하세요.',
    '- "상세페이지를 참고하세요"로 사용법·가능 여부를 떠넘기지 마세요.',
    '- 과거 답변에 없는 상담 권고("전문가/병원에 문의하세요")는 넣지 마세요.',
    hasSellerRefs
      ? '- 과거 답변에 없는 구체 사실(고유명·수치·일정·URL·혜택)은 추가하지 마세요.'
      : '- 참고 답변이 없으면 문의·상품명에 있는 범위만 짧게 답하세요. 없는 사실은 지어내지 마세요.',
  ];
  const rules = factMode
    ? [...factRules, ...commonPriorityRules, ...returnRules, ...eligibilityRules]
    : [...sellerRules, ...commonPriorityRules, ...returnRules, ...eligibilityRules];

  return [
    judgmentBlock,
    refBlock,
    factBlock,
    missingBlock,
    row.product && `이번 상품명: ${row.product}`,
    row.productNo && `상품번호: ${row.productNo}`,
    row.writer && `문의자: ${row.writer}`,
    row.secret != null && `비밀문의: ${row.secret ? '예' : '아니오'}`,
    `문의 내용:\n${row.content}`,
    '작성 규칙이 시스템 말투보다 우선합니다. 말투만 맞추고, 내용은 과거 판매자 답변·확인된 사실을 따르세요.',
    '고객 문장을 인용하거나 \'…\'고/라고 다시 적지 마세요. 확인된 답만 말하세요.',
    '작성 규칙:',
    ...rules,
    '위 상품문의에 대한 판매자 답글 본문만 출력하세요.',
  ]
    .filter(Boolean)
    .join('\n');
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

export function extractInquiryConcreteClaims(text) {
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
  for (const match of raw.matchAll(/(무상|무료)\s*(지급|제공|증정|나눔)/g)) {
    push(`${match[1]}${match[2]}`);
  }
  return claims;
}

export function buildInquiryAllowedFactBlob(row, references = [], verifiedFacts = [], guidelines = '') {
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

export function assessInquiryReplyGrounding(row, reply, references = [], verifiedFacts = [], guidelines = '') {
  const allowed = buildInquiryAllowedFactBlob(row, references, verifiedFacts, guidelines);
  const allowedNorm = allowed.replace(/\s+/g, '').toLowerCase();
  const unsupported = extractInquiryConcreteClaims(reply).filter((claim) => !allowedNorm.includes(claim));
  return { grounded: unsupported.length === 0, unsupported, allowed };
}

export function buildInquiryGroundingRewritePrompt(row, draftReply, references = [], verifiedFacts = [], guidelines = '') {
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
    `이번 상품명: ${row?.product || '(없음)'}`,
    `문의 내용:\n${row?.content || ''}`,
    '',
    '[수정 전 초안]',
    String(draftReply || '').trim(),
    '',
    '고객 문의 문장을 따옴표로 다시 쓰지 마세요.',
    '샘플·지침의 스토어명·제품명은 복사하지 마세요. 자리표시는 쓰지 마세요.',
    '수정된 판매자 답글만 출력하세요. 따옴표나 설명 없이 본문만.',
  ].join('\n');
}
