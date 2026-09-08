/** 토스 기관 코드 → 표시명 (https://docs.tosspayments.com/codes/org-codes) */
const TOSS_CARD_COMPANY_NAMES = {
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
  IBK_BC: '기업비씨',
  GWANGJUBANK: '광주',
  LOTTE: '롯데',
  KDBBANK: '산업',
  BC: 'BC',
  SAMSUNG: '삼성',
  SAEMAUL: '새마을',
  SHINHAN: '신한',
  SHINHYEOP: '신협',
  CITI: '씨티',
  WOORI: '우리',
  POST: '우체국',
  SAVINGBANK: '저축',
  JEONBUKBANK: '전북',
  JEJUBANK: '제주',
  KAKAOBANK: '카카오뱅크',
  KBANK: '케이뱅크',
  TOSSBANK: '토스뱅크',
  HANA: '하나',
  HYUNDAI: '현대',
  KOOKMIN: '국민',
  NONGHYEOP: '농협',
  SUHYEOP: '수협',
};

export function resolveCardCompanyName(codeOrName) {
  const raw = String(codeOrName || '').trim();
  if (!raw) return '';
  if (TOSS_CARD_COMPANY_NAMES[raw]) return TOSS_CARD_COMPANY_NAMES[raw];
  const upper = raw.toUpperCase();
  if (TOSS_CARD_COMPANY_NAMES[upper]) return TOSS_CARD_COMPANY_NAMES[upper];
  // 이미 한글명인 경우
  return raw;
}

export function formatCardLabel(company, number) {
  const c = resolveCardCompanyName(company);
  const n = String(number || '').trim();
  if (!c && !n) return null;
  if (c && n) return `${c} ${n}`;
  return c || n;
}
