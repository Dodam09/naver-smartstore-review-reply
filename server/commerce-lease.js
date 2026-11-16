/**
 * Phase 1-D: DB 기반 sync/detail lease + stale running 복구.
 * better-sqlite3 단일 파일에서도 다중 프로세스 간 원자적 잠금.
 */
import crypto from 'node:crypto';
import { getDb } from './db.js';
import { normalizeStoreId } from './knowledge-protect.js';

const DEFAULT_TTL_MS = Number(process.env.COMMERCE_LEASE_TTL_MS || 15 * 60 * 1000);
const STALE_RUN_MS = Number(process.env.COMMERCE_SYNC_STALE_MS || 20 * 60 * 1000);

function nowMs() {
  return Date.now();
}

function isoFromMs(ms) {
  return new Date(ms).toISOString();
}

export function ensureCommerceLeaseTable(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS commerce_job_leases (
      lease_key TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      store_id TEXT NOT NULL DEFAULT '',
      job_type TEXT NOT NULL,
      owner_token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_commerce_lease_expires ON commerce_job_leases(expires_at);
  `);
}

function leaseKey(jobType, userId, storeId, productNo = '') {
  const scope = normalizeStoreId(storeId);
  if (jobType === 'detail') {
    const no = String(productNo || '').replace(/[^\d]/g, '');
    return `detail:${userId}:${scope}:${no}`;
  }
  return `catalog:${userId}:${scope}`;
}

/**
 * 만료된 lease 삭제. 진행 중(미만료) lease는 건드리지 않음.
 */
export function purgeExpiredCommerceLeases(now = nowMs()) {
  const db = getDb();
  return db
    .prepare(`DELETE FROM commerce_job_leases WHERE expires_at <= ?`)
    .run(isoFromMs(now)).changes;
}

/**
 * @returns {{ ok: true, ownerToken, expiresAt } | { ok: false, code, holder? }}
 */
export function tryAcquireCommerceLease({
  jobType,
  userId,
  storeId,
  productNo = '',
  ttlMs = DEFAULT_TTL_MS,
  ownerToken = crypto.randomBytes(16).toString('hex'),
} = {}) {
  const db = getDb();
  const key = leaseKey(jobType, userId, storeId, productNo);
  const scope = normalizeStoreId(storeId);
  const now = nowMs();
  purgeExpiredCommerceLeases(now);

  const existing = db.prepare(`SELECT * FROM commerce_job_leases WHERE lease_key = ?`).get(key);
  if (existing) {
    const exp = Date.parse(existing.expires_at);
    if (Number.isFinite(exp) && exp > now) {
      return {
        ok: false,
        code: 'LEASE_HELD',
        holder: {
          ownerToken: existing.owner_token,
          expiresAt: existing.expires_at,
          jobType: existing.job_type,
        },
      };
    }
    db.prepare(`DELETE FROM commerce_job_leases WHERE lease_key = ?`).run(key);
  }

  const expiresAt = isoFromMs(now + Math.max(5_000, Number(ttlMs) || DEFAULT_TTL_MS));
  try {
    db.prepare(
      `INSERT INTO commerce_job_leases (
         lease_key, user_id, store_id, job_type, owner_token, expires_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    ).run(key, userId, scope, jobType, ownerToken, expiresAt);
  } catch {
    // 경쟁 INSERT
    return { ok: false, code: 'LEASE_HELD' };
  }
  return { ok: true, ownerToken, expiresAt, leaseKey: key };
}

export function renewCommerceLease(leaseKeyValue, ownerToken, ttlMs = DEFAULT_TTL_MS) {
  const db = getDb();
  const now = nowMs();
  const expiresAt = isoFromMs(now + Math.max(5_000, Number(ttlMs) || DEFAULT_TTL_MS));
  const result = db
    .prepare(
      `UPDATE commerce_job_leases
       SET expires_at = ?, updated_at = datetime('now')
       WHERE lease_key = ? AND owner_token = ? AND expires_at > ?`
    )
    .run(expiresAt, leaseKeyValue, ownerToken, isoFromMs(now));
  return result.changes > 0 ? { ok: true, expiresAt } : { ok: false, code: 'LEASE_NOT_OWNED' };
}

export function releaseCommerceLease(leaseKeyValue, ownerToken) {
  const db = getDb();
  const result = db
    .prepare(`DELETE FROM commerce_job_leases WHERE lease_key = ? AND owner_token = ?`)
    .run(leaseKeyValue, ownerToken);
  return result.changes > 0;
}

/**
 * sync_runs.status=running 이지만 lease가 없고 started_at이 TTL 초과면 idle로 복구.
 * 정상 진행 중(유효 lease 보유) 작업은 종료하지 않음.
 */
export function recoverStaleCommerceSyncRuns({ userId, storeId, staleMs = STALE_RUN_MS } = {}) {
  const db = getDb();
  const scope = storeId != null ? normalizeStoreId(storeId) : null;
  const cutoff = isoFromMs(nowMs() - Math.max(60_000, Number(staleMs) || STALE_RUN_MS));
  purgeExpiredCommerceLeases();

  const rows = scope
    ? db
        .prepare(
          `SELECT * FROM commerce_sync_runs WHERE user_id = ? AND store_id = ? AND status = 'running'`
        )
        .all(userId, scope)
    : userId != null
      ? db
          .prepare(`SELECT * FROM commerce_sync_runs WHERE user_id = ? AND status = 'running'`)
          .all(userId)
      : db.prepare(`SELECT * FROM commerce_sync_runs WHERE status = 'running'`).all();

  let recovered = 0;
  for (const row of rows) {
    const key = leaseKey('catalog', row.user_id, row.store_id);
    const lease = db.prepare(`SELECT * FROM commerce_job_leases WHERE lease_key = ?`).get(key);
    const leaseAlive =
      lease && Number.isFinite(Date.parse(lease.expires_at)) && Date.parse(lease.expires_at) > nowMs();
    if (leaseAlive) continue;

    const started = row.started_at || row.updated_at;
    if (started && started > cutoff) {
      // 최근 시작인데 lease만 없음 → 즉시 복구하지 않고 보수적으로 유지
      // (프로세스 crash 직후) started가 cutoff보다 오래되면 복구
      continue;
    }
    if (!started || started <= cutoff) {
      db.prepare(
        `UPDATE commerce_sync_runs
         SET status = 'idle',
             last_error = CASE
               WHEN last_error = '' THEN 'stale running recovered'
               ELSE last_error
             END,
             finished_at = COALESCE(finished_at, datetime('now')),
             updated_at = datetime('now')
         WHERE user_id = ? AND store_id = ? AND status = 'running'`
      ).run(row.user_id, row.store_id);
      recovered += 1;
    }
  }
  return { recovered };
}

export function isCommerceLeaseHeld(jobType, userId, storeId, productNo = '') {
  purgeExpiredCommerceLeases();
  const key = leaseKey(jobType, userId, storeId, productNo);
  const row = getDb().prepare(`SELECT * FROM commerce_job_leases WHERE lease_key = ?`).get(key);
  if (!row) return false;
  return Date.parse(row.expires_at) > nowMs();
}
