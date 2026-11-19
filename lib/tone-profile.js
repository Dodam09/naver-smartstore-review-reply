/** 구조화 말투(tone_v2) — server/tone-profile.js 와 동기화 유지. */
const TONE_V2_VERSION = 'tone_v2';

const TONE_PROFILE_FIELDS = [
  'greeting',
  'honorificStyle',
  'sentenceLength',
  'emoji',
  'empathy',
  'frequentPhrases',
  'closing',
];

const FIELD_LABELS = {
  greeting: '인사말',
  honorificStyle: '존댓말·문체',
  sentenceLength: '문장 길이',
  emoji: '이모지 사용',
  empathy: '공감 방식',
  frequentPhrases: '자주 사용하는 표현',
  closing: '마무리 방식',
};

const POLICY_PROMISE_LINE_RE =
  /(?:환불|교환|반품|재배송|보상|사은품|포인트|할인\s*쿠폰).{0,24}(?:해\s*드|드리|약속|진행|처리)|(?:제품|상품|품질).{0,12}개선(?:에\s*(?:반영|도움)|\s*하겠)|앞으로의\s*개선\s*의지|개선\s*의지\s*표현|(?:배송|출고|도착).{0,16}(?:약속|단정|보장)|고객센터(?:로\s*)?안내|병원(?:으로\s*)?(?:안내|권고)|(?:효능|치료|예방|면역|장\s*건강|배변).{0,20}(?:주장|안내|설명|보장)|상세페이지를\s*확인|공개된\s*상품\s*정보는\s*검색/i;

function cleanToneFieldText(value, maxLen) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen || 160);
}

function getDefaultToneProfile(channel) {
  const isInquiry = channel === 'inquiry';
  return {
    version: TONE_V2_VERSION,
    channel: isInquiry ? 'inquiry' : 'review',
    greeting: '안녕하세요 고객님,',
    honorificStyle: '존댓말로 정중하고 자연스럽게 작성한다',
    sentenceLength: isInquiry
      ? '질문에 필요한 만큼 2~4문장으로 간결히 작성한다'
      : '리뷰 길이에 맞춰 1~3문장으로 조절한다',
    emoji: '샘플에 없는 이모지를 무리하게 넣지 않는다',
    empathy: isInquiry ? '공감은 짧게 하고 바로 안내에 집중한다' : '고객 경험에 짧게 호응한 뒤 감사를 전한다',
    frequentPhrases: isInquiry
      ? ['확인 후 안내드리겠습니다', '감사합니다']
      : ['소중한 후기 감사합니다', '감사합니다'],
    closing: '감사합니다.',
  };
}

function isValidToneProfile(raw) {
  if (!raw || typeof raw !== 'object') return false;
  if (raw.version !== TONE_V2_VERSION) return false;
  if (raw.channel !== 'review' && raw.channel !== 'inquiry') return false;
  for (let i = 0; i < TONE_PROFILE_FIELDS.length; i++) {
    const key = TONE_PROFILE_FIELDS[i];
    if (key === 'frequentPhrases') {
      if (!Array.isArray(raw.frequentPhrases)) return false;
      continue;
    }
    if (!cleanToneFieldText(raw[key])) return false;
  }
  return true;
}

function normalizeToneProfile(raw, channel) {
  if (!raw || typeof raw !== 'object') return null;
  const base = getDefaultToneProfile(channel || 'review');
  const next = {
    version: TONE_V2_VERSION,
    channel: raw.channel === 'inquiry' || channel === 'inquiry' ? 'inquiry' : 'review',
    greeting: cleanToneFieldText(raw.greeting, 80) || base.greeting,
    honorificStyle: cleanToneFieldText(raw.honorificStyle) || base.honorificStyle,
    sentenceLength: cleanToneFieldText(raw.sentenceLength) || base.sentenceLength,
    emoji: cleanToneFieldText(raw.emoji) || base.emoji,
    empathy: cleanToneFieldText(raw.empathy) || base.empathy,
    frequentPhrases: Array.isArray(raw.frequentPhrases)
      ? raw.frequentPhrases.map((p) => cleanToneFieldText(p, 40)).filter(Boolean).slice(0, 8)
      : base.frequentPhrases.slice(),
    closing: cleanToneFieldText(raw.closing, 80) || base.closing,
  };
  if (!next.frequentPhrases.length) next.frequentPhrases = base.frequentPhrases.slice();
  return isValidToneProfile(next) ? next : null;
}

function extractToneJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch (_) {
    return null;
  }
}

function parseToneProfileJson(text, channel) {
  const parsed = extractToneJsonObject(text);
  if (!parsed) return null;
  if (!parsed.version) parsed.version = TONE_V2_VERSION;
  if (!parsed.channel) parsed.channel = channel === 'inquiry' ? 'inquiry' : 'review';
  return normalizeToneProfile(parsed, channel);
}

function renderToneProfileToSystemPrompt(profile) {
  const p = normalizeToneProfile(profile, profile && profile.channel);
  if (!p) return renderToneProfileToSystemPrompt(getDefaultToneProfile('review'));
  const phrases = p.frequentPhrases.map((x) => '"' + x + '"').join(', ');
  const channelLabel = p.channel === 'inquiry' ? '상품문의' : '리뷰';
  return [
    '당신은 네이버 스마트스토어 ' + channelLabel + ' 판매자 답글을 작성합니다. 아래는 말투·형식만의 지침입니다.',
    '[말투·표현] - ' + FIELD_LABELS.greeting + ': ' + p.greeting,
    '[말투·표현] - ' + FIELD_LABELS.honorificStyle + ': ' + p.honorificStyle,
    '[말투·표현] - ' + FIELD_LABELS.sentenceLength + ': ' + p.sentenceLength,
    '[말투·표현] - ' + FIELD_LABELS.emoji + ': ' + p.emoji,
    '[말투·표현] - ' + FIELD_LABELS.empathy + ': ' + p.empathy,
    '[말투·표현] - ' + FIELD_LABELS.frequentPhrases + ': ' + phrases,
    '[말투·표현] - ' + FIELD_LABELS.closing + ': ' + p.closing,
    '[답변 방식] - 복붙 티 나지 않게 자연스럽게 작성한다',
    p.channel === 'inquiry'
      ? '[답변 방식] - 문의 내용의 질문에 구체적으로 답변한다'
      : '[답변 방식] - 리뷰의 구체적 경험에만 호응한다. 고객 문장을 다시 말하거나 인용하지 않고, 짧은 칭찬은 감사만 한다',
    '[답변 방식] - 고객 문장을 따옴표로 인용하지 말 것',
    '[응대 원칙] - 사실·약속·정책·효능은 이 지침에 넣지 않으며, 확인된 근거와 공통 안전 규칙만 따른다',
  ].join('\n');
}

function resolveToneSystemPrompt(options) {
  const opts = options || {};
  const channel = opts.channel || 'review';
  const normalized = normalizeToneProfile(opts.toneProfile, channel);
  if (normalized && !opts.parseFailed) {
    return {
      toneProfile: normalized,
      prompt: renderToneProfileToSystemPrompt(normalized),
      usedFallback: false,
      fallbackReason: '',
    };
  }
  const previous = normalizeToneProfile(opts.previousToneProfile, channel);
  if (previous) {
    return {
      toneProfile: previous,
      prompt: renderToneProfileToSystemPrompt(previous),
      usedFallback: true,
      fallbackReason: 'previous_profile',
    };
  }
  const fallback = getDefaultToneProfile(channel);
  return {
    toneProfile: fallback,
    prompt: renderToneProfileToSystemPrompt(fallback),
    usedFallback: true,
    fallbackReason: 'default_profile',
  };
}

function buildAnalyzeToneV2PromptLocal(context, normalizedSamples) {
  const sampleBlock = normalizedSamples.map((s, i) => '[' + (i + 1) + ']\n' + s).join('\n\n');
  const isInquiry = context === 'inquiry';
  const channel = isInquiry ? 'inquiry' : 'review';
  return (
    '당신은 네이버 스마트스토어 판매자 답글의 **말투만** 분석하는 전문가입니다.\n' +
    '아래는 실제 사장님이 작성한 ' +
    (isInquiry ? '상품문의' : '리뷰') +
    ' 판매자 답글 샘플입니다.\n\n' +
    '반드시 JSON 객체 하나만 출력하세요. 설명·마크다운·코드펜스 없이 JSON만.\n' +
    '스키마:\n' +
    '{\n' +
    '  "version": "' +
    TONE_V2_VERSION +
    '",\n' +
    '  "channel": "' +
    channel +
    '",\n' +
    '  "greeting": "인사말 특징",\n' +
    '  "honorificStyle": "존댓말 및 문체",\n' +
    '  "sentenceLength": "문장 길이",\n' +
    '  "emoji": "이모지 사용",\n' +
    '  "empathy": "공감 방식",\n' +
    '  "frequentPhrases": ["자주 쓰는 표현1", "표현2"],\n' +
    '  "closing": "마무리 방식"\n' +
    '}\n\n' +
    '규칙:\n' +
    '- 위 필드만 채운다. 다른 키를 추가하지 않는다.\n' +
    '- 말투·형식만 적는다. 샘플의 스토어명·제품명·브랜드 고유명은 복사하지 않는다.\n' +
    '- 다음을 절대 넣지 않는다: 환불·교환·재배송·보상·사은품 약속, 제품 개선 약속, 배송·출고 일정 단정, 고객센터·병원 안내 정책, 효능·성능·성분·호환 등 사실 주장.\n' +
    '- 샘플에 없는 이모지·유행어를 만들지 않는다.\n' +
    '- frequentPhrases는 0~8개. 관용적 인사·감사 표현만.\n\n' +
    '샘플 답글:\n' +
    sampleBlock
  );
}

function stripPolicyPromiseLinesLocal(prompt) {
  return String(prompt || '')
    .split(/\r?\n/)
    .filter(function (line) {
      const t = line.trim();
      if (!t) return true;
      return !POLICY_PROMISE_LINE_RE.test(t);
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
