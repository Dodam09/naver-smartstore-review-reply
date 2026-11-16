/**
 * 상품 목록 동기화 → commerce_product_sync + product_knowledge(NAVER_PRODUCT).
 * Phase 1-D: DB lease 기반 중복 방지 + stale running 복구.
 */
import { contentHash } from './knowledge-meta.js';
import { normalizeStoreId } from './knowledge-protect.js';
import {
  getCommerceProductSync,
  getCommerceSyncRun,
  listCommerceProductSync,
  upsertCommerceProductSync,
  upsertCommerceSyncRun,
  upsertProductKnowledge,
  getProductKnowledge,
} from './db.js';
import { getValidAccessToken } from './commerce-oauth.js';
import { normalizeCommerceListItem, searchCommerceProducts } from './commerce-api.js';
import {
  isCommerceLeaseHeld,
  recoverStaleCommerceSyncRuns,
  releaseCommerceLease,
  tryAcquireCommerceLease,
} from './commerce-lease.js';

function buildListContentHash(item) {
  const n = normalizeCommerceListItem(item);
  return contentHash(
    JSON.stringify({
      channelProductNo: n.channelProductNo,
      originProductNo: n.originProductNo,
      productName: n.productName,
      status: n.status,
    })
  );
}

export function isCommerceSyncRunning(userId, storeId) {
  recoverStaleCommerceSyncRuns({ userId, storeId });
  return isCommerceLeaseHeld('catalog', userId, storeId);
}

/**
 * @returns {{ storeId, pages, products, created, updated, skipped, conflicts }}
 */
export async function syncCommerceProductCatalog(
  userId,
  {
    storeId,
    pageSize = 50,
    maxPages = 100,
    signal,
    productStatusTypes = ['SALE', 'OUTOFSTOCK'],
  } = {}
) {
  const scope = normalizeStoreId(storeId);
  recoverStaleCommerceSyncRuns({ userId, storeId: scope });

  const acquired = tryAcquireCommerceLease({
    jobType: 'catalog',
    userId,
    storeId: scope,
  });
  if (!acquired.ok) {
    const err = new Error('이미 상품 목록 동기화가 진행 중입니다.');
    err.code = 'SYNC_IN_PROGRESS';
    throw err;
  }

  const startedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
  upsertCommerceSyncRun(userId, {
    storeId: scope,
    status: 'running',
    pages: 0,
    products: 0,
    startedAt,
    finishedAt: null,
    lastError: '',
  });

  const stats = {
    storeId: scope,
    pages: 0,
    products: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    conflicts: 0,
    productStatusTypes,
  };

  try {
    const accessToken = await getValidAccessToken(userId, { storeId: scope });
    let page = 1;
    let totalPages = null;

    while (page <= maxPages) {
      if (signal?.aborted) {
        const err = new Error('요청이 취소되었습니다.');
        err.name = 'AbortError';
        throw err;
      }

      const result = await searchCommerceProducts({
        accessToken,
        page,
        size: pageSize,
        productStatusTypes,
        signal,
        userId,
        storeId: scope,
      });
      stats.pages += 1;
      const items = result.contents || [];
      if (result.totalPages != null) totalPages = Number(result.totalPages);

      for (const raw of items) {
        const n = normalizeCommerceListItem(raw);
        if (!n.channelProductNo) {
          stats.skipped += 1;
          continue;
        }
        const hash = buildListContentHash(raw);
        const prev = getCommerceProductSync(userId, n.channelProductNo, { storeId: scope });
        const unchanged = prev && prev.content_hash === hash;
        if (unchanged) {
          stats.skipped += 1;
          stats.products += 1;
          continue;
        }

        upsertCommerceProductSync(userId, {
          storeId: scope,
          channelProductNo: n.channelProductNo,
          originProductNo: n.originProductNo,
          productName: n.productName,
          status: n.status,
          contentHash: hash,
          rawJson: JSON.stringify(raw).slice(0, 200000),
          lastError: '',
        });

        const before = getProductKnowledge(userId, n.channelProductNo, { storeId: scope });
        const after = upsertProductKnowledge(userId, {
          storeId: scope,
          productNo: n.channelProductNo,
          productName: n.productName || before?.productName || '',
          source: 'NAVER_PRODUCT',
          verifiedAt: null,
          trustStatus: 'unverified',
        });

        if (!before) stats.created += 1;
        else stats.updated += 1;
        if (after?.fieldMeta) {
          const conflicted = Object.values(after.fieldMeta).some((m) => m?.trustStatus === 'conflict');
          if (conflicted) stats.conflicts += 1;
        }
        stats.products += 1;
      }

      if (!items.length) break;
      if (totalPages != null && page >= totalPages) break;
      if (items.length < pageSize) break;
      page += 1;
    }

    upsertCommerceSyncRun(userId, {
      storeId: scope,
      status: 'idle',
      pages: stats.pages,
      products: stats.products,
      startedAt,
      finishedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      lastError: '',
    });
    return stats;
  } catch (err) {
    upsertCommerceSyncRun(userId, {
      storeId: scope,
      status: 'error',
      pages: stats.pages,
      products: stats.products,
      startedAt,
      finishedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      lastError: String(err?.message || err).slice(0, 1000),
    });
    throw err;
  } finally {
    releaseCommerceLease(acquired.leaseKey, acquired.ownerToken);
  }
}

export function getCommerceSyncStatus(userId, { storeId } = {}) {
  const scope = normalizeStoreId(storeId);
  recoverStaleCommerceSyncRuns({ userId, storeId: scope });
  const run = getCommerceSyncRun(userId, { storeId: scope });
  const products = listCommerceProductSync(userId, { storeId: scope });
  return {
    ...run,
    running: isCommerceLeaseHeld('catalog', userId, scope) || run.status === 'running',
    catalogCount: products.length,
  };
}
