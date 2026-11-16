/**
 * Phase 0: 자동수집(NAVER_PRODUCT 등)이 판매자 승인 지식을 덮어쓰지 않도록 보호.
 */
import {
  contentHash,
  getFieldMetaEntry,
  isUnverifiedByDefaultSource,
  mergeFieldMeta,
  normalizeFactText,
  normalizeSource,
  parseFieldMetaJson,
  resolveTrustStatus,
  stringifyFieldMeta,
} from './knowledge-meta.js';

/** 스토어 미식별 레거시 데이터. 임의 스토어로 매핑하지 않음. */
export const UNSCOPED_STORE_ID = '';

export const PRODUCT_CONTENT_FIELDS = Object.freeze([
  { key: 'product_name', camel: 'productName', max: 200 },
  { key: 'detail_description', camel: 'detailDescription', max: 20000 },
  { key: 'specs', camel: 'specs', max: 8000 },
  { key: 'usage', camel: 'usage', max: 8000 },
  { key: 'options_compat', camel: 'optionsCompat', max: 8000 },
  { key: 'cautions', camel: 'cautions', max: 8000 },
  { key: 'extra', camel: 'extra', max: 8000 },
]);

export function normalizeStoreId(storeId) {
  if (storeId == null) return UNSCOPED_STORE_ID;
  return String(storeId).trim().slice(0, 64);
}

/** 자동수집으로 취급해 승인 필드를 보호해야 하는 출처 */
export function isAutoCollectSource(source) {
  const n = normalizeSource(source);
  return n === 'NAVER_PRODUCT' || n === 'AI_DERIVED';
}

export function getProductFieldValue(row, fieldKey) {
  if (!row) return '';
  const def = PRODUCT_CONTENT_FIELDS.find((f) => f.key === fieldKey);
  if (!def) return '';
  if (row[def.camel] != null) return String(row[def.camel]);
  if (row[def.key] != null) return String(row[def.key]);
  return '';
}

/**
 * 판매자가 승인한(또는 승인 후 conflict로만 표시된) 필드는 본문 보호 대상.
 */
export function isProtectedApprovedField(existing, fieldKey) {
  if (!existing) return false;
  const entry = getFieldMetaEntry(existing.fieldMeta ?? existing.field_meta_json, fieldKey);
  if (entry?.trustStatus === 'approved' || entry?.trustStatus === 'conflict') {
    return true;
  }
  if (entry?.trustStatus === 'dismissed' || entry?.trustStatus === 'unverified') {
    return false;
  }

  const rowTrust = resolveTrustStatus({
    trustStatus: existing.trustStatus ?? existing.trust_status,
    source: existing.source,
    verifiedAt: existing.verifiedAt ?? existing.verified_at,
  });
  const src = normalizeSource(entry?.source ?? existing.source);
  if (rowTrust !== 'approved') return false;
  if (isUnverifiedByDefaultSource(src)) return false;
  const val = getProductFieldValue(existing, fieldKey).trim();
  return !!val;
}

/**
 * 자동수집 payload를 기존 승인 지식과 병합.
 * - 승인 본문·승인 meta 유지
 * - 값 불일치 시 field trustStatus=conflict + scraped* 메타만 갱신
 * - 비보호 필드만 수집값으로 채움
 */
export function mergeAutoCollectProductPayload(existing, incoming = {}) {
  const conflicts = [];
  let fieldMeta = parseFieldMetaJson(existing?.fieldMeta ?? existing?.field_meta_json);

  const out = {
    productName: getProductFieldValue(existing, 'product_name'),
    detailDescription: getProductFieldValue(existing, 'detail_description'),
    specs: getProductFieldValue(existing, 'specs'),
    usage: getProductFieldValue(existing, 'usage'),
    optionsCompat: getProductFieldValue(existing, 'options_compat'),
    cautions: getProductFieldValue(existing, 'cautions'),
    extra: getProductFieldValue(existing, 'extra'),
  };

  const incomingByCamel = {
    productName: String(incoming.productName ?? incoming.product_name ?? '').slice(0, 200),
    detailDescription: String(incoming.detailDescription ?? incoming.detail_description ?? '').slice(
      0,
      20000
    ),
    specs: String(incoming.specs ?? '').slice(0, 8000),
    usage: String(incoming.usage ?? '').slice(0, 8000),
    optionsCompat: String(incoming.optionsCompat ?? incoming.options_compat ?? '').slice(0, 8000),
    cautions: String(incoming.cautions ?? '').slice(0, 8000),
    extra: String(incoming.extra ?? '').slice(0, 8000),
  };

  for (const def of PRODUCT_CONTENT_FIELDS) {
    const nextVal = incomingByCamel[def.camel];
    const prevVal = out[def.camel];
    const protectedField = isProtectedApprovedField(existing, def.key);

    if (!protectedField) {
      // 자동수집: 빈 값은「미제공」으로 보고 기존 unverified 본문을 지우지 않음
      // (목록 sync가 상세 필드를 비워 보내도 on-demand 상세를 보존)
      if (nextVal !== undefined && nextVal !== null && String(nextVal).trim()) {
        out[def.camel] = nextVal;
        fieldMeta = mergeFieldMeta(fieldMeta, def.key, {
          source: normalizeSource(incoming.source || 'NAVER_PRODUCT'),
          trustStatus: 'unverified',
          scrapedAt: new Date().toISOString(),
        });
      }
      continue;
    }

    // 승인/충돌 보호 필드: 본문 유지
    out[def.camel] = prevVal;
    const prevEntry = getFieldMetaEntry(fieldMeta, def.key) || {};
    const same = normalizeFactText(prevVal) === normalizeFactText(nextVal);
    if (!same && String(nextVal || '').trim()) {
      conflicts.push({ field: def.key, approved: prevVal, scraped: nextVal });
      fieldMeta = mergeFieldMeta(fieldMeta, def.key, {
        source: prevEntry.source || normalizeSource(existing.source) || 'SELLER_APPROVED',
        trustStatus: 'conflict',
        scrapedValue: nextVal,
        scrapedSource: normalizeSource(incoming.source || 'NAVER_PRODUCT'),
        scrapedHash: contentHash(nextVal),
        scrapedAt: new Date().toISOString(),
        approvedHash: contentHash(prevVal),
      });
    } else {
      // 동일하거나 수집값이 비어 있으면 승인 meta 유지 (trust/source 불변)
      fieldMeta = mergeFieldMeta(fieldMeta, def.key, {
        source: prevEntry.source || normalizeSource(existing.source) || 'SELLER_APPROVED',
        trustStatus: prevEntry.trustStatus === 'conflict' ? 'conflict' : 'approved',
        validFrom: prevEntry.validFrom,
        validTo: prevEntry.validTo,
      });
    }
  }

  // 행 단위: 승인 출처/ trust / verifiedAt 을 자동수집이 덮지 않음
  const preserveRowApproval =
    resolveTrustStatus({
      trustStatus: existing.trustStatus ?? existing.trust_status,
      source: existing.source,
      verifiedAt: existing.verifiedAt ?? existing.verified_at,
    }) === 'approved' ||
    PRODUCT_CONTENT_FIELDS.some((f) => isProtectedApprovedField(existing, f.key));

  return {
    ...out,
    source: preserveRowApproval ? existing.source : incoming.source || 'NAVER_PRODUCT',
    trustStatus: preserveRowApproval
      ? existing.trustStatus ?? existing.trust_status ?? null
      : 'unverified',
    verifiedAt: preserveRowApproval
      ? existing.verifiedAt ?? existing.verified_at ?? null
      : null,
    validFrom: existing.validFrom ?? existing.valid_from ?? incoming.validFrom ?? incoming.valid_from,
    validTo: existing.validTo ?? existing.valid_to ?? incoming.validTo ?? incoming.valid_to,
    fieldMeta,
    fieldMetaJson: stringifyFieldMeta(fieldMeta),
    conflicts,
    preserveRowApproval,
  };
}
