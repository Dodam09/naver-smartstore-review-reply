/**
 * AI 지식 메타: source / trustStatus / effective 분리 (2단계 최종 설계).
 * 답변 확정 근거는 approved(+레거시 간주) && effective && !conflict 만.
 */

import crypto from 'node:crypto';

export const KNOWLEDGE_SOURCES = Object.freeze([
  'NAVER_PRODUCT',
  'STORE_POLICY',
  'SELLER_APPROVED',
  'MANUAL',
  'HISTORICAL_QA',
  'HISTORICAL_REPLY',
  'OFFICIAL_ORDER',
  'AI_DERIVED',
]);

/** DB/레거시 → 정규 출처 */
const SOURCE_ALIASES = Object.freeze({
  manual: 'MANUAL',
  MANUAL: 'MANUAL',
  seller_approved: 'SELLER_APPROVED',
  SELLER_APPROVED: 'SELLER_APPROVED',
  NAVER_PRODUCT: 'NAVER_PRODUCT',
  STORE_POLICY: 'STORE_POLICY',
  HISTORICAL_QA: 'HISTORICAL_QA',
  HISTORICAL_REPLY: 'HISTORICAL_REPLY',
  OFFICIAL_ORDER: 'OFFICIAL_ORDER',
  AI_DERIVED: 'AI_DERIVED',
});

export const TRUST_STATUSES = Object.freeze([
  'unverified',
  'approved',
  'conflict',
  'dismissed',
]);

export const PRODUCT_META_FIELDS = Object.freeze([
  'product_name',
  'detail_description',
  'specs',
  'usage',
  'options_compat',
  'cautions',
  'extra',
]);

export const POLICY_META_FIELDS = Object.freeze([
  'shipping',
  'exchange_return',
  'refund',
  'customer_service',
]);

/** 자동 수집·참고용 — 저장 시 trust 기본 unverified */
export function isUnverifiedByDefaultSource(source) {
  const n = normalizeSource(source);
  return (
    n === 'NAVER_PRODUCT' ||
    n === 'AI_DERIVED' ||
    n === 'HISTORICAL_QA' ||
    n === 'HISTORICAL_REPLY'
  );
}

export function normalizeSource(source) {
  const raw = String(source || '').trim();
  if (!raw) return 'MANUAL';
  if (SOURCE_ALIASES[raw]) return SOURCE_ALIASES[raw];
  const upper = raw.toUpperCase();
  if (SOURCE_ALIASES[upper]) return SOURCE_ALIASES[upper];
  return raw.length <= 40 ? raw : raw.slice(0, 40);
}

/**
 * 저장용 source 문자열 (하위호환: manual / seller_approved 유지 가능).
 * preferLegacy: true면 MANUAL→manual, SELLER_APPROVED→seller_approved
 */
export function sourceForStorage(source, { preferLegacy = true } = {}) {
  const n = normalizeSource(source);
  if (!preferLegacy) return n;
  if (n === 'MANUAL') return 'manual';
  if (n === 'SELLER_APPROVED') return 'seller_approved';
  return n;
}

/**
 * DB trust_status + source + verified_at → 저장 trust 해석.
 * expired는 여기에 넣지 않음 (effective에서 계산).
 */
export function resolveTrustStatus({
  trustStatus = null,
  source = null,
  verifiedAt = null,
} = {}) {
  const raw = String(trustStatus || '').trim();
  if (TRUST_STATUSES.includes(raw)) return raw;

  // 레거시: trust 컬럼 없음
  // - verified_at 있으면 source 무관하게 approved (기존 설계 하위호환)
  // - manual / seller_approved / STORE_POLICY → approved
  // - 자동수집 출처만 있고 verified_at 없음 → unverified
  const n = normalizeSource(source);
  if (verifiedAt) return 'approved';
  if (n === 'MANUAL' || n === 'SELLER_APPROVED' || n === 'STORE_POLICY') {
    return 'approved';
  }
  if (isUnverifiedByDefaultSource(source)) return 'unverified';
  return 'unverified';
}

/** upsert 시 넣을 trust_status (레거시는 null 허용 = 읽기 시 폴백) */
export function trustStatusForInsert(payload = {}) {
  if (payload.trustStatus != null && String(payload.trustStatus).trim() !== '') {
    const t = String(payload.trustStatus).trim();
    if (!TRUST_STATUSES.includes(t)) {
      throw new Error(`잘못된 trustStatus: ${t}`);
    }
    return t;
  }
  if (isUnverifiedByDefaultSource(payload.source)) return 'unverified';
  // 수동·판매자승인·정책: null → 레거시 approved 폴백
  return null;
}

export function parseFieldMetaJson(raw) {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return { ...raw };
  try {
    const parsed = JSON.parse(String(raw));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

export function stringifyFieldMeta(meta) {
  return JSON.stringify(meta && typeof meta === 'object' ? meta : {});
}

/**
 * KST 달력 날짜 YYYY-MM-DD
 */
export function kstDateString(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(date);
}

function toKstDateOnly(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
  }
  return kstDateString(d);
}

export function assertValidRange(validFrom, validTo) {
  const from = toKstDateOnly(validFrom);
  const to = toKstDateOnly(validTo);
  if (from && to && from > to) {
    const err = new Error('valid_from이 valid_to보다 늦을 수 없습니다.');
    err.code = 'INVALID_VALIDITY_RANGE';
    throw err;
  }
  return { validFrom: from, validTo: to };
}

/**
 * 공통 유효기간 판정 (목록·generate-reply 동일 사용).
 * @returns {{ effective: boolean, effectiveStatus: 'active'|'not_yet'|'expired'|'indefinite' }}
 */
export function isKnowledgeEffective(meta = {}, now = new Date()) {
  const today = kstDateString(now);
  let from = null;
  let to = null;
  try {
    const range = assertValidRange(meta.validFrom ?? meta.valid_from, meta.validTo ?? meta.valid_to);
    from = range.validFrom;
    to = range.validTo;
  } catch {
    return { effective: false, effectiveStatus: 'expired' };
  }

  if (!from && !to) {
    return { effective: true, effectiveStatus: 'indefinite' };
  }
  if (from && today < from) {
    return { effective: false, effectiveStatus: 'not_yet' };
  }
  if (to && today > to) {
    return { effective: false, effectiveStatus: 'expired' };
  }
  return { effective: true, effectiveStatus: 'active' };
}

/** 확정 답변 근거로 쓸 수 있는지 */
export function canUseAsVerifiedFact({
  trustStatus,
  source,
  verifiedAt,
  validFrom,
  validTo,
  now,
} = {}) {
  const trust = resolveTrustStatus({ trustStatus, source, verifiedAt });
  if (trust !== 'approved') return false;
  if (trust === 'conflict' || trust === 'dismissed') return false;
  const n = normalizeSource(source);
  if (n === 'HISTORICAL_QA' || n === 'HISTORICAL_REPLY' || n === 'AI_DERIVED') {
    return false;
  }
  const { effective } = isKnowledgeEffective({ validFrom, validTo }, now);
  return effective;
}

export function normalizeFactText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function contentHash(text) {
  return crypto.createHash('sha256').update(normalizeFactText(text), 'utf8').digest('hex');
}

export function mergeFieldMeta(existingRaw, field, patch = {}) {
  const meta = parseFieldMetaJson(existingRaw);
  const key = String(field || '');
  if (!key) return meta;
  const prev = meta[key] && typeof meta[key] === 'object' ? meta[key] : {};
  if (patch === null) {
    delete meta[key];
    return meta;
  }
  const next = { ...prev, ...patch };
  if (next.validFrom !== undefined || next.valid_from !== undefined || next.validTo !== undefined || next.valid_to !== undefined) {
    const { validFrom, validTo } = assertValidRange(
      next.validFrom ?? next.valid_from,
      next.validTo ?? next.valid_to
    );
    next.validFrom = validFrom;
    next.validTo = validTo;
    delete next.valid_from;
    delete next.valid_to;
  }
  if (next.source != null) next.source = normalizeSource(next.source);
  if (next.trustStatus != null && !TRUST_STATUSES.includes(next.trustStatus)) {
    throw new Error(`잘못된 trustStatus: ${next.trustStatus}`);
  }
  next.updatedAt = next.updatedAt || new Date().toISOString();
  meta[key] = next;
  return meta;
}

export function getFieldMetaEntry(fieldMeta, field) {
  const meta = parseFieldMetaJson(fieldMeta);
  const entry = meta[field];
  return entry && typeof entry === 'object' ? entry : null;
}

/**
 * 필드 단위 근거 사용 가능 여부 (행 폴백 포함)
 */
export function fieldCanUseAsFact(rowLike, field, now = new Date()) {
  const entry = getFieldMetaEntry(rowLike?.fieldMeta ?? rowLike?.field_meta_json, field);
  const source = entry?.source ?? rowLike?.source;
  const trustStatus = entry?.trustStatus ?? rowLike?.trustStatus ?? rowLike?.trust_status;
  const verifiedAt = rowLike?.verifiedAt ?? rowLike?.verified_at;
  const validFrom = entry?.validFrom ?? rowLike?.validFrom ?? rowLike?.valid_from;
  const validTo = entry?.validTo ?? rowLike?.validTo ?? rowLike?.valid_to;
  return canUseAsVerifiedFact({
    trustStatus,
    source,
    verifiedAt,
    validFrom,
    validTo,
    now,
  });
}
