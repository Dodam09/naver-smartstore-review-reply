/**
 * 답글 톤 프리셋 (팝업·백그라운드 공용)
 * 기본 예시 프리셋은 제공하지 않습니다. 사용자는 기존 답글 분석·직접 지침으로만 만듭니다.
 */
const BUILTIN_TONE_PRESETS = [];

/** 상품문의 전용 톤 프리셋 (리뷰와 별도) — 예시 없음 */
const BUILTIN_INQUIRY_TONE_PRESETS = [];

/** 예전에 쓰이던 기본 예시 지침 (저장값 정리용) */
const LEGACY_BUILTIN_PROMPT_PREFIXES = [
  '당신은 네이버 스마트스토어 판매자입니다. 고객 리뷰에',
  '당신은 정성스럽고 따뜻한 스마트스토어 사장님입니다. 고객의 경험에',
  '당신은 신뢰감 있는 스마트스토어 판매자입니다. 간결하고 정중한',
  '당신은 고객과 가깝게 소통하는 스마트스토어 사장님입니다. 친근하지만 예의 있는 한국어로 2~3문장',
  '당신은 프리미엄 브랜드 스마트스토어의 공식 판매자입니다.',
  '당신은 바쁜 스마트스토어 사장님입니다. 핵심만 담은 1~2문장',
  '당신은 네이버 스마트스토어 판매자입니다. 고객 상품문의에',
  '당신은 정성스럽고 따뜻한 스마트스토어 사장님입니다. 상품문의에',
  '당신은 신뢰감 있는 스마트스토어 판매자입니다. 상품문의에',
  '당신은 고객과 가깝게 소통하는 스마트스토어 사장님입니다. 상품문의에',
  '당신은 꼼꼼한 스마트스토어 판매자입니다. 상품문의에',
  '당신은 바쁜 스마트스토어 사장님입니다. 상품문의 핵심',
];

const LEGACY_BUILTIN_PRESET_IDS = [
  'default',
  'warm',
  'professional',
  'casual',
  'premium',
  'concise',
  'detailed',
];

const REVIEW_LEARNED_PRESET_ID = 'learned';
const INQUIRY_LEARNED_PRESET_ID = 'inquiry-learned';

const CUSTOM_PRESET_ID = 'custom';

function isLegacyBuiltinPrompt(text) {
  const prompt = String(text || '').trim();
  if (!prompt) return false;
  return LEGACY_BUILTIN_PROMPT_PREFIXES.some((prefix) => prompt.startsWith(prefix));
}

function isLegacyBuiltinPresetId(id) {
  return LEGACY_BUILTIN_PRESET_IDS.includes(String(id || ''));
}

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

  return raw
    .split(/\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8);
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
