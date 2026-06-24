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
    const key = s.slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(s);
  }
  return unique.slice(0, 20);
}
