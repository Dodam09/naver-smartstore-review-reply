/**
 * Phase 1-B: 문의 상품 on-demand 상세 수집 + 판매자 승인/거부.
 * 승인 지식 불변은 upsertProductKnowledge / mergeAutoCollect에 위임.
 */
import { contentHash } from './knowledge-meta.js';
import { fieldCanUseAsFact } from './knowledge-meta.js';
import {
  PRODUCT_CONTENT_FIELDS,
  getProductFieldValue,
  normalizeStoreId,
} from './knowledge-protect.js';
import {
  getCommerceProductSync,
  getProductKnowledge,
  listCommerceProductSync,
  listProductKnowledge,
  setProductKnowledgeField,
  upsertCommerceProductSync,
  upsertProductKnowledge,
  getCommerceSyncRun,
} from './db.js';
import { getValidAccessToken } from './commerce-oauth.js';
import { getCommerceChannelProduct } from './commerce-api.js';
import { getCommerceSyncStatus } from './commerce-sync.js';
import {
  isCommerceLeaseHeld,
  releaseCommerceLease,
  tryAcquireCommerceLease,
} from './commerce-lease.js';

function nowSql() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function buildDetailContentHash(normalized) {
  return contentHash(
    JSON.stringify({
      channelProductNo: normalized.channelProductNo,
      originProductNo: normalized.originProductNo,
      status: normalized.status,
      knowledgeFields: normalized.knowledgeFields,
      presentFields: normalized.presentFields,
    })
  );
}

/**
 * 문의에 연결된 channelProductNo만 상세 조회.
 * force=false 이고 detail_content_hash 동일하면 API 생략.
 */
export async function fetchCommerceProductDetail(
  userId,
  { storeId, channelProductNo, force = false, signal } = {}
) {
  const scope = normalizeStoreId(storeId);
  const no = String(channelProductNo || '').replace(/[^\d]/g, '');
  if (!no) {
    const err = new Error('channelProductNo가 필요합니다.');
    err.code = 'BAD_PRODUCT_NO';
    throw err;
  }

  const acquired = tryAcquireCommerceLease({
    jobType: 'detail',
    userId,
    storeId: scope,
    productNo: no,
  });
  if (!acquired.ok) {
    const err = new Error('이미 해당 상품 상세 수집이 진행 중입니다.');
    err.code = 'DETAIL_IN_PROGRESS';
    throw err;
  }

  try {
    const prevSync = getCommerceProductSync(userId, no, { storeId: scope });

    let accessToken;
    try {
      accessToken = await getValidAccessToken(userId, { storeId: scope });
    } catch (err) {
      recordDetailFailure(userId, no, scope, prevSync, err);
      throw err;
    }

    let normalized;
    try {
      normalized = await getCommerceChannelProduct({
        accessToken,
        channelProductNo: no,
        signal,
        userId,
        storeId: scope,
      });
    } catch (err) {
      // 조회 실패·삭제·중지만으로 승인 지식 삭제/무효화 금지 — sync 오류만 기록
      recordDetailFailure(userId, no, scope, prevSync, err);
      throw err;
    }

    const hash = buildDetailContentHash(normalized);
    if (!force && prevSync?.detail_content_hash && prevSync.detail_content_hash === hash) {
      return {
        skipped: true,
        reason: 'unchanged',
        channelProductNo: no,
        storeId: scope,
        detailFetchedAt: prevSync.detail_fetched_at,
        knowledge: getProductKnowledge(userId, no, { storeId: scope }),
        sync: getCommerceProductSync(userId, no, { storeId: scope }),
      };
    }

    // 목록 상태만 갱신(판매중지 등). 지식 행은 삭제하지 않음.
    upsertCommerceProductSync(userId, {
      storeId: scope,
      channelProductNo: no,
      originProductNo: normalized.originProductNo || prevSync?.origin_product_no || '',
      productName: normalized.productName || prevSync?.product_name || '',
      status: normalized.status || prevSync?.status || '',
      contentHash: prevSync?.content_hash || contentHash(no),
      lastSyncedAt: prevSync?.last_synced_at || null,
      detailContentHash: hash,
      detailFetchedAt: nowSql(),
      detailOk: 1,
      detailError: '',
      detailRawJson: JSON.stringify(normalized.raw || {}).slice(0, 200000),
      rawJson: prevSync?.raw_json || '',
    });

    const kbPayload = {
      storeId: scope,
      productNo: no,
      source: 'NAVER_PRODUCT',
      verifiedAt: null,
      trustStatus: 'unverified',
      ...normalized.knowledgeFields,
    };

    const before = getProductKnowledge(userId, no, { storeId: scope });
    const knowledge = upsertProductKnowledge(userId, kbPayload);
    const conflicts = [];
    if (knowledge?.fieldMeta) {
      for (const [field, meta] of Object.entries(knowledge.fieldMeta)) {
        if (meta?.trustStatus === 'conflict') {
          conflicts.push({
            field,
            approved: getProductFieldValue(knowledge, field),
            scraped: meta.scrapedValue || '',
          });
        }
      }
    }

    return {
      skipped: false,
      channelProductNo: no,
      storeId: scope,
      presentFields: normalized.presentFields,
      status: normalized.status,
      detailFetchedAt: nowSql(),
      created: !before,
      conflicts,
      knowledge,
      sync: getCommerceProductSync(userId, no, { storeId: scope }),
    };
  } finally {
    releaseCommerceLease(acquired.leaseKey, acquired.ownerToken);
  }
}

function recordDetailFailure(userId, channelProductNo, storeId, prevSync, err) {
  upsertCommerceProductSync(userId, {
    storeId,
    channelProductNo,
    originProductNo: prevSync?.origin_product_no || '',
    productName: prevSync?.product_name || '',
    status: prevSync?.status || '',
    contentHash: prevSync?.content_hash || contentHash(channelProductNo),
    lastSyncedAt: prevSync?.last_synced_at || null,
    detailContentHash: prevSync?.detail_content_hash || '',
    detailFetchedAt: prevSync?.detail_fetched_at || null,
    detailOk: 0,
    detailError: String(err?.message || err).slice(0, 1000),
    detailRawJson: prevSync?.detail_raw_json || '',
    rawJson: prevSync?.raw_json || '',
    lastError: String(err?.message || err).slice(0, 1000),
  });
}

/**
 * 자동수집(또는 conflict scraped) 값을 판매자 승인.
 * useScraped=true(기본): conflict 시 scrapedValue로 본문 교체 후 approved.
 */
export function approveCommerceProductField(
  userId,
  { storeId, channelProductNo, field, value, useScraped = true } = {}
) {
  const scope = normalizeStoreId(storeId);
  const no = String(channelProductNo || '').replace(/[^\d]/g, '');
  const def = PRODUCT_CONTENT_FIELDS.find((f) => f.key === field);
  if (!def) {
    const err = new Error('허용되지 않은 필드입니다.');
    err.code = 'BAD_FIELD';
    throw err;
  }
  const existing = getProductKnowledge(userId, no, { storeId: scope });
  if (!existing) {
    const err = new Error('상품 지식을 찾을 수 없습니다.');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const meta = existing.fieldMeta?.[field] || {};
  let nextValue = value != null ? String(value) : '';
  if (!nextValue && useScraped && meta.scrapedValue) {
    nextValue = String(meta.scrapedValue);
  }
  if (!nextValue) {
    nextValue = getProductFieldValue(existing, field);
  }
  if (!String(nextValue).trim()) {
    const err = new Error('승인할 내용이 없습니다.');
    err.code = 'EMPTY_VALUE';
    throw err;
  }

  return setProductKnowledgeField(userId, no, field, nextValue, {
    storeId: scope,
    source: 'SELLER_APPROVED',
    trustStatus: 'approved',
    verifiedAt: nowSql(),
  });
}

/**
 * 자동수집 거부: conflict면 승인본 유지·scraped 제거, unverified면 dismissed.
 */
export function rejectCommerceProductField(userId, { storeId, channelProductNo, field } = {}) {
  const scope = normalizeStoreId(storeId);
  const no = String(channelProductNo || '').replace(/[^\d]/g, '');
  const def = PRODUCT_CONTENT_FIELDS.find((f) => f.key === field);
  if (!def) {
    const err = new Error('허용되지 않은 필드입니다.');
    err.code = 'BAD_FIELD';
    throw err;
  }
  const existing = getProductKnowledge(userId, no, { storeId: scope });
  if (!existing) {
    const err = new Error('상품 지식을 찾을 수 없습니다.');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const meta = existing.fieldMeta?.[field] || {};
  const trust = meta.trustStatus || existing.trustStatus;

  if (trust === 'conflict' || meta.scrapedValue) {
    // 승인 본문 유지, scraped 메타만 제거 → approved 복구
    return setProductKnowledgeField(userId, no, field, getProductFieldValue(existing, field), {
      storeId: scope,
      source: meta.source || 'SELLER_APPROVED',
      trustStatus: 'approved',
      verifiedAt: existing.verifiedAt || nowSql(),
    });
  }

  // unverified 자동수집 거부
  return setProductKnowledgeField(userId, no, field, getProductFieldValue(existing, field), {
    storeId: scope,
    source: meta.source || existing.source || 'NAVER_PRODUCT',
    trustStatus: 'dismissed',
    verifiedAt: existing.verifiedAt || null,
  });
}

function summarizeProductFields(kb) {
  if (!kb) return [];
  return PRODUCT_CONTENT_FIELDS.map((def) => {
    const value = getProductFieldValue(kb, def.key);
    const meta = kb.fieldMeta?.[def.key] || {};
    const trust = meta.trustStatus || kb.trustStatus || 'unverified';
    return {
      field: def.key,
      label: def.camel,
      hasValue: !!String(value || '').trim(),
      valuePreview: String(value || '').slice(0, 120),
      source: meta.source || kb.source || '',
      trustStatus: trust,
      scrapedValue: meta.scrapedValue || '',
      scrapedAt: meta.scrapedAt || null,
      usableAsFact: fieldCanUseAsFact(kb, def.key),
      conflict: trust === 'conflict',
    };
  }).filter((f) => f.hasValue || f.conflict || f.scrapedValue);
}

/** 상품정보 관리 UI용 카탈로그 요약 (토큰 미포함) */
export function getCommerceProductCatalog(userId, { storeId } = {}) {
  const scope = normalizeStoreId(storeId);
  const syncStatus = getCommerceSyncStatus(userId, { storeId: scope });
  const listRows = listCommerceProductSync(userId, { storeId: scope });
  const kbRows = listProductKnowledge(userId, { storeId: scope });
  const kbByNo = new Map(kbRows.map((r) => [r.productNo, r]));

  const items = listRows.map((row) => {
    const no = row.channel_product_no;
    const kb = kbByNo.get(no) || null;
    const fields = summarizeProductFields(kb);
    return {
      channelProductNo: no,
      originProductNo: row.origin_product_no || '',
      productName: row.product_name || kb?.productName || '',
      listStatus: row.status || '',
      listSyncedAt: row.last_synced_at || null,
      detailFetched: !!(row.detail_fetched_at || row.detail_content_hash),
      detailOk: row.detail_ok === 1 || row.detail_ok === true,
      detailFetchedAt: row.detail_fetched_at || null,
      detailError: row.detail_error || '',
      knowledgeSource: kb?.source || null,
      knowledgeTrust: kb?.trustStatus || null,
      conflictCount: fields.filter((f) => f.conflict).length,
      fields,
    };
  });

  // 목록에 없지만 KB만 있는 상품(수동 등록)도 표시
  for (const kb of kbRows) {
    if (items.some((i) => i.channelProductNo === kb.productNo)) continue;
    const fields = summarizeProductFields(kb);
    items.push({
      channelProductNo: kb.productNo,
      originProductNo: '',
      productName: kb.productName || '',
      listStatus: '',
      listSyncedAt: null,
      detailFetched: false,
      detailOk: false,
      detailFetchedAt: null,
      detailError: '',
      knowledgeSource: kb.source || null,
      knowledgeTrust: kb.trustStatus || null,
      conflictCount: fields.filter((f) => f.conflict).length,
      fields,
      manualOnly: true,
    });
  }

  return {
    storeId: scope,
    catalogCount: listRows.length,
    knowledgeCount: kbRows.length,
    sync: syncStatus,
    run: getCommerceSyncRun(userId, { storeId: scope }),
    items,
  };
}

export function isCommerceDetailRunning(userId, storeId, channelProductNo) {
  const no = String(channelProductNo || '').replace(/[^\d]/g, '');
  return isCommerceLeaseHeld('detail', userId, storeId, no);
}
