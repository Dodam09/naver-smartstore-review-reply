/** 토스 카드사 코드 → 표시명 https://docs.tosspayments.com/codes/org-codes */
export const TOSS_CARD_COMPANY_NAMES = {
  '3K': '기업비씨',
  '46': '광주',
  '71': '롯데',
  '30': '산업',
  '31': 'BC',
  '51': '삼성',
  '38': '새마을',
  '41': '신한',
  '62': '신협',
  '36': '씨티',
  '33': '우리',
  W1: '우리',
  '37': '우체국',
  '39': '저축',
  '35': '전북',
  '42': '제주',
  '15': '카카오뱅크',
  '3A': '케이뱅크',
  '24': '토스뱅크',
  '21': '하나',
  '61': '현대',
  '11': '국민',
  '91': '농협',
  '34': '수협',
  '6D': '다이너스',
  '4M': '마스터',
  '3C': '유니온페이',
  '7A': '아멕스',
  '4J': 'JCB',
  '4V': 'VISA',
};

export function resolveCardCompanyName(codeOrName) {
  const raw = String(codeOrName || '').trim();
  if (!raw) return '';
  if (TOSS_CARD_COMPANY_NAMES[raw]) return TOSS_CARD_COMPANY_NAMES[raw];
  const upper = raw.toUpperCase();
  if (TOSS_CARD_COMPANY_NAMES[upper]) return TOSS_CARD_COMPANY_NAMES[upper];
  // 이미 한글명인 경우 그대로
  return raw;
}

export function formatMaskedCardNumber(number) {
  const raw = String(number || '').replace(/[^\d*]/g, '');
  if (!raw) return '';
  const chunks = raw.match(/.{1,4}/g) || [];
  return chunks.join('-');
}

export function formatCardLabel(company, number) {
  const c = resolveCardCompanyName(company);
  const n = formatMaskedCardNumber(number);
  if (!c && !n) return null;
  if (c && n) return `${c} ${n}`;
  return c || n;
}
