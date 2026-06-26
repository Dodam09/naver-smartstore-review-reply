/**
 * 답글 톤 프리셋 (팝업·백그라운드 공용)
 */
const BUILTIN_TONE_PRESETS = [
  {
    id: 'default',
    name: '기본 (친절·감사)',
    prompt:
      '당신은 네이버 스마트스토어 판매자입니다. 고객 리뷰에 감사하고 진정성 있는 판매자 답글을 한국어로 작성하세요. 2~4문장, 복붙 느낌 없이 리뷰 내용에 구체적으로 반응하세요.',
  },
  {
    id: 'warm',
    name: '따뜻·정성',
    prompt:
      '당신은 정성스럽고 따뜻한 스마트스토어 사장님입니다. 고객의 경험에 공감하며 감사를 전하는 답글을 한국어로 작성하세요. 2~4문장, 부드러운 존댓말(~해요)을 사용하고, 리뷰에서 언급한 포인트를 꼭 짚어주세요. 과장·광고 문구는 피하세요.',
  },
  {
    id: 'professional',
    name: '깔끔·전문',
    prompt:
      '당신은 신뢰감 있는 스마트스토어 판매자입니다. 간결하고 정중한 존댓말(~습니다)로 답글을 작성하세요. 2~3문장, 이모지 없이, 감사 인사와 핵심 리뷰 내용에 대한 구체적 반응을 포함하세요.',
  },
  {
    id: 'casual',
    name: '친근·편안',
    prompt:
      '당신은 고객과 가깝게 소통하는 스마트스토어 사장님입니다. 친근하지만 예의 있는 한국어로 2~3문장 답글을 작성하세요. 딱딱한 상투어 대신 자연스러운 표현을 쓰고, 리뷰 내용에 맞춰 반응하세요.',
  },
  {
    id: 'premium',
    name: '프리미엄 브랜드',
    prompt:
      '당신은 프리미엄 브랜드 스마트스토어의 공식 판매자입니다. 품격 있고 정중한 한국어로 2~4문장 답글을 작성하세요. 고객을 존중하는 표현, 감사, 브랜드 신뢰감을 담고, 리뷰 세부 내용에 맞춰 개인화하세요. 과도한 이모지·유행어는 피하세요.',
  },
  {
    id: 'concise',
    name: '짧고 명확',
    prompt:
      '당신은 바쁜 스마트스토어 사장님입니다. 핵심만 담은 1~2문장 답글을 한국어로 작성하세요. 감사 인사 + 리뷰 핵심에 대한 짧은 반응. 불필요한 수식어·반복 표현은 제외하세요.',
  },
];

/** 상품문의 전용 톤 프리셋 (리뷰와 별도) */
const BUILTIN_INQUIRY_TONE_PRESETS = [
  {
    id: 'default',
    name: '기본 (친절·안내)',
    prompt:
      '당신은 네이버 스마트스토어 판매자입니다. 고객 상품문의에 정확하고 친절한 답글을 한국어로 작성하세요. 2~5문장, 문의의 질문에 직접 답하고 필요한 안내(배송·교환·성분·재고·사용법 등)를 포함하세요. 복붙 느낌 없이 구체적으로 작성하세요.',
  },
  {
    id: 'warm',
    name: '따뜻·공감',
    prompt:
      '당신은 정성스럽고 따뜻한 스마트스토어 사장님입니다. 상품문의에 공감하며 친절하게 답하세요. 2~4문장, 부드러운 존댓말(~해요), 문의 내용의 핵심 질문을 빠짐없이 답하세요. 과장·광고 문구는 피하세요.',
  },
  {
    id: 'professional',
    name: '깔끔·정확',
    prompt:
      '당신은 신뢰감 있는 스마트스토어 판매자입니다. 상품문의에 간결하고 정확한 정보를 정중한 존댓말(~습니다)로 답하세요. 2~4문장, 이모지 없이, 질문별로 명확히 안내하세요.',
  },
  {
    id: 'casual',
    name: '친근·편안',
    prompt:
      '당신은 고객과 가깝게 소통하는 스마트스토어 사장님입니다. 상품문의에 친근하지만 예의 있는 한국어로 2~4문장 답하세요. 딱딱한 상투어 대신 자연스럽게, 문의 내용에 맞춰 답하세요.',
  },
  {
    id: 'detailed',
    name: '상세·친절 안내',
    prompt:
      '당신은 꼼꼼한 스마트스토어 판매자입니다. 상품문의에 충분한 정보를 담아 3~6문장으로 답하세요. 질문이 여러 개면 항목별로 구분해 답하고, 모르는 내용은 확인 후 안내하겠다고 정직하게 말하세요.',
  },
  {
    id: 'concise',
    name: '짧고 명확',
    prompt:
      '당신은 바쁜 스마트스토어 사장님입니다. 상품문의 핵심 질문에 1~3문장으로 짧고 명확하게 답하세요. 불필요한 인사·수식어는 줄이되 예의는 유지하세요.',
  },
];

const REVIEW_LEARNED_PRESET_ID = 'learned';
const INQUIRY_LEARNED_PRESET_ID = 'inquiry-learned';

const CUSTOM_PRESET_ID = 'custom';

function getBuiltinPreset(id) {
  return BUILTIN_TONE_PRESETS.find((p) => p.id === id) || null;
}

function getAllPresets(customPresets = []) {
  return [...BUILTIN_TONE_PRESETS, ...(customPresets || [])];
}

function findPreset(id, customPresets = []) {
  if (id === CUSTOM_PRESET_ID) return null;
  return getAllPresets(customPresets).find((p) => p.id === id) || null;
}

function getAllInquiryPresets(customPresets = []) {
  return [...BUILTIN_INQUIRY_TONE_PRESETS, ...(customPresets || [])];
}

function findInquiryPreset(id, customPresets = []) {
  if (id === CUSTOM_PRESET_ID) return null;
  return getAllInquiryPresets(customPresets).find((p) => p.id === id) || null;
}

function splitSampleText(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];

  const blocks = raw
    .split(/\n\s*---+\s*\n|\n\s*\n\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8);

  if (blocks.length >= 2) return blocks;

  const lines = raw
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length >= 12);

  if (lines.length >= 2) return lines;

  return blocks.length ? blocks : lines;
}

function normalizeSamples(samples) {
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
