import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { makeKoreanNickname } from './nicknames.js';
import { DEFAULT_PLAN_ID, normalizePaidPlanId, normalizePlanId } from './plans.js';
import {
  assertValidRange,
  contentHash,
  isKnowledgeEffective,
  mergeFieldMeta,
  normalizeSource,
  parseFieldMetaJson,
  resolveTrustStatus,
  sourceForStorage,
  stringifyFieldMeta,
  trustStatusForInsert,
} from './knowledge-meta.js';
import {
  UNSCOPED_STORE_ID,
  isAutoCollectSource,
  mergeAutoCollectProductPayload,
  normalizeStoreId,
} from './knowledge-protect.js';

export { UNSCOPED_STORE_ID, normalizeStoreId } from './knowledge-protect.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db;

function getDataDir() {
  return process.env.DATA_DIR || path.join(__dirname, 'data');
}

function getDbFilePath() {
  return process.env.DB_PATH || path.join(getDataDir(), 'app.db');
}

function ensureDataDir() {
  const dataDir = getDataDir();
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function initSchema(database) {
  database.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL,
      plan_id TEXT NOT NULL DEFAULT '${DEFAULT_PLAN_ID}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS usage_monthly (
      user_id INTEGER NOT NULL,
      period TEXT NOT NULL,
      reply_count INTEGER NOT NULL DEFAULT 0,
      tone_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, period),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS usage_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      period TEXT NOT NULL,
      kind TEXT NOT NULL,
      channel TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_usage_logs_user_period ON usage_logs(user_id, period);

    CREATE TABLE IF NOT EXISTS billing_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      order_id TEXT NOT NULL UNIQUE,
      plan_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      order_name TEXT NOT NULL,
      customer_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      payment_key TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      paid_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_billing_orders_user_id ON billing_orders(user_id);

    CREATE TABLE IF NOT EXISTS analytics_installs (
      install_id TEXT PRIMARY KEY,
      user_id INTEGER,
      extension_version TEXT,
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      install_id TEXT NOT NULL,
      user_id INTEGER,
      event TEXT NOT NULL,
      meta TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (install_id) REFERENCES analytics_installs(install_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_analytics_events_install ON analytics_events(install_id);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_event ON analytics_events(event);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_created ON analytics_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_usage_logs_user_period_kind ON usage_logs(user_id, period, kind);

    CREATE TABLE IF NOT EXISTS product_knowledge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      store_id TEXT NOT NULL DEFAULT '',
      product_no TEXT NOT NULL,
      product_name TEXT NOT NULL DEFAULT '',
      detail_description TEXT NOT NULL DEFAULT '',
      specs TEXT NOT NULL DEFAULT '',
      usage TEXT NOT NULL DEFAULT '',
      options_compat TEXT NOT NULL DEFAULT '',
      cautions TEXT NOT NULL DEFAULT '',
      extra TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'manual',
      verified_at TEXT,
      trust_status TEXT,
      field_meta_json TEXT NOT NULL DEFAULT '{}',
      valid_from TEXT,
      valid_to TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, store_id, product_no),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_product_knowledge_user ON product_knowledge(user_id);
    CREATE INDEX IF NOT EXISTS idx_product_knowledge_user_store ON product_knowledge(user_id, store_id);

    CREATE TABLE IF NOT EXISTS store_policies (
      user_id INTEGER NOT NULL,
      store_id TEXT NOT NULL DEFAULT '',
      shipping TEXT NOT NULL DEFAULT '',
      exchange_return TEXT NOT NULL DEFAULT '',
      refund TEXT NOT NULL DEFAULT '',
      customer_service TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'manual',
      verified_at TEXT,
      trust_status TEXT,
      field_meta_json TEXT NOT NULL DEFAULT '{}',
      valid_from TEXT,
      valid_to TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, store_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS inquiry_confirmations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      store_id TEXT NOT NULL DEFAULT '',
      inquiry_key TEXT NOT NULL DEFAULT '',
      product_no TEXT NOT NULL DEFAULT '',
      product_name TEXT NOT NULL DEFAULT '',
      question TEXT NOT NULL DEFAULT '',
      missing_fields TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      draft_reply TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'needs_confirm',
      evidence_json TEXT NOT NULL DEFAULT '',
      confirm_prompt TEXT NOT NULL DEFAULT '',
      choice_options_json TEXT NOT NULL DEFAULT '',
      intent_key TEXT NOT NULL DEFAULT '',
      knowledge_category TEXT NOT NULL DEFAULT '',
      approved_answer TEXT NOT NULL DEFAULT '',
      approved_at TEXT,
      source TEXT NOT NULL DEFAULT '',
      trust_status TEXT,
      valid_from TEXT,
      valid_to TEXT,
      dismiss_reason TEXT NOT NULL DEFAULT '',
      kb_link_json TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS commerce_product_sync (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      store_id TEXT NOT NULL DEFAULT '',
      channel_product_no TEXT NOT NULL,
      origin_product_no TEXT NOT NULL DEFAULT '',
      product_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      content_hash TEXT NOT NULL DEFAULT '',
      last_synced_at TEXT,
      last_error TEXT NOT NULL DEFAULT '',
      raw_json TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, store_id, channel_product_no),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_commerce_sync_user_store ON commerce_product_sync(user_id, store_id);

    CREATE INDEX IF NOT EXISTS idx_inquiry_confirmations_user ON inquiry_confirmations(user_id, status);
  `);

  migrateBillingOrdersTable(database);
  migrateUsersTable(database);
  migrateLegacySubscriptionUsage(database);
  migrateKnowledgeTables(database);
}

function addColumnIfMissing(database, table, column, ddl) {
  const cols = database.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

/** 기존 DB에 지식 메타 컬럼 additive 추가 (데이터 삭제 없음) */
export function migrateKnowledgeTables(database = getDb()) {
  addColumnIfMissing(database, 'product_knowledge', 'trust_status', 'trust_status TEXT');
  addColumnIfMissing(
    database,
    'product_knowledge',
    'field_meta_json',
    "field_meta_json TEXT NOT NULL DEFAULT '{}'"
  );
  addColumnIfMissing(database, 'product_knowledge', 'valid_from', 'valid_from TEXT');
  addColumnIfMissing(database, 'product_knowledge', 'valid_to', 'valid_to TEXT');

  addColumnIfMissing(database, 'store_policies', 'trust_status', 'trust_status TEXT');
  addColumnIfMissing(
    database,
    'store_policies',
    'field_meta_json',
    "field_meta_json TEXT NOT NULL DEFAULT '{}'"
  );
  addColumnIfMissing(database, 'store_policies', 'valid_from', 'valid_from TEXT');
  addColumnIfMissing(database, 'store_policies', 'valid_to', 'valid_to TEXT');

  addColumnIfMissing(
    database,
    'inquiry_confirmations',
    'confirm_prompt',
    "confirm_prompt TEXT NOT NULL DEFAULT ''"
  );
  addColumnIfMissing(
    database,
    'inquiry_confirmations',
    'choice_options_json',
    "choice_options_json TEXT NOT NULL DEFAULT ''"
  );
  addColumnIfMissing(
    database,
    'inquiry_confirmations',
    'intent_key',
    "intent_key TEXT NOT NULL DEFAULT ''"
  );
  addColumnIfMissing(
    database,
    'inquiry_confirmations',
    'knowledge_category',
    "knowledge_category TEXT NOT NULL DEFAULT ''"
  );
  addColumnIfMissing(
    database,
    'inquiry_confirmations',
    'approved_answer',
    "approved_answer TEXT NOT NULL DEFAULT ''"
  );
  addColumnIfMissing(database, 'inquiry_confirmations', 'approved_at', 'approved_at TEXT');
  addColumnIfMissing(
    database,
    'inquiry_confirmations',
    'source',
    "source TEXT NOT NULL DEFAULT ''"
  );
  addColumnIfMissing(database, 'inquiry_confirmations', 'trust_status', 'trust_status TEXT');
  addColumnIfMissing(database, 'inquiry_confirmations', 'valid_from', 'valid_from TEXT');
  addColumnIfMissing(database, 'inquiry_confirmations', 'valid_to', 'valid_to TEXT');
  addColumnIfMissing(
    database,
    'inquiry_confirmations',
    'dismiss_reason',
    "dismiss_reason TEXT NOT NULL DEFAULT ''"
  );
  addColumnIfMissing(
    database,
    'inquiry_confirmations',
    'kb_link_json',
    "kb_link_json TEXT NOT NULL DEFAULT ''"
  );

  migrateStoreIdIsolation(database);
  ensureCommerceProductSyncTable(database);
  ensureCommerceOauthTable(database);
  ensureCommerceSyncRunTable(database);
  migrateCommerceProductDetailColumns(database);
  migrateCommerceOauthCredentialColumns(database);
  // Phase 1-D lease 테이블 (동적 import 순환 방지: SQL 인라인)
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

/**
 * Phase 0: store_id 격리.
 * 기존 행은 store_id=''(UNSCOPED)로만 보존 — 임의 스토어에 매핑하지 않음.
 */
function migrateStoreIdIsolation(database) {
  migrateProductKnowledgeStoreId(database);
  migrateStorePoliciesStoreId(database);
  addColumnIfMissing(
    database,
    'inquiry_confirmations',
    'store_id',
    "store_id TEXT NOT NULL DEFAULT ''"
  );
  database.exec(
    `CREATE INDEX IF NOT EXISTS idx_inquiry_confirmations_user_store
       ON inquiry_confirmations(user_id, store_id, status)`
  );
}

function tableSql(database, name) {
  const row = database
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`)
    .get(name);
  return String(row?.sql || '');
}

function migrateProductKnowledgeStoreId(database) {
  const cols = database.prepare(`PRAGMA table_info(product_knowledge)`).all().map((c) => c.name);
  if (!cols.length) return;
  const sql = tableSql(database, 'product_knowledge');
  const hasStoreId = cols.includes('store_id');
  const hasNewUnique = /UNIQUE\s*\(\s*user_id\s*,\s*store_id\s*,\s*product_no\s*\)/i.test(sql);
  if (hasStoreId && hasNewUnique) {
    database.exec(
      `CREATE INDEX IF NOT EXISTS idx_product_knowledge_user_store ON product_knowledge(user_id, store_id)`
    );
    return;
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS product_knowledge__p0 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      store_id TEXT NOT NULL DEFAULT '',
      product_no TEXT NOT NULL,
      product_name TEXT NOT NULL DEFAULT '',
      detail_description TEXT NOT NULL DEFAULT '',
      specs TEXT NOT NULL DEFAULT '',
      usage TEXT NOT NULL DEFAULT '',
      options_compat TEXT NOT NULL DEFAULT '',
      cautions TEXT NOT NULL DEFAULT '',
      extra TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'manual',
      verified_at TEXT,
      trust_status TEXT,
      field_meta_json TEXT NOT NULL DEFAULT '{}',
      valid_from TEXT,
      valid_to TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, store_id, product_no),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  const selectCols = [
    'user_id',
    hasStoreId ? 'store_id' : `'' AS store_id`,
    'product_no',
    'product_name',
    'detail_description',
    'specs',
    'usage',
    'options_compat',
    'cautions',
    'extra',
    'source',
    'verified_at',
    cols.includes('trust_status') ? 'trust_status' : 'NULL AS trust_status',
    cols.includes('field_meta_json') ? 'field_meta_json' : `'{}' AS field_meta_json`,
    cols.includes('valid_from') ? 'valid_from' : 'NULL AS valid_from',
    cols.includes('valid_to') ? 'valid_to' : 'NULL AS valid_to',
    'created_at',
    'updated_at',
  ].join(', ');

  database.exec(`
    INSERT OR IGNORE INTO product_knowledge__p0 (
      user_id, store_id, product_no, product_name, detail_description, specs, usage,
      options_compat, cautions, extra, source, verified_at, trust_status,
      field_meta_json, valid_from, valid_to, created_at, updated_at
    )
    SELECT ${selectCols} FROM product_knowledge;
  `);
  database.exec(`DROP TABLE product_knowledge;`);
  database.exec(`ALTER TABLE product_knowledge__p0 RENAME TO product_knowledge;`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_product_knowledge_user ON product_knowledge(user_id);`);
  database.exec(
    `CREATE INDEX IF NOT EXISTS idx_product_knowledge_user_store ON product_knowledge(user_id, store_id);`
  );
}

function migrateStorePoliciesStoreId(database) {
  const cols = database.prepare(`PRAGMA table_info(store_policies)`).all().map((c) => c.name);
  if (!cols.length) return;
  const sql = tableSql(database, 'store_policies');
  const hasStoreId = cols.includes('store_id');
  const hasCompositePk = /PRIMARY KEY\s*\(\s*user_id\s*,\s*store_id\s*\)/i.test(sql);
  if (hasStoreId && hasCompositePk) return;

  database.exec(`
    CREATE TABLE IF NOT EXISTS store_policies__p0 (
      user_id INTEGER NOT NULL,
      store_id TEXT NOT NULL DEFAULT '',
      shipping TEXT NOT NULL DEFAULT '',
      exchange_return TEXT NOT NULL DEFAULT '',
      refund TEXT NOT NULL DEFAULT '',
      customer_service TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'manual',
      verified_at TEXT,
      trust_status TEXT,
      field_meta_json TEXT NOT NULL DEFAULT '{}',
      valid_from TEXT,
      valid_to TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, store_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  const selectCols = [
    'user_id',
    hasStoreId ? 'store_id' : `'' AS store_id`,
    'shipping',
    'exchange_return',
    'refund',
    'customer_service',
    'source',
    'verified_at',
    cols.includes('trust_status') ? 'trust_status' : 'NULL AS trust_status',
    cols.includes('field_meta_json') ? 'field_meta_json' : `'{}' AS field_meta_json`,
    cols.includes('valid_from') ? 'valid_from' : 'NULL AS valid_from',
    cols.includes('valid_to') ? 'valid_to' : 'NULL AS valid_to',
    'updated_at',
  ].join(', ');

  database.exec(`
    INSERT OR IGNORE INTO store_policies__p0 (
      user_id, store_id, shipping, exchange_return, refund, customer_service,
      source, verified_at, trust_status, field_meta_json, valid_from, valid_to, updated_at
    )
    SELECT ${selectCols} FROM store_policies;
  `);
  database.exec(`DROP TABLE store_policies;`);
  database.exec(`ALTER TABLE store_policies__p0 RENAME TO store_policies;`);
}

function ensureCommerceProductSyncTable(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS commerce_product_sync (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      store_id TEXT NOT NULL DEFAULT '',
      channel_product_no TEXT NOT NULL,
      origin_product_no TEXT NOT NULL DEFAULT '',
      product_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      content_hash TEXT NOT NULL DEFAULT '',
      last_synced_at TEXT,
      last_error TEXT NOT NULL DEFAULT '',
      raw_json TEXT NOT NULL DEFAULT '',
      detail_content_hash TEXT NOT NULL DEFAULT '',
      detail_fetched_at TEXT,
      detail_ok INTEGER NOT NULL DEFAULT 0,
      detail_error TEXT NOT NULL DEFAULT '',
      detail_raw_json TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, store_id, channel_product_no),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_commerce_sync_user_store ON commerce_product_sync(user_id, store_id);
  `);
}

/** Phase 1-B: 목록 sync 테이블에 상세 수집 메타 추가 (additive) */
/** Phase 1-F: 확장에서 전달된 Client ID/Secret을 서버에만 암호화 보관(재발급용) */
function migrateCommerceOauthCredentialColumns(database) {
  addColumnIfMissing(
    database,
    'commerce_oauth_connections',
    'client_id',
    "client_id TEXT NOT NULL DEFAULT ''"
  );
  addColumnIfMissing(
    database,
    'commerce_oauth_connections',
    'client_secret_enc',
    "client_secret_enc TEXT NOT NULL DEFAULT ''"
  );
}

function migrateCommerceProductDetailColumns(database) {
  addColumnIfMissing(
    database,
    'commerce_product_sync',
    'detail_content_hash',
    "detail_content_hash TEXT NOT NULL DEFAULT ''"
  );
  addColumnIfMissing(database, 'commerce_product_sync', 'detail_fetched_at', 'detail_fetched_at TEXT');
  addColumnIfMissing(
    database,
    'commerce_product_sync',
    'detail_ok',
    'detail_ok INTEGER NOT NULL DEFAULT 0'
  );
  addColumnIfMissing(
    database,
    'commerce_product_sync',
    'detail_error',
    "detail_error TEXT NOT NULL DEFAULT ''"
  );
  addColumnIfMissing(
    database,
    'commerce_product_sync',
    'detail_raw_json',
    "detail_raw_json TEXT NOT NULL DEFAULT ''"
  );
}

function ensureCommerceOauthTable(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS commerce_oauth_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      store_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'disconnected',
      account_id TEXT NOT NULL DEFAULT '',
      access_token_enc TEXT NOT NULL DEFAULT '',
      refresh_token_enc TEXT NOT NULL DEFAULT '',
      token_type TEXT NOT NULL DEFAULT 'Bearer',
      expires_at TEXT,
      scope TEXT NOT NULL DEFAULT '',
      oauth_state TEXT NOT NULL DEFAULT '',
      last_error TEXT NOT NULL DEFAULT '',
      connected_at TEXT,
      disconnected_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, store_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_commerce_oauth_user_store
      ON commerce_oauth_connections(user_id, store_id);
  `);
}

function ensureCommerceSyncRunTable(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS commerce_sync_runs (
      user_id INTEGER NOT NULL,
      store_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'idle',
      pages INTEGER NOT NULL DEFAULT 0,
      products INTEGER NOT NULL DEFAULT 0,
      started_at TEXT,
      finished_at TEXT,
      last_error TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, store_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
}

function migrateBillingOrdersTable(database) {
  const cols = database.prepare('PRAGMA table_info(billing_orders)').all().map((c) => c.name);
  if (!cols.includes('order_kind')) {
    database.exec(`ALTER TABLE billing_orders ADD COLUMN order_kind TEXT NOT NULL DEFAULT 'payment'`);
  }
  if (!cols.includes('legal_consent_at')) {
    database.exec(`ALTER TABLE billing_orders ADD COLUMN legal_consent_at TEXT`);
  }
  if (!cols.includes('usage_applied')) {
    database.exec(`ALTER TABLE billing_orders ADD COLUMN usage_applied INTEGER NOT NULL DEFAULT 0`);
  }
  if (!cols.includes('idempotency_key')) {
    database.exec(`ALTER TABLE billing_orders ADD COLUMN idempotency_key TEXT`);
  }
  if (!cols.includes('idempotency_created_at')) {
    database.exec(`ALTER TABLE billing_orders ADD COLUMN idempotency_created_at TEXT`);
  }
  if (!cols.includes('idempotency_sent_at')) {
    database.exec(`ALTER TABLE billing_orders ADD COLUMN idempotency_sent_at TEXT`);
  }
  if (!cols.includes('charge_billing_key')) {
    database.exec(`ALTER TABLE billing_orders ADD COLUMN charge_billing_key TEXT`);
  }
  if (!cols.includes('charge_fingerprint')) {
    database.exec(`ALTER TABLE billing_orders ADD COLUMN charge_fingerprint TEXT`);
  }
  if (!cols.includes('recovery_attempts')) {
    database.exec(`ALTER TABLE billing_orders ADD COLUMN recovery_attempts INTEGER NOT NULL DEFAULT 0`);
  }
  if (!cols.includes('next_recovery_at')) {
    database.exec(`ALTER TABLE billing_orders ADD COLUMN next_recovery_at TEXT`);
  }
  if (!cols.includes('last_recovery_at')) {
    database.exec(`ALTER TABLE billing_orders ADD COLUMN last_recovery_at TEXT`);
  }
  if (!cols.includes('failure_reason')) {
    database.exec(`ALTER TABLE billing_orders ADD COLUMN failure_reason TEXT`);
  }
  if (!cols.includes('last_webhook_event_id')) {
    database.exec(`ALTER TABLE billing_orders ADD COLUMN last_webhook_event_id TEXT`);
  }
}

function migrateUsersTable(database) {
  const cols = database.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('subscription_status')) {
    database.exec(`ALTER TABLE users ADD COLUMN subscription_status TEXT NOT NULL DEFAULT 'none'`);
  }
  if (!cols.includes('subscription_expires_at')) {
    database.exec(`ALTER TABLE users ADD COLUMN subscription_expires_at TEXT`);
  }
  if (!cols.includes('customer_key')) {
    database.exec(`ALTER TABLE users ADD COLUMN customer_key TEXT`);
  }
  if (!cols.includes('kakao_id')) {
    database.exec(`ALTER TABLE users ADD COLUMN kakao_id TEXT`);
    database.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_kakao_id ON users(kakao_id) WHERE kakao_id IS NOT NULL`
    );
  }
  if (!cols.includes('auth_provider')) {
    database.exec(`ALTER TABLE users ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'email'`);
  }
  if (!cols.includes('display_name')) {
    database.exec(`ALTER TABLE users ADD COLUMN display_name TEXT`);
  }
  if (!cols.includes('auto_renew')) {
    database.exec(`ALTER TABLE users ADD COLUMN auto_renew INTEGER NOT NULL DEFAULT 0`);
  }
  if (!cols.includes('billing_key')) {
    database.exec(`ALTER TABLE users ADD COLUMN billing_key TEXT`);
  }
  if (!cols.includes('renewal_fail_count')) {
    database.exec(`ALTER TABLE users ADD COLUMN renewal_fail_count INTEGER NOT NULL DEFAULT 0`);
  }
  if (!cols.includes('renewal_last_attempt_at')) {
    database.exec(`ALTER TABLE users ADD COLUMN renewal_last_attempt_at TEXT`);
  }
  if (!cols.includes('pending_plan_id')) {
    database.exec(`ALTER TABLE users ADD COLUMN pending_plan_id TEXT`);
  }
  if (!cols.includes('card_company')) {
    database.exec(`ALTER TABLE users ADD COLUMN card_company TEXT`);
  }
  if (!cols.includes('card_number')) {
    database.exec(`ALTER TABLE users ADD COLUMN card_number TEXT`);
  }
  if (!cols.includes('usage_cycle')) {
    database.exec(`ALTER TABLE users ADD COLUMN usage_cycle INTEGER NOT NULL DEFAULT 0`);
  }
  if (!cols.includes('usage_legacy_migrated')) {
    database.exec(`ALTER TABLE users ADD COLUMN usage_legacy_migrated INTEGER NOT NULL DEFAULT 0`);
  }
  if (!cols.includes('usage_legacy_review')) {
    database.exec(`ALTER TABLE users ADD COLUMN usage_legacy_review INTEGER NOT NULL DEFAULT 0`);
  }

  database.exec(`
    UPDATE users
    SET plan_id = 'none', updated_at = datetime('now')
    WHERE COALESCE(subscription_status, 'none') NOT IN ('active', 'cancelled')
      AND plan_id IN ('basic', 'standard', 'pro')
  `);
}

let usageMigrationFaultForTests = null;

export function setUsageMigrationFaultForTests(fn) {
  usageMigrationFaultForTests = typeof fn === 'function' ? fn : null;
}

function sqlTime(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function legacyEntitlementActive(user, now) {
  const status = String(user.subscription_status || 'none');
  if (status !== 'active' && status !== 'cancelled') return false;
  if (!['basic', 'standard', 'pro'].includes(String(user.plan_id || ''))) return false;
  const expires = Date.parse(`${String(user.subscription_expires_at || '').replace(' ', 'T')}Z`);
  if (!Number.isFinite(expires)) return false;
  if (expires > now.getTime()) return true;
  const graceDays = Number(process.env.RENEWAL_GRACE_DAYS || 3);
  const maxAttempts = Number(process.env.RENEWAL_MAX_ATTEMPTS || 3);
  const failCount = Number(user.renewal_fail_count || 0);
  if (status !== 'active' || !user.auto_renew || !user.billing_key) return false;
  if (failCount <= 0 || failCount >= maxAttempts) return false;
  return now.getTime() <= expires + graceDays * 86400000;
}

function legacyMonthsMatchLogs(database, userId) {
  const monthly = database
    .prepare(
      `SELECT period, reply_count, tone_count
       FROM usage_monthly
       WHERE user_id = ? AND period GLOB '????-??'`
    )
    .all(userId);
  const logs = database
    .prepare(
      `SELECT period,
         COALESCE(SUM(CASE WHEN kind = 'tone' THEN 1 ELSE 0 END), 0) AS tone,
         COALESCE(SUM(CASE WHEN kind != 'tone' THEN 1 ELSE 0 END), 0) AS reply
       FROM usage_logs
       WHERE user_id = ? AND period GLOB '????-??'
       GROUP BY period`
    )
    .all(userId);
  const monthlyByPeriod = new Map(monthly.map((row) => [row.period, row]));
  const logsByPeriod = new Map(logs.map((row) => [row.period, row]));
  const periods = new Set([...monthlyByPeriod.keys(), ...logsByPeriod.keys()]);
  for (const period of periods) {
    const month = monthlyByPeriod.get(period);
    const log = logsByPeriod.get(period);
    if (Number(month?.reply_count || 0) !== Number(log?.reply || 0)) return false;
    if (Number(month?.tone_count || 0) !== Number(log?.tone || 0)) return false;
  }
  return true;
}

function legacyWindowUsage(database, user, now) {
  const cycleDays = Number(process.env.SUBSCRIPTION_DAYS || 30);
  const expiresMs = Date.parse(`${String(user.subscription_expires_at || '').replace(' ', 'T')}Z`);
  const start = new Date(expiresMs - cycleDays * 86400000);
  const counts = database
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN kind = 'tone' THEN 1 ELSE 0 END), 0) AS tone,
         COALESCE(SUM(CASE WHEN kind != 'tone' THEN 1 ELSE 0 END), 0) AS reply
       FROM usage_logs
       WHERE user_id = ?
         AND created_at >= ?
         AND created_at <= ?
         AND created_at < ?`
    )
    .get(user.id, sqlTime(start), sqlTime(now), sqlTime(new Date(expiresMs)));
  return {
    reply: Number(counts?.reply || 0),
    tone: Number(counts?.tone || 0),
  };
}

export function migrateLegacySubscriptionUsage(database = getDb()) {
  const pending = database
    .prepare('SELECT COUNT(*) AS n FROM users WHERE COALESCE(usage_legacy_migrated, 0) = 0')
    .get();
  if (!pending || Number(pending.n) === 0) return;
  const apply = database.transaction(() => {
    const users = database
      .prepare('SELECT * FROM users WHERE COALESCE(usage_legacy_migrated, 0) = 0')
      .all();
    const mark = database.prepare(
      `UPDATE users
       SET usage_legacy_migrated = 1,
           usage_legacy_review = 0,
           usage_cycle = CASE WHEN COALESCE(usage_cycle, 0) = 0 THEN ? ELSE usage_cycle END
       WHERE id = ?`
    );
    const markReview = database.prepare(
      `UPDATE users
       SET usage_legacy_migrated = 1,
           usage_legacy_review = 1
       WHERE id = ?`
    );
    const saveCycle = database.prepare(
      `INSERT INTO usage_monthly (user_id, period, reply_count, tone_count)
       VALUES (?, 'cycle:1', ?, ?)
       ON CONFLICT(user_id, period) DO UPDATE SET
         reply_count = MAX(reply_count, excluded.reply_count),
         tone_count = MAX(tone_count, excluded.tone_count),
         updated_at = datetime('now')`
    );
    const now = new Date();
    for (const user of users) {
      if (usageMigrationFaultForTests) usageMigrationFaultForTests();
      if (Number(user.usage_cycle || 0) > 0 || !legacyEntitlementActive(user, now)) {
        mark.run(0, user.id);
        continue;
      }
      if (!legacyMonthsMatchLogs(database, user.id)) {
        markReview.run(user.id);
        continue;
      }
      const counts = legacyWindowUsage(database, user, now);
      saveCycle.run(user.id, counts.reply, counts.tone);
      mark.run(1, user.id);
    }
  });
  apply();
}

export function getDb() {
  if (db) return db;
  ensureDataDir();
  db = new Database(getDbFilePath(), { timeout: 5000 });
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  initSchema(db);
  return db;
}

export function closeDbForTests() {
  if (!db) return;
  db.close();
  db = null;
}

export function currentPeriod(date = new Date()) {
  const kst = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const year = kst.getFullYear();
  const month = String(kst.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function findUserByEmail(email) {
  return getDb()
    .prepare('SELECT * FROM users WHERE email = ?')
    .get(String(email || '').trim().toLowerCase());
}

export function findUserById(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export function findUserByKakaoId(kakaoId) {
  return getDb().prepare('SELECT * FROM users WHERE kakao_id = ?').get(String(kakaoId || ''));
}

function allocateDisplayName(preferred) {
  const given = String(preferred || '').trim();
  if (given && !/^\d+$/.test(given)) return given;

  const database = getDb();
  const taken = database.prepare('SELECT 1 FROM users WHERE display_name = ?');
  for (let i = 0; i < 8; i += 1) {
    const name = makeKoreanNickname();
    if (!taken.get(name)) return name;
  }
  return makeKoreanNickname();
}

export function ensureUserDisplayName(user) {
  if (!user || String(user.display_name || '').trim()) return user;
  const name = allocateDisplayName();
  getDb()
    .prepare(`UPDATE users SET display_name = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(name, user.id);
  return findUserById(user.id);
}

export function createKakaoUser({ kakaoId, email, displayName, planId = DEFAULT_PLAN_ID }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedPlan = normalizePlanId(planId);
  const result = getDb()
    .prepare(
      `INSERT INTO users (email, password_hash, plan_id, kakao_id, auth_provider, display_name, usage_legacy_migrated)
       VALUES (?, 'oauth:kakao', ?, ?, 'kakao', ?, 1)`
    )
    .run(normalizedEmail, normalizedPlan, String(kakaoId), allocateDisplayName(displayName));
  return findUserById(result.lastInsertRowid);
}

export function createUser(email, passwordHash, planId = DEFAULT_PLAN_ID) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedPlan = normalizePlanId(planId);
  const result = getDb()
    .prepare(
      `INSERT INTO users (email, password_hash, plan_id, display_name, usage_legacy_migrated)
       VALUES (?, ?, ?, ?, 1)`
    )
    .run(normalizedEmail, passwordHash, normalizedPlan, allocateDisplayName());
  return findUserById(result.lastInsertRowid);
}

export function updateUserPlan(userId, planId) {
  const normalizedPlan = normalizePlanId(planId);
  getDb()
    .prepare(`UPDATE users SET plan_id = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(normalizedPlan, userId);
  return findUserById(userId);
}

export function listAllUsers() {
  return getDb().prepare('SELECT * FROM users ORDER BY id DESC').all();
}

export function markUserSubscriptionCancelled(userId) {
  getDb()
    .prepare(
      `UPDATE users
       SET subscription_status = 'cancelled', auto_renew = 0, pending_plan_id = NULL,
           updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(userId);
  return findUserById(userId);
}

export function resumeUserSubscription(userId) {
  const user = findUserById(userId);
  if (!user) throw new Error('사용자를 찾을 수 없습니다.');
  const canAutoRenew = !!user.billing_key;
  getDb()
    .prepare(
      `UPDATE users
       SET subscription_status = 'active', auto_renew = ?, updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(canAutoRenew ? 1 : 0, userId);
  return findUserById(userId);
}

export function deactivateUserSubscription(userId) {
  const user = findUserById(userId);
  if (!user) throw new Error('사용자를 찾을 수 없습니다.');
  getDb()
    .prepare(
      `UPDATE users
       SET plan_id = 'none', subscription_status = 'none', subscription_expires_at = NULL,
           auto_renew = 0, billing_key = NULL, renewal_fail_count = 0, renewal_last_attempt_at = NULL,
           pending_plan_id = NULL, card_company = NULL, card_number = NULL, updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(userId);
  return findUserById(userId);
}

export function setPendingPlanId(userId, planId) {
  const user = findUserById(userId);
  if (!user) throw new Error('사용자를 찾을 수 없습니다.');
  const next = planId == null || planId === '' ? null : normalizePaidPlanId(planId);
  getDb()
    .prepare(
      `UPDATE users
       SET pending_plan_id = ?, updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(next, userId);
  return findUserById(userId);
}

export function clearPendingPlanId(userId) {
  return setPendingPlanId(userId, null);
}

export function setUserBillingKey(userId, billingKey, options = {}) {
  const enableAutoRenew = options.enableAutoRenew !== false;
  const hasCardMeta =
    Object.prototype.hasOwnProperty.call(options, 'cardCompany') ||
    Object.prototype.hasOwnProperty.call(options, 'cardNumber');

  if (hasCardMeta) {
    getDb()
      .prepare(
        `UPDATE users
         SET billing_key = ?, auto_renew = ?, renewal_fail_count = 0, renewal_last_attempt_at = NULL,
             card_company = ?, card_number = ?, updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(
        String(billingKey || ''),
        enableAutoRenew ? 1 : 0,
        options.cardCompany != null && options.cardCompany !== '' ? String(options.cardCompany) : null,
        options.cardNumber != null && options.cardNumber !== '' ? String(options.cardNumber) : null,
        userId
      );
  } else {
    getDb()
      .prepare(
        `UPDATE users
         SET billing_key = ?, auto_renew = ?, renewal_fail_count = 0, renewal_last_attempt_at = NULL,
             updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(String(billingKey || ''), enableAutoRenew ? 1 : 0, userId);
  }
  return findUserById(userId);
}

export function clearRenewalFailures(userId) {
  getDb()
    .prepare(
      `UPDATE users
       SET renewal_fail_count = 0, renewal_last_attempt_at = NULL, updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(userId);
  return findUserById(userId);
}

export function recordRenewalFailure(userId, maxAttempts) {
  const user = findUserById(userId);
  if (!user) throw new Error('사용자를 찾을 수 없습니다.');
  const nextCount = Number(user.renewal_fail_count || 0) + 1;
  getDb()
    .prepare(
      `UPDATE users
       SET renewal_fail_count = ?, renewal_last_attempt_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(nextCount, userId);
  if (nextCount >= maxAttempts) {
    deactivateUserSubscription(userId);
    return { deactivated: true, failCount: nextCount };
  }
  return { deactivated: false, failCount: nextCount };
}

export function listUsersDueForRenewal(
  nowIso = new Date().toISOString().slice(0, 19).replace('T', ' '),
  maxAttempts = 3
) {
  return getDb()
    .prepare(
      `SELECT * FROM users
       WHERE auto_renew = 1
         AND subscription_status = 'active'
         AND billing_key IS NOT NULL
         AND subscription_expires_at IS NOT NULL
         AND subscription_expires_at <= ?
         AND COALESCE(renewal_fail_count, 0) < ?
         AND (
           renewal_last_attempt_at IS NULL
           OR renewal_last_attempt_at <= datetime('now', '-24 hours')
         )`
    )
    .all(nowIso, maxAttempts);
}

export function expireEndedSubscriptions(nowIso = new Date().toISOString().slice(0, 19).replace('T', ' ')) {
  const result = getDb()
    .prepare(
      `UPDATE users
       SET plan_id = 'none', subscription_status = 'none', subscription_expires_at = NULL,
           auto_renew = 0, billing_key = NULL, renewal_fail_count = 0, renewal_last_attempt_at = NULL,
           pending_plan_id = NULL, card_company = NULL, card_number = NULL, updated_at = datetime('now')
       WHERE subscription_expires_at IS NOT NULL
         AND subscription_expires_at <= ?
         AND (
           auto_renew = 0
           OR subscription_status = 'cancelled'
           OR billing_key IS NULL
         )
         AND subscription_status IN ('active', 'cancelled')`
    )
    .run(nowIso);
  return result.changes || 0;
}

export function expireRenewalGracePeriod(graceDays = Number(process.env.RENEWAL_GRACE_DAYS || 3), maxAttempts = Number(process.env.RENEWAL_MAX_ATTEMPTS || 3)) {
  const users = getDb()
    .prepare(
      `SELECT * FROM users
       WHERE auto_renew = 1
         AND subscription_status = 'active'
         AND billing_key IS NOT NULL
         AND subscription_expires_at IS NOT NULL
         AND COALESCE(renewal_fail_count, 0) > 0
         AND COALESCE(renewal_fail_count, 0) < ?`
    )
    .all(maxAttempts);

  const now = Date.now();
  let expired = 0;
  for (const user of users) {
    const expires = new Date(String(user.subscription_expires_at).replace(' ', 'T') + 'Z');
    if (now > expires.getTime() + graceDays * 86400000) {
      deactivateUserSubscription(user.id);
      expired += 1;
    }
  }
  return expired;
}

export function createSession(userId, token, expiresAtIso) {
  getDb()
    .prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`)
    .run(token, userId, expiresAtIso);
  return token;
}

export function deleteSession(token) {
  getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function deleteExpiredSessions() {
  getDb().prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`).run();
}

export function findSession(token) {
  deleteExpiredSessions();
  return getDb()
    .prepare(
      `SELECT s.token, s.user_id, s.expires_at, u.email, u.plan_id
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > datetime('now')`
    )
    .get(token);
}

export function getUsageRow(userId, period = currentPeriod()) {
  return getDb()
    .prepare('SELECT * FROM usage_monthly WHERE user_id = ? AND period = ?')
    .get(userId, period);
}

export function ensureUsageRow(userId, period = currentPeriod()) {
  const existing = getUsageRow(userId, period);
  if (existing) return existing;
  getDb()
    .prepare(
      `INSERT INTO usage_monthly (user_id, period, reply_count, tone_count)
       VALUES (?, ?, 0, 0)`
    )
    .run(userId, period);
  return getUsageRow(userId, period);
}

let usageLogFaultForTests = null;

export function setUsageLogFaultForTests(fn) {
  usageLogFaultForTests = typeof fn === 'function' ? fn : null;
}

export function incrementUsage(userId, kind, channel, period = currentPeriod()) {
  const apply = getDb().transaction(() => {
    ensureUsageRow(userId, period);
    const column = kind === 'tone' ? 'tone_count' : 'reply_count';
    getDb()
      .prepare(
        `UPDATE usage_monthly
         SET ${column} = ${column} + 1, updated_at = datetime('now')
         WHERE user_id = ? AND period = ?`
      )
      .run(userId, period);

    if (usageLogFaultForTests) usageLogFaultForTests();

    getDb()
      .prepare(
        `INSERT INTO usage_logs (user_id, period, kind, channel)
         VALUES (?, ?, ?, ?)`
      )
      .run(userId, period, kind, channel || null);

    return getUsageRow(userId, period);
  });
  return apply();
}

/** channel별 사용량 (구 로그 channel NULL → review로 취급) */
export function getUsageChannelBreakdown(userId, period = currentPeriod()) {
  const rows = getDb()
    .prepare(
      `SELECT kind,
              CASE
                WHEN channel IS NULL OR TRIM(channel) = '' THEN 'review'
                ELSE channel
              END AS channel,
              COUNT(*) AS cnt
       FROM usage_logs
       WHERE user_id = ? AND period = ?
       GROUP BY kind, channel`
    )
    .all(userId, period);

  const reply = { review: 0, inquiry: 0 };
  const tone = { review: 0, inquiry: 0 };
  for (const row of rows) {
    const ch = row.channel === 'inquiry' ? 'inquiry' : 'review';
    const n = Number(row.cnt) || 0;
    if (row.kind === 'tone') tone[ch] += n;
    else reply[ch] += n;
  }
  return { reply, tone };
}

export function listReplyLogDaily(limit = 60) {
  return getDb()
    .prepare(
      `SELECT date(datetime(l.created_at, '+9 hours')) AS day,
              l.user_id,
              CASE WHEN l.channel = 'inquiry' THEN 'inquiry' ELSE 'review' END AS channel,
              COUNT(*) AS cnt,
              MAX(l.created_at) AS last_at,
              u.email,
              u.display_name
       FROM usage_logs l
       LEFT JOIN users u ON u.id = l.user_id
       WHERE l.kind = 'reply'
       GROUP BY date(datetime(l.created_at, '+9 hours')),
                l.user_id,
                CASE WHEN l.channel = 'inquiry' THEN 'inquiry' ELSE 'review' END
       ORDER BY day DESC, last_at DESC
       LIMIT ?`
    )
    .all(limit);
}

export function getUsageChannelTotals(period = null) {
  const rows = period
    ? getDb()
        .prepare(
          `SELECT kind,
                  CASE
                    WHEN channel IS NULL OR TRIM(channel) = '' THEN 'review'
                    ELSE channel
                  END AS channel,
                  COUNT(*) AS cnt
           FROM usage_logs
           WHERE period = ?
           GROUP BY kind, channel`
        )
        .all(period)
    : getDb()
        .prepare(
          `SELECT kind,
                  CASE
                    WHEN channel IS NULL OR TRIM(channel) = '' THEN 'review'
                    ELSE channel
                  END AS channel,
                  COUNT(*) AS cnt
           FROM usage_logs
           GROUP BY kind, channel`
        )
        .all();

  const reply = { review: 0, inquiry: 0 };
  const tone = { review: 0, inquiry: 0 };
  for (const row of rows) {
    const ch = row.channel === 'inquiry' ? 'inquiry' : 'review';
    const n = Number(row.cnt) || 0;
    if (row.kind === 'tone') tone[ch] += n;
    else reply[ch] += n;
  }
  return { reply, tone };
}

export function upsertAnalyticsInstall(installId, { userId = null, extensionVersion = null } = {}) {
  const id = String(installId || '').trim();
  if (!id || id.length < 8 || id.length > 80) return null;
  const db = getDb();
  db.prepare(
    `INSERT INTO analytics_installs (install_id, user_id, extension_version, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(install_id) DO UPDATE SET
       last_seen_at = datetime('now'),
       extension_version = COALESCE(excluded.extension_version, analytics_installs.extension_version),
       user_id = COALESCE(excluded.user_id, analytics_installs.user_id)`
  ).run(id, userId || null, extensionVersion || null);
  return db.prepare('SELECT * FROM analytics_installs WHERE install_id = ?').get(id);
}

export function linkAnalyticsInstallUser(installId, userId) {
  const id = String(installId || '').trim();
  if (!id || !userId) return;
  getDb()
    .prepare(
      `UPDATE analytics_installs
       SET user_id = ?, last_seen_at = datetime('now')
       WHERE install_id = ?`
    )
    .run(userId, id);
}

export function markUserInstallGenerated(userId, { channel = null, touchLastSeen = false } = {}) {
  const uid = Number(userId);
  if (!uid) return false;
  const db = getDb();
  const install = db
    .prepare(
      `SELECT install_id FROM analytics_installs
       WHERE user_id = ?
       ORDER BY last_seen_at DESC
       LIMIT 1`
    )
    .get(uid);
  if (!install) return false;

  const existing = db
    .prepare(
      `SELECT 1 AS ok FROM analytics_events
       WHERE install_id = ? AND event = 'generate_success'
       LIMIT 1`
    )
    .get(install.install_id);

  if (!existing) {
    insertAnalyticsEvent(install.install_id, 'generate_success', {
      userId: uid,
      meta: { source: 'server', ...(channel ? { channel } : {}) },
    });
  }
  if (touchLastSeen) {
    db.prepare(`UPDATE analytics_installs SET last_seen_at = datetime('now') WHERE install_id = ?`).run(
      install.install_id
    );
  }
  return !existing;
}

export function syncGenerateStagesFromUsage() {
  const rows = getDb()
    .prepare(`SELECT DISTINCT user_id FROM usage_logs WHERE kind = 'reply' AND user_id IS NOT NULL`)
    .all();
  for (const row of rows) {
    markUserInstallGenerated(row.user_id, { touchLastSeen: false });
  }
}

export function insertAnalyticsEvent(installId, event, { userId = null, meta = null } = {}) {
  const id = String(installId || '').trim();
  const ev = String(event || '').trim().slice(0, 64);
  if (!id || !ev) return null;
  const metaJson = meta == null ? null : JSON.stringify(meta).slice(0, 2000);
  const info = getDb()
    .prepare(
      `INSERT INTO analytics_events (install_id, user_id, event, meta)
       VALUES (?, ?, ?, ?)`
    )
    .run(id, userId || null, ev, metaJson);
  return info.lastInsertRowid;
}

export function listAnalyticsInstalls(limit = 200) {
  const installs = getDb()
    .prepare(
      `SELECT i.install_id, i.user_id, i.extension_version, i.first_seen_at, i.last_seen_at,
              u.email, u.display_name
       FROM analytics_installs i
       LEFT JOIN users u ON u.id = i.user_id
       ORDER BY i.last_seen_at DESC
       LIMIT ?`
    )
    .all(limit);

  const events = getDb()
    .prepare(`SELECT install_id, event, created_at FROM analytics_events ORDER BY id ASC`)
    .all();

  const byInstall = new Map();
  for (const row of events) {
    const list = byInstall.get(row.install_id) || [];
    list.push(row);
    byInstall.set(row.install_id, list);
  }

  return installs.map((install) => {
    const rows = byInstall.get(install.install_id) || [];
    let latest = null;
    for (const row of rows) {
      if (!latest || String(row.created_at) >= String(latest.created_at)) latest = row;
    }
    return {
      installId: install.install_id,
      userId: install.user_id || null,
      email: install.email || null,
      displayName: install.display_name || null,
      version: install.extension_version || null,
      firstSeenAt: install.first_seen_at,
      lastSeenAt: latest?.created_at || install.last_seen_at,
      stage: latest?.event || 'install',
      loggedIn: !!install.user_id,
    };
  });
}

export function getUsageChannelByUser() {
  const rows = getDb()
    .prepare(
      `SELECT user_id, kind,
              CASE
                WHEN channel IS NULL OR TRIM(channel) = '' THEN 'review'
                ELSE channel
              END AS channel,
              COUNT(*) AS cnt
       FROM usage_logs
       GROUP BY user_id, kind, channel`
    )
    .all();

  const map = new Map();
  for (const row of rows) {
    const current = map.get(row.user_id) || {
      reply: { review: 0, inquiry: 0 },
      tone: { review: 0, inquiry: 0 },
    };
    const ch = row.channel === 'inquiry' ? 'inquiry' : 'review';
    const n = Number(row.cnt) || 0;
    if (row.kind === 'tone') current.tone[ch] += n;
    else current.reply[ch] += n;
    map.set(row.user_id, current);
  }
  return map;
}

export function getAnalyticsFunnel() {
  const db = getDb();
  const totalInstalls = db.prepare('SELECT COUNT(*) AS n FROM analytics_installs').get()?.n || 0;
  const linkedUsers = db
    .prepare('SELECT COUNT(DISTINCT user_id) AS n FROM analytics_installs WHERE user_id IS NOT NULL')
    .get()?.n || 0;

  const eventRows = db
    .prepare(
      `SELECT event, COUNT(DISTINCT install_id) AS installs
       FROM analytics_events
       GROUP BY event`
    )
    .all();

  const byEvent = {};
  for (const row of eventRows) {
    byEvent[row.event] = Number(row.installs) || 0;
  }

  return {
    totalInstalls: Number(totalInstalls) || 0,
    linkedUsers: Number(linkedUsers) || 0,
    opened: byEvent.open || 0,
    loginClick: byEvent.login_click || 0,
    loginSuccess: byEvent.login_success || 0,
    loginFail: byEvent.login_fail || 0,
    fetchSuccess: byEvent.fetch_success || 0,
    fetchFail: byEvent.fetch_fail || 0,
    generateSuccess: byEvent.generate_success || 0,
    byEvent,
  };
}

export function getOrCreateCustomerKey(userId) {
  const user = findUserById(userId);
  if (!user) throw new Error('사용자를 찾을 수 없습니다.');
  if (user.customer_key) return user.customer_key;

  const customerKey = `cust_${userId}_${Date.now().toString(36)}`;
  getDb()
    .prepare(`UPDATE users SET customer_key = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(customerKey, userId);
  return customerKey;
}

export function billingChargeFingerprint({ amount, orderId, customerKey, orderName }) {
  return crypto
    .createHash('sha256')
    .update([String(amount), String(orderId), String(customerKey), String(orderName)].join('\n'))
    .digest('hex');
}

export const IDEMPOTENCY_TTL_MS = 15 * 24 * 60 * 60 * 1000;

export function isIdempotencyKeyExpired(order, now = new Date()) {
  const raw = String(order?.idempotency_sent_at || '').trim();
  if (!raw) return false;
  const parsed = raw.includes('T') ? Date.parse(raw) : Date.parse(`${raw.replace(' ', 'T')}Z`);
  if (!Number.isFinite(parsed)) return false;
  return now.getTime() - parsed >= IDEMPOTENCY_TTL_MS;
}

export function rememberIssuedBillingKey(orderDbId, billingKey) {
  getDb()
    .prepare(
      `UPDATE billing_orders
       SET charge_billing_key = COALESCE(charge_billing_key, ?)
       WHERE id = ?`
    )
    .run(String(billingKey || ''), orderDbId);
  return findBillingOrder(orderDbId);
}

export function findOpenInitialBillingOrder(userId) {
  return getDb()
    .prepare(
      `SELECT * FROM billing_orders
       WHERE user_id = ?
         AND order_kind IN ('subscribe', 'review_billing')
         AND usage_applied = 0
         AND status IN ('pending', 'unknown', 'manual_review')
       ORDER BY id DESC
       LIMIT 1`
    )
    .get(userId);
}

export function rememberIdempotencySend(orderDbId, billingKey, sentAtIso) {
  getDb()
    .prepare(
      `UPDATE billing_orders
       SET idempotency_sent_at = COALESCE(idempotency_sent_at, ?),
           charge_billing_key = COALESCE(charge_billing_key, ?)
       WHERE id = ?`
    )
    .run(sentAtIso, String(billingKey || ''), orderDbId);
  return findBillingOrder(orderDbId);
}

export function createBillingOrder({
  userId,
  orderId,
  planId,
  amount,
  orderName,
  customerKey,
  orderKind = 'payment',
  legalConsentAt = null,
}) {
  const idempotencyKey = crypto.randomUUID();
  const idempotencyCreatedAt = new Date().toISOString();
  const fingerprint = billingChargeFingerprint({ amount, orderId, customerKey, orderName });
  const result = getDb()
    .prepare(
      `INSERT INTO billing_orders (
         user_id, order_id, plan_id, amount, order_name, customer_key, status, order_kind, legal_consent_at,
         idempotency_key, idempotency_created_at, charge_fingerprint
       )
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      orderId,
      normalizePlanId(planId),
      amount,
      orderName,
      customerKey,
      orderKind,
      legalConsentAt,
      idempotencyKey,
      idempotencyCreatedAt,
      fingerprint
    );
  return findBillingOrder(result.lastInsertRowid);
}

export function findOpenRenewalOrder(userId) {
  return getDb()
    .prepare(
      `SELECT * FROM billing_orders
       WHERE user_id = ? AND order_kind = 'renewal' AND status IN ('pending', 'unknown', 'manual_review')
       ORDER BY id DESC
       LIMIT 1`
    )
    .get(userId);
}

export function listRenewalOrdersForRecovery(nowIso) {
  return getDb()
    .prepare(
      `SELECT * FROM billing_orders
       WHERE order_kind IN ('renewal', 'subscribe', 'review_billing')
         AND usage_applied = 0
         AND status IN ('pending', 'unknown')
         AND (next_recovery_at IS NULL OR next_recovery_at <= ?)
       ORDER BY id ASC`
    )
    .all(nowIso);
}

export function claimBillingOrderRecovery(orderDbId, nowIso, nextIso) {
  const apply = getDb().transaction(() => {
    const result = getDb()
      .prepare(
        `UPDATE billing_orders
         SET recovery_attempts = COALESCE(recovery_attempts, 0) + 1,
             last_recovery_at = ?,
             next_recovery_at = ?
         WHERE id = ?
           AND usage_applied = 0
           AND status IN ('pending', 'unknown')
           AND (next_recovery_at IS NULL OR next_recovery_at <= ?)`
      )
      .run(nowIso, nextIso, orderDbId, nowIso);
    if (result.changes !== 1) return null;
    return findBillingOrder(orderDbId);
  });
  return apply.immediate();
}

export function markBillingOrderRecovery(orderDbId, { status, failureReason = null, nextRecoveryAt = null, paymentKey = null } = {}) {
  getDb()
    .prepare(
      `UPDATE billing_orders
       SET status = ?,
           failure_reason = ?,
           next_recovery_at = ?,
           payment_key = COALESCE(?, payment_key)
       WHERE id = ? AND status NOT IN ('paid', 'refunded')`
    )
    .run(status, failureReason, nextRecoveryAt, paymentKey, orderDbId);
  return findBillingOrder(orderDbId);
}

export function findBillingOrder(id) {
  return getDb().prepare('SELECT * FROM billing_orders WHERE id = ?').get(id);
}

export function findBillingOrderByOrderId(orderId) {
  return getDb().prepare('SELECT * FROM billing_orders WHERE order_id = ?').get(orderId);
}

export function markBillingOrderPaid(orderDbId, paymentKey) {
  getDb()
    .prepare(
      `UPDATE billing_orders
       SET status = 'paid', payment_key = ?, paid_at = datetime('now')
       WHERE id = ?`
    )
    .run(paymentKey, orderDbId);
}

export function markBillingOrderRefunded(orderDbId) {
  getDb()
    .prepare(
      `UPDATE billing_orders
       SET status = 'refunded'
       WHERE id = ? AND status = 'paid'`
    )
    .run(orderDbId);
  return findBillingOrder(orderDbId);
}

let subscriptionFaultForTests = null;

export function setSubscriptionFaultForTests(fn) {
  subscriptionFaultForTests = typeof fn === 'function' ? fn : null;
}

function claimBillingOrder(orderDbId, paymentKey) {
  const database = getDb();
  const order = database.prepare('SELECT id, usage_applied FROM billing_orders WHERE id = ?').get(orderDbId);
  if (!order) throw new Error('주문을 찾을 수 없습니다.');
  if (Number(order.usage_applied) === 1) return false;
  const key = paymentKey != null && String(paymentKey) !== '' ? String(paymentKey) : null;
  const result = database
    .prepare(
      `UPDATE billing_orders
       SET status = CASE WHEN status IN ('pending', 'unknown') THEN 'paid' ELSE status END,
           payment_key = COALESCE(?, payment_key),
           paid_at = COALESCE(paid_at, datetime('now')),
           usage_applied = 1
       WHERE id = ? AND COALESCE(usage_applied, 0) = 0`
    )
    .run(key, orderDbId);
  return result.changes === 1;
}

function throwSubscriptionFaultForTests() {
  if (subscriptionFaultForTests) subscriptionFaultForTests();
}

export function activateUserSubscription(userId, planId, days = 30, options = {}) {
  const apply = getDb().transaction(() => {
    const user = findUserById(userId);
    if (!user) throw new Error('사용자를 찾을 수 없습니다.');
    if (options.billingOrderId != null && !claimBillingOrder(options.billingOrderId, options.paymentKey)) {
      return findUserById(userId);
    }

    const { billingKey = null, autoRenew = null } = options;
    const now = new Date();
    let base = now;
    if (user.subscription_status === 'active' && user.subscription_expires_at) {
      const currentExpires = new Date(String(user.subscription_expires_at).replace(' ', 'T') + 'Z');
      if (currentExpires.getTime() > now.getTime()) base = currentExpires;
    }
    if (user.subscription_status === 'cancelled' && user.subscription_expires_at) {
      const currentExpires = new Date(String(user.subscription_expires_at).replace(' ', 'T') + 'Z');
      if (currentExpires.getTime() > now.getTime()) base = currentExpires;
    }

    const expiresAt = addDaysIsoLocal(days, base);
    const openingNewCycle = base === now;
    const nextCycle = openingNewCycle ? Number(user.usage_cycle || 0) + 1 : Number(user.usage_cycle || 0);
    const nextBillingKey = billingKey != null ? billingKey : user.billing_key;
    const nextAutoRenew =
      autoRenew != null ? (autoRenew ? 1 : 0) : billingKey != null ? 1 : user.auto_renew ? 1 : 0;

    if (billingKey != null) {
      const cardOptions = { enableAutoRenew: nextAutoRenew === 1 };
      if (options.cardCompany !== undefined) cardOptions.cardCompany = options.cardCompany;
      if (options.cardNumber !== undefined) cardOptions.cardNumber = options.cardNumber;
      setUserBillingKey(userId, billingKey, cardOptions);
    }

    getDb()
      .prepare(
        `UPDATE users
         SET plan_id = ?, subscription_status = 'active', subscription_expires_at = ?,
             usage_cycle = ?, billing_key = ?, auto_renew = ?, pending_plan_id = NULL, updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(normalizePlanId(planId), expiresAt, nextCycle, nextBillingKey, nextAutoRenew, userId);

    throwSubscriptionFaultForTests();
    return findUserById(userId);
  });
  return apply.immediate();
}

export function renewUserSubscriptionPeriod(userId, days = 30, options = {}) {
  const apply = getDb().transaction(() => {
    const user = findUserById(userId);
    if (!user) throw new Error('사용자를 찾을 수 없습니다.');
    if (options.billingOrderId != null && !claimBillingOrder(options.billingOrderId, options.paymentKey)) {
      return findUserById(userId);
    }
    if (!user.subscription_expires_at) {
      throw new Error('갱신할 구독 만료일이 없습니다.');
    }

    const nextPlanId =
      options.planId != null && options.planId !== ''
        ? normalizePaidPlanId(options.planId)
        : user.pending_plan_id
          ? normalizePaidPlanId(user.pending_plan_id)
          : normalizePaidPlanId(user.plan_id);

    const base = new Date(String(user.subscription_expires_at).replace(' ', 'T') + 'Z');
    const expiresAt = addDaysIsoLocal(days, base);
    const nextCycle = Number(user.usage_cycle || 0) + 1;
    getDb()
      .prepare(
        `UPDATE users
         SET plan_id = ?, subscription_status = 'active', subscription_expires_at = ?, usage_cycle = ?,
             auto_renew = 1, pending_plan_id = NULL, renewal_fail_count = 0, renewal_last_attempt_at = NULL,
             updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(nextPlanId, expiresAt, nextCycle, userId);

    throwSubscriptionFaultForTests();
    return findUserById(userId);
  });
  return apply.immediate();
}

export function upgradeUserSubscription(userId, planId, options = {}) {
  const apply = getDb().transaction(() => {
    const user = findUserById(userId);
    if (!user) throw new Error('사용자를 찾을 수 없습니다.');
    if (options.billingOrderId != null && !claimBillingOrder(options.billingOrderId, options.paymentKey)) {
      return findUserById(userId);
    }
    if (!user.subscription_expires_at) {
      throw new Error('업그레이드할 활성 구독이 없습니다.');
    }

    getDb()
      .prepare(
        `UPDATE users
         SET plan_id = ?, subscription_status = 'active', pending_plan_id = NULL,
             updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(normalizePlanId(planId), userId);

    throwSubscriptionFaultForTests();
    return findUserById(userId);
  });
  return apply.immediate();
}

export function setUserSubscriptionActive(userId, planId, days = 365) {
  return activateUserSubscription(userId, planId, days);
}

function addDaysIsoLocal(days, from = new Date()) {
  const next = new Date(from.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 19).replace('T', ' ');
}

export function listBillingOrdersForUser(userId, limit = 20) {
  return getDb()
    .prepare(
      `SELECT * FROM billing_orders
       WHERE user_id = ? AND status IN ('paid', 'refunded', 'failed')
       ORDER BY COALESCE(paid_at, created_at) DESC
       LIMIT ?`
    )
    .all(userId, limit);
}

export function listRecentBillingOrders(limit = 50) {
  return getDb()
    .prepare(
      `SELECT o.*, u.email, u.display_name
       FROM billing_orders o
       JOIN users u ON u.id = o.user_id
       WHERE o.status IN ('paid', 'refunded')
       ORDER BY COALESCE(o.paid_at, o.created_at) DESC
       LIMIT ?`
    )
    .all(limit);
}

function normalizeProductNo(productNo) {
  return String(productNo || '').replace(/[^\d]/g, '').slice(0, 32);
}

function mapProductKnowledgeRow(row) {
  if (!row) return null;
  const fieldMeta = parseFieldMetaJson(row.field_meta_json);
  const trustStatus = resolveTrustStatus({
    trustStatus: row.trust_status,
    source: row.source,
    verifiedAt: row.verified_at,
  });
  const validity = isKnowledgeEffective({
    validFrom: row.valid_from,
    validTo: row.valid_to,
  });
  const storeId = normalizeStoreId(row.store_id);
  return {
    id: row.id,
    userId: row.user_id,
    storeId,
    store_id: storeId,
    productNo: row.product_no,
    productName: row.product_name,
    detailDescription: row.detail_description,
    specs: row.specs,
    usage: row.usage,
    optionsCompat: row.options_compat,
    cautions: row.cautions,
    extra: row.extra,
    source: row.source,
    sourceNormalized: normalizeSource(row.source),
    verifiedAt: row.verified_at,
    trustStatus,
    fieldMeta,
    validFrom: row.valid_from || null,
    validTo: row.valid_to || null,
    effective: validity.effective,
    effectiveStatus: validity.effectiveStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    product_no: row.product_no,
    product_name: row.product_name,
    detail_description: row.detail_description,
    options_compat: row.options_compat,
    verified_at: row.verified_at,
    trust_status: trustStatus,
    field_meta_json: row.field_meta_json || '{}',
  };
}

function resolveKnowledgeStoreId(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, 'storeId')) {
    return normalizeStoreId(options.storeId);
  }
  if (Object.prototype.hasOwnProperty.call(options, 'store_id')) {
    return normalizeStoreId(options.store_id);
  }
  return UNSCOPED_STORE_ID;
}

export function listProductKnowledge(userId, options = {}) {
  const storeId = resolveKnowledgeStoreId(options);
  return getDb()
    .prepare(
      `SELECT * FROM product_knowledge
       WHERE user_id = ? AND store_id = ?
       ORDER BY updated_at DESC, id DESC`
    )
    .all(userId, storeId)
    .map(mapProductKnowledgeRow);
}

export function getProductKnowledge(userId, productNo, options = {}) {
  const no = normalizeProductNo(productNo);
  if (!no) return null;
  const storeId = resolveKnowledgeStoreId(options);
  return mapProductKnowledgeRow(
    getDb()
      .prepare(
        `SELECT * FROM product_knowledge WHERE user_id = ? AND store_id = ? AND product_no = ?`
      )
      .get(userId, storeId, no)
  );
}

export function upsertProductKnowledge(userId, payload = {}) {
  const productNo = normalizeProductNo(payload.productNo || payload.product_no);
  if (!productNo) throw new Error('productNo가 필요합니다.');
  const storeId = resolveKnowledgeStoreId(payload);
  const existing = getProductKnowledge(userId, productNo, { storeId });

  let productName = String(payload.productName || payload.product_name || '').trim().slice(0, 200);
  let detailDescription = String(payload.detailDescription || payload.detail_description || '').slice(
    0,
    20000
  );
  let specs = String(payload.specs || '').slice(0, 8000);
  let usage = String(payload.usage || '').slice(0, 8000);
  let optionsCompat = String(payload.optionsCompat || payload.options_compat || '').slice(0, 8000);
  let cautions = String(payload.cautions || '').slice(0, 8000);
  let extra = String(payload.extra || '').slice(0, 8000);
  let source = sourceForStorage(payload.source || 'manual');
  let verifiedAt =
    payload.verifiedAt === null
      ? null
      : String(
          payload.verifiedAt ||
            payload.verified_at ||
            new Date().toISOString().slice(0, 19).replace('T', ' ')
        );
  let trustStatus = trustStatusForInsert({ ...payload, source });
  let { validFrom, validTo } = assertValidRange(
    payload.validFrom ?? payload.valid_from,
    payload.validTo ?? payload.valid_to
  );
  let fieldMetaJson =
    payload.fieldMeta != null || payload.field_meta_json != null
      ? stringifyFieldMeta(parseFieldMetaJson(payload.fieldMeta ?? payload.field_meta_json))
      : existing?.field_meta_json || '{}';

  // Phase 0: 자동수집은 승인 본문·trust·meta를 덮지 않음 (충돌 시 conflict)
  if (existing && isAutoCollectSource(payload.source)) {
    const merged = mergeAutoCollectProductPayload(existing, payload);
    productName = merged.productName;
    detailDescription = merged.detailDescription;
    specs = merged.specs;
    usage = merged.usage;
    optionsCompat = merged.optionsCompat;
    cautions = merged.cautions;
    extra = merged.extra;
    source = sourceForStorage(merged.source);
    verifiedAt = merged.verifiedAt;
    trustStatus =
      merged.trustStatus != null && String(merged.trustStatus).trim() !== ''
        ? String(merged.trustStatus).trim()
        : trustStatusForInsert({ source, trustStatus: merged.trustStatus });
    validFrom = merged.validFrom ?? validFrom;
    validTo = merged.validTo ?? validTo;
    fieldMetaJson = merged.fieldMetaJson;
  } else if (!existing && isAutoCollectSource(payload.source)) {
    verifiedAt = payload.verifiedAt === null || payload.verified_at === null ? null : verifiedAt;
    if (payload.verifiedAt == null && payload.verified_at == null) verifiedAt = null;
    trustStatus = trustStatusForInsert({ ...payload, source, trustStatus: 'unverified' });
  }

  getDb()
    .prepare(
      `INSERT INTO product_knowledge (
         user_id, store_id, product_no, product_name, detail_description, specs, usage,
         options_compat, cautions, extra, source, verified_at, trust_status,
         field_meta_json, valid_from, valid_to, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, store_id, product_no) DO UPDATE SET
         product_name = excluded.product_name,
         detail_description = excluded.detail_description,
         specs = excluded.specs,
         usage = excluded.usage,
         options_compat = excluded.options_compat,
         cautions = excluded.cautions,
         extra = excluded.extra,
         source = excluded.source,
         verified_at = excluded.verified_at,
         trust_status = excluded.trust_status,
         field_meta_json = excluded.field_meta_json,
         valid_from = excluded.valid_from,
         valid_to = excluded.valid_to,
         updated_at = datetime('now')`
    )
    .run(
      userId,
      storeId,
      productNo,
      productName,
      detailDescription,
      specs,
      usage,
      optionsCompat,
      cautions,
      extra,
      source,
      verifiedAt,
      trustStatus,
      fieldMetaJson,
      validFrom,
      validTo
    );

  return getProductKnowledge(userId, productNo, { storeId });
}

export function deleteProductKnowledge(userId, productNo, options = {}) {
  const no = normalizeProductNo(productNo);
  if (!no) return false;
  const storeId = resolveKnowledgeStoreId(options);
  const result = getDb()
    .prepare(`DELETE FROM product_knowledge WHERE user_id = ? AND store_id = ? AND product_no = ?`)
    .run(userId, storeId, no);
  return result.changes > 0;
}

export function mergeProductKnowledgeField(userId, productNo, field, value, options = {}) {
  const allowed = new Set([
    'detail_description',
    'specs',
    'usage',
    'options_compat',
    'cautions',
    'extra',
    'product_name',
  ]);
  const column = String(field || '');
  if (!allowed.has(column)) throw new Error('허용되지 않은 필드입니다.');
  const storeId = resolveKnowledgeStoreId(options);
  const existing = getProductKnowledge(userId, productNo, { storeId });
  const nextValue = String(value || '').trim().slice(0, 20000);
  if (!existing) {
    const payload = {
      productNo,
      storeId,
      productName: column === 'product_name' ? nextValue : options.productName || '',
      source: options.source || 'seller_approved',
      verifiedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    };
    payload[column] = nextValue;
    if (column === 'detail_description') payload.detailDescription = nextValue;
    if (column === 'options_compat') payload.optionsCompat = nextValue;
    if (column === 'product_name') payload.productName = nextValue;
    if (column === 'specs') payload.specs = nextValue;
    if (column === 'usage') payload.usage = nextValue;
    if (column === 'cautions') payload.cautions = nextValue;
    if (column === 'extra') payload.extra = nextValue;
    return upsertProductKnowledge(userId, payload);
  }

  const merged = {
    productNo,
    storeId,
    productName: existing.productName,
    detailDescription: existing.detailDescription,
    specs: existing.specs,
    usage: existing.usage,
    optionsCompat: existing.optionsCompat,
    cautions: existing.cautions,
    extra: existing.extra,
    source: options.source || 'seller_approved',
    verifiedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    fieldMeta: mergeFieldMeta(existing.fieldMeta, column, {
      source: normalizeSource(options.source || 'SELLER_APPROVED'),
      trustStatus: 'approved',
    }),
  };
  if (column === 'product_name') merged.productName = nextValue;
  if (column === 'detail_description') {
    merged.detailDescription = [existing.detailDescription, nextValue].filter(Boolean).join('\n\n');
  }
  if (column === 'specs') merged.specs = [existing.specs, nextValue].filter(Boolean).join('\n');
  if (column === 'usage') merged.usage = [existing.usage, nextValue].filter(Boolean).join('\n');
  if (column === 'options_compat') {
    merged.optionsCompat = [existing.optionsCompat, nextValue].filter(Boolean).join('\n');
  }
  if (column === 'cautions') merged.cautions = [existing.cautions, nextValue].filter(Boolean).join('\n');
  if (column === 'extra') merged.extra = [existing.extra, nextValue].filter(Boolean).join('\n\n');
  return upsertProductKnowledge(userId, merged);
}

/** Phase 0: 동기화 재실행 시 중복 없는 upsert (API 실호출 없음 — 단위 테스트용) */
export function upsertCommerceProductSync(userId, payload = {}) {
  const storeId = resolveKnowledgeStoreId(payload);
  const channelProductNo = normalizeProductNo(payload.channelProductNo || payload.productNo || '');
  if (!channelProductNo) throw new Error('channelProductNo가 필요합니다.');
  const originProductNo = String(payload.originProductNo || '').replace(/[^\d]/g, '').slice(0, 32);
  const productName = String(payload.productName || '').slice(0, 200);
  const status = String(payload.status || '').slice(0, 40);
  const contentHashValue = String(payload.contentHash || contentHash(payload.rawJson || productName)).slice(
    0,
    64
  );
  const lastError = String(payload.lastError || '').slice(0, 1000);
  const rawJson = String(payload.rawJson || '').slice(0, 200000);
  const lastSyncedAt =
    payload.lastSyncedAt === null
      ? null
      : String(payload.lastSyncedAt || new Date().toISOString().slice(0, 19).replace('T', ' '));

  const existingSync = getDb()
    .prepare(
      `SELECT * FROM commerce_product_sync
       WHERE user_id = ? AND store_id = ? AND channel_product_no = ?`
    )
    .get(userId, storeId, channelProductNo);

  const detailContentHash =
    payload.detailContentHash !== undefined
      ? String(payload.detailContentHash || '').slice(0, 64)
      : existingSync?.detail_content_hash || '';
  const detailFetchedAt =
    payload.detailFetchedAt === null
      ? null
      : payload.detailFetchedAt !== undefined
        ? String(payload.detailFetchedAt || '')
        : existingSync?.detail_fetched_at || null;
  const detailOk =
    payload.detailOk !== undefined
      ? payload.detailOk
        ? 1
        : 0
      : existingSync?.detail_ok != null
        ? existingSync.detail_ok
        : 0;
  const detailError =
    payload.detailError !== undefined
      ? String(payload.detailError || '').slice(0, 1000)
      : existingSync?.detail_error || '';
  const detailRawJson =
    payload.detailRawJson !== undefined
      ? String(payload.detailRawJson || '').slice(0, 200000)
      : existingSync?.detail_raw_json || '';

  getDb()
    .prepare(
      `INSERT INTO commerce_product_sync (
         user_id, store_id, channel_product_no, origin_product_no, product_name,
         status, content_hash, last_synced_at, last_error, raw_json,
         detail_content_hash, detail_fetched_at, detail_ok, detail_error, detail_raw_json,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, store_id, channel_product_no) DO UPDATE SET
         origin_product_no = excluded.origin_product_no,
         product_name = excluded.product_name,
         status = excluded.status,
         content_hash = excluded.content_hash,
         last_synced_at = excluded.last_synced_at,
         last_error = excluded.last_error,
         raw_json = excluded.raw_json,
         detail_content_hash = excluded.detail_content_hash,
         detail_fetched_at = excluded.detail_fetched_at,
         detail_ok = excluded.detail_ok,
         detail_error = excluded.detail_error,
         detail_raw_json = excluded.detail_raw_json,
         updated_at = datetime('now')`
    )
    .run(
      userId,
      storeId,
      channelProductNo,
      originProductNo,
      productName,
      status,
      contentHashValue,
      lastSyncedAt,
      lastError,
      rawJson,
      detailContentHash,
      detailFetchedAt,
      detailOk,
      detailError,
      detailRawJson
    );

  return getDb()
    .prepare(
      `SELECT * FROM commerce_product_sync
       WHERE user_id = ? AND store_id = ? AND channel_product_no = ?`
    )
    .get(userId, storeId, channelProductNo);
}

export function getCommerceProductSync(userId, channelProductNo, options = {}) {
  const storeId = resolveKnowledgeStoreId(options);
  const no = normalizeProductNo(channelProductNo);
  if (!no) return null;
  return (
    getDb()
      .prepare(
        `SELECT * FROM commerce_product_sync
         WHERE user_id = ? AND store_id = ? AND channel_product_no = ?`
      )
      .get(userId, storeId, no) || null
  );
}

export function listCommerceProductSync(userId, options = {}) {
  const storeId = resolveKnowledgeStoreId(options);
  return getDb()
    .prepare(
      `SELECT * FROM commerce_product_sync
       WHERE user_id = ? AND store_id = ?
       ORDER BY updated_at DESC, id DESC`
    )
    .all(userId, storeId);
}

function mapCommerceOauthRow(row, { includeSecrets = false } = {}) {
  if (!row) return null;
  const storeId = normalizeStoreId(row.store_id);
  const base = {
    id: row.id,
    userId: row.user_id,
    storeId,
    store_id: storeId,
    status: row.status || 'disconnected',
    accountId: row.account_id || '',
    tokenType: row.token_type || 'Bearer',
    expiresAt: row.expires_at || null,
    scope: row.scope || '',
    hasAccessToken: !!row.access_token_enc,
    hasRefreshToken: !!row.refresh_token_enc,
    clientId: row.client_id || '',
    hasClientSecret: !!row.client_secret_enc,
    lastError: row.last_error || '',
    connectedAt: row.connected_at || null,
    disconnectedAt: row.disconnected_at || null,
    updatedAt: row.updated_at || null,
  };
  if (!includeSecrets) return base;
  return {
    ...base,
    accessTokenEnc: row.access_token_enc || '',
    refreshTokenEnc: row.refresh_token_enc || '',
    clientSecretEnc: row.client_secret_enc || '',
    oauthState: row.oauth_state || '',
  };
}

export function getCommerceOauthConnection(userId, options = {}) {
  const storeId = resolveKnowledgeStoreId(options);
  const row = getDb()
    .prepare(
      `SELECT * FROM commerce_oauth_connections WHERE user_id = ? AND store_id = ?`
    )
    .get(userId, storeId);
  return mapCommerceOauthRow(row, { includeSecrets: !!options.includeSecrets });
}

export function upsertCommerceOauthConnection(userId, payload = {}) {
  const storeId = resolveKnowledgeStoreId(payload);
  const existing = getCommerceOauthConnection(userId, { storeId, includeSecrets: true });
  const status = String(payload.status || existing?.status || 'disconnected').slice(0, 40);
  const accountId = String(payload.accountId ?? payload.account_id ?? existing?.accountId ?? '').slice(
    0,
    120
  );
  const accessTokenEnc = Object.prototype.hasOwnProperty.call(payload, 'accessTokenEnc')
    ? String(payload.accessTokenEnc || '')
    : existing?.accessTokenEnc || '';
  const refreshTokenEnc = Object.prototype.hasOwnProperty.call(payload, 'refreshTokenEnc')
    ? String(payload.refreshTokenEnc || '')
    : existing?.refreshTokenEnc || '';
  const clientIdCol = Object.prototype.hasOwnProperty.call(payload, 'clientId')
    ? String(payload.clientId || '').slice(0, 120)
    : existing?.clientId || '';
  const clientSecretEnc = Object.prototype.hasOwnProperty.call(payload, 'clientSecretEnc')
    ? String(payload.clientSecretEnc || '')
    : existing?.clientSecretEnc || '';
  const tokenType = String(payload.tokenType || existing?.tokenType || 'Bearer').slice(0, 40);
  const expiresAt =
    payload.expiresAt === null
      ? null
      : payload.expiresAt !== undefined
        ? String(payload.expiresAt || '') || null
        : existing?.expiresAt || null;
  const scope = String(payload.scope ?? existing?.scope ?? '').slice(0, 500);
  const oauthState = Object.prototype.hasOwnProperty.call(payload, 'oauthState')
    ? String(payload.oauthState || '').slice(0, 200)
    : existing?.oauthState || '';
  const lastError = String(payload.lastError ?? payload.last_error ?? existing?.lastError ?? '').slice(
    0,
    1000
  );
  const connectedAt =
    payload.connectedAt !== undefined
      ? payload.connectedAt
      : existing?.connectedAt || null;
  const disconnectedAt =
    payload.disconnectedAt !== undefined
      ? payload.disconnectedAt
      : existing?.disconnectedAt || null;

  getDb()
    .prepare(
      `INSERT INTO commerce_oauth_connections (
         user_id, store_id, status, account_id, access_token_enc, refresh_token_enc,
         client_id, client_secret_enc,
         token_type, expires_at, scope, oauth_state, last_error, connected_at, disconnected_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, store_id) DO UPDATE SET
         status = excluded.status,
         account_id = excluded.account_id,
         access_token_enc = excluded.access_token_enc,
         refresh_token_enc = excluded.refresh_token_enc,
         client_id = excluded.client_id,
         client_secret_enc = excluded.client_secret_enc,
         token_type = excluded.token_type,
         expires_at = excluded.expires_at,
         scope = excluded.scope,
         oauth_state = excluded.oauth_state,
         last_error = excluded.last_error,
         connected_at = excluded.connected_at,
         disconnected_at = excluded.disconnected_at,
         updated_at = datetime('now')`
    )
    .run(
      userId,
      storeId,
      status,
      accountId,
      accessTokenEnc,
      refreshTokenEnc,
      clientIdCol,
      clientSecretEnc,
      tokenType,
      expiresAt,
      scope,
      oauthState,
      lastError,
      connectedAt,
      disconnectedAt
    );

  return getCommerceOauthConnection(userId, { storeId });
}

export function clearCommerceOauthSecrets(userId, options = {}) {
  const storeId = resolveKnowledgeStoreId(options);
  const status = String(options.status || 'disconnected').slice(0, 40);
  getDb()
    .prepare(
      `UPDATE commerce_oauth_connections SET
         status = ?,
         access_token_enc = '',
         refresh_token_enc = '',
         client_secret_enc = '',
         oauth_state = '',
         expires_at = NULL,
         last_error = ?,
         disconnected_at = datetime('now'),
         updated_at = datetime('now')
       WHERE user_id = ? AND store_id = ?`
    )
    .run(status, String(options.lastError || '').slice(0, 1000), userId, storeId);
  return getCommerceOauthConnection(userId, { storeId });
}

export function upsertCommerceSyncRun(userId, payload = {}) {
  const storeId = resolveKnowledgeStoreId(payload);
  getDb()
    .prepare(
      `INSERT INTO commerce_sync_runs (
         user_id, store_id, status, pages, products, started_at, finished_at, last_error, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, store_id) DO UPDATE SET
         status = excluded.status,
         pages = excluded.pages,
         products = excluded.products,
         started_at = excluded.started_at,
         finished_at = excluded.finished_at,
         last_error = excluded.last_error,
         updated_at = datetime('now')`
    )
    .run(
      userId,
      storeId,
      String(payload.status || 'idle').slice(0, 40),
      Number(payload.pages) || 0,
      Number(payload.products) || 0,
      payload.startedAt || null,
      payload.finishedAt || null,
      String(payload.lastError || '').slice(0, 1000)
    );
  return getCommerceSyncRun(userId, { storeId });
}

export function getCommerceSyncRun(userId, options = {}) {
  const storeId = resolveKnowledgeStoreId(options);
  const row = getDb()
    .prepare(`SELECT * FROM commerce_sync_runs WHERE user_id = ? AND store_id = ?`)
    .get(userId, storeId);
  if (!row) {
    return {
      userId,
      storeId,
      status: 'idle',
      pages: 0,
      products: 0,
      startedAt: null,
      finishedAt: null,
      lastError: '',
    };
  }
  return {
    userId: row.user_id,
    storeId: normalizeStoreId(row.store_id),
    status: row.status,
    pages: row.pages,
    products: row.products,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    lastError: row.last_error || '',
    updatedAt: row.updated_at,
  };
}

function mapStorePolicies(row) {
  if (!row) return null;
  const fieldMeta = parseFieldMetaJson(row.field_meta_json);
  const trustStatus = resolveTrustStatus({
    trustStatus: row.trust_status,
    source: row.source || 'STORE_POLICY',
    verifiedAt: row.verified_at,
  });
  const validity = isKnowledgeEffective({
    validFrom: row.valid_from,
    validTo: row.valid_to,
  });
  const storeId = normalizeStoreId(row.store_id);
  return {
    userId: row.user_id,
    storeId,
    store_id: storeId,
    shipping: row.shipping,
    exchangeReturn: row.exchange_return,
    refund: row.refund,
    customerService: row.customer_service,
    source: row.source,
    sourceNormalized: normalizeSource(row.source || 'STORE_POLICY'),
    verifiedAt: row.verified_at,
    trustStatus,
    fieldMeta,
    validFrom: row.valid_from || null,
    validTo: row.valid_to || null,
    effective: validity.effective,
    effectiveStatus: validity.effectiveStatus,
    updatedAt: row.updated_at,
    exchange_return: row.exchange_return,
    customer_service: row.customer_service,
    verified_at: row.verified_at,
    trust_status: trustStatus,
    field_meta_json: row.field_meta_json || '{}',
  };
}

export function getStorePolicies(userId, options = {}) {
  const storeId = resolveKnowledgeStoreId(options);
  return mapStorePolicies(
    getDb()
      .prepare(`SELECT * FROM store_policies WHERE user_id = ? AND store_id = ?`)
      .get(userId, storeId)
  );
}

export function upsertStorePolicies(userId, payload = {}) {
  const storeId = resolveKnowledgeStoreId(payload);
  const shipping = String(payload.shipping || '').slice(0, 8000);
  const exchangeReturn = String(payload.exchangeReturn || payload.exchange_return || '').slice(0, 8000);
  const refund = String(payload.refund || '').slice(0, 8000);
  const customerService = String(
    payload.customerService || payload.customer_service || ''
  ).slice(0, 8000);
  const source = sourceForStorage(payload.source || 'manual');
  const verifiedAt =
    payload.verifiedAt === null
      ? null
      : String(payload.verifiedAt || payload.verified_at || new Date().toISOString().slice(0, 19).replace('T', ' '));
  const trustStatus = trustStatusForInsert({ ...payload, source });
  const { validFrom, validTo } = assertValidRange(
    payload.validFrom ?? payload.valid_from,
    payload.validTo ?? payload.valid_to
  );
  const existing = getStorePolicies(userId, { storeId });
  const fieldMetaJson =
    payload.fieldMeta != null || payload.field_meta_json != null
      ? stringifyFieldMeta(parseFieldMetaJson(payload.fieldMeta ?? payload.field_meta_json))
      : existing?.field_meta_json || '{}';

  getDb()
    .prepare(
      `INSERT INTO store_policies (
         user_id, store_id, shipping, exchange_return, refund, customer_service, source, verified_at,
         trust_status, field_meta_json, valid_from, valid_to, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, store_id) DO UPDATE SET
         shipping = excluded.shipping,
         exchange_return = excluded.exchange_return,
         refund = excluded.refund,
         customer_service = excluded.customer_service,
         source = excluded.source,
         verified_at = excluded.verified_at,
         trust_status = excluded.trust_status,
         field_meta_json = excluded.field_meta_json,
         valid_from = excluded.valid_from,
         valid_to = excluded.valid_to,
         updated_at = datetime('now')`
    )
    .run(
      userId,
      storeId,
      shipping,
      exchangeReturn,
      refund,
      customerService,
      source,
      verifiedAt,
      trustStatus,
      fieldMetaJson,
      validFrom,
      validTo
    );

  return getStorePolicies(userId, { storeId });
}

export function createInquiryConfirmation(userId, payload = {}) {
  const storeId = resolveKnowledgeStoreId(payload);
  const result = getDb()
    .prepare(
      `INSERT INTO inquiry_confirmations (
         user_id, store_id, inquiry_key, product_no, product_name, question, missing_fields,
         reason, draft_reply, status, evidence_json, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'needs_confirm', ?, datetime('now'))`
    )
    .run(
      userId,
      storeId,
      String(payload.inquiryKey || '').slice(0, 120),
      normalizeProductNo(payload.productNo || ''),
      String(payload.productName || '').slice(0, 200),
      String(payload.question || '').slice(0, 4000),
      String(payload.missingFields || '').slice(0, 1000),
      String(payload.reason || '').slice(0, 1000),
      String(payload.draftReply || '').slice(0, 4000),
      String(payload.evidenceJson || '').slice(0, 20000)
    );
  return getInquiryConfirmation(userId, result.lastInsertRowid);
}

export function getInquiryConfirmation(userId, id) {
  const row = getDb()
    .prepare(`SELECT * FROM inquiry_confirmations WHERE user_id = ? AND id = ?`)
    .get(userId, id);
  if (!row) return null;
  const trustStatus = row.trust_status
    ? resolveTrustStatus({
        trustStatus: row.trust_status,
        source: row.source || 'SELLER_APPROVED',
        verifiedAt: row.approved_at,
      })
    : row.status === 'approved'
      ? 'approved'
      : row.status === 'dismissed'
        ? 'dismissed'
        : 'unverified';
  const validity = isKnowledgeEffective({
    validFrom: row.valid_from,
    validTo: row.valid_to,
  });
  let kbLink = null;
  try {
    kbLink = row.kb_link_json ? JSON.parse(row.kb_link_json) : null;
  } catch {
    kbLink = null;
  }
  const storeId = normalizeStoreId(row.store_id);
  return {
    id: row.id,
    userId: row.user_id,
    storeId,
    store_id: storeId,
    inquiryKey: row.inquiry_key,
    productNo: row.product_no,
    productName: row.product_name,
    question: row.question,
    missingFields: row.missing_fields,
    reason: row.reason,
    draftReply: row.draft_reply,
    status: row.status,
    evidenceJson: row.evidence_json,
    confirmPrompt: row.confirm_prompt || '',
    choiceOptionsJson: row.choice_options_json || '',
    intentKey: row.intent_key || '',
    knowledgeCategory: row.knowledge_category || '',
    approvedAnswer: row.approved_answer || '',
    approvedAt: row.approved_at || null,
    source: row.source || '',
    sourceNormalized: row.source ? normalizeSource(row.source) : '',
    trustStatus,
    validFrom: row.valid_from || null,
    validTo: row.valid_to || null,
    dismissReason: row.dismiss_reason || '',
    kbLink,
    effective: validity.effective,
    effectiveStatus: validity.effectiveStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listInquiryConfirmations(
  userId,
  { status = 'needs_confirm', limit = 50, storeId, store_id } = {}
) {
  const scope = resolveKnowledgeStoreId({ storeId, store_id });
  return getDb()
    .prepare(
      `SELECT * FROM inquiry_confirmations
       WHERE user_id = ? AND store_id = ? AND (? = '' OR status = ?)
       ORDER BY updated_at DESC, id DESC
       LIMIT ?`
    )
    .all(userId, scope, status || '', status || '', limit)
    .map((row) => getInquiryConfirmation(userId, row.id));
}

export function updateInquiryConfirmationStatus(userId, id, status) {
  const allowed = new Set(['needs_confirm', 'approved', 'dismissed']);
  if (!allowed.has(status)) throw new Error('잘못된 상태입니다.');
  getDb()
    .prepare(
      `UPDATE inquiry_confirmations SET status = ?, updated_at = datetime('now') WHERE user_id = ? AND id = ?`
    )
    .run(status, userId, id);
  return getInquiryConfirmation(userId, id);
}

/**
 * FAQ 승인 + (선택) KB mirror. mode=mirror 는 단일 트랜잭션·실패 시 전체 롤백.
 * @param {'mirror'|'faq_only'} [options.mode='mirror']
 */
export function approveInquiryFact(userId, confirmationId, options = {}) {
  const mode = options.mode === 'faq_only' ? 'faq_only' : 'mirror';
  const db = getDb();
  const existing = getInquiryConfirmation(userId, confirmationId);
  if (!existing) {
    const err = new Error('확인 필요 항목을 찾을 수 없습니다.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (existing.status === 'dismissed') {
    const err = new Error('이미 무시된 항목입니다.');
    err.code = 'CONFLICT';
    throw err;
  }

  const field = String(options.field || 'extra');
  const value = String(options.value || '').trim();
  const productNo = normalizeProductNo(options.productNo || existing.productNo || '');
  if (!value) {
    const err = new Error('value가 필요합니다.');
    err.code = 'BAD_REQUEST';
    throw err;
  }
  if (mode === 'mirror' && !productNo) {
    const err = new Error('mirror 모드에는 productNo가 필요합니다.');
    err.code = 'BAD_REQUEST';
    throw err;
  }

  const { validFrom, validTo } = assertValidRange(
    options.validFrom ?? options.valid_from ?? existing.validFrom,
    options.validTo ?? options.valid_to ?? existing.validTo
  );
  const approvedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const intentKey = String(options.intentKey || options.intent_key || existing.intentKey || '').slice(0, 120);
  const knowledgeCategory = String(
    options.knowledgeCategory || options.knowledge_category || existing.knowledgeCategory || ''
  ).slice(0, 40);
  const confirmPrompt = String(
    options.confirmPrompt || options.confirm_prompt || existing.confirmPrompt || existing.question || ''
  ).slice(0, 4000);

  const run = db.transaction(() => {
    let kbItem = null;
    let kbLink = { mode: 'faq_only', productNo: productNo || null };

    if (mode === 'mirror') {
      const storeId = normalizeStoreId(options.storeId ?? options.store_id ?? existing.storeId);
      kbItem = mergeProductKnowledgeField(userId, productNo, field, value, {
        storeId,
        productName: options.productName || existing.productName || '',
        source: 'seller_approved',
        trustStatus: 'approved',
      });
      const fieldBodyMap = {
        product_name: kbItem.productName,
        detail_description: kbItem.detailDescription,
        specs: kbItem.specs,
        usage: kbItem.usage,
        options_compat: kbItem.optionsCompat,
        cautions: kbItem.cautions,
        extra: kbItem.extra,
      };
      const hash = contentHash(fieldBodyMap[field] ?? value);
      const nextMeta = mergeFieldMeta(kbItem.field_meta_json || '{}', field, {
        source: 'SELLER_APPROVED',
        trustStatus: 'approved',
        contentHash: hash,
        validFrom,
        validTo,
        updatedAt: new Date().toISOString(),
      });
      getDb()
        .prepare(
          `UPDATE product_knowledge
           SET field_meta_json = ?, trust_status = 'approved', verified_at = COALESCE(verified_at, ?),
               valid_from = COALESCE(?, valid_from), valid_to = COALESCE(?, valid_to),
               updated_at = datetime('now')
           WHERE user_id = ? AND store_id = ? AND product_no = ?`
        )
        .run(stringifyFieldMeta(nextMeta), approvedAt, validFrom, validTo, userId, storeId, productNo);
      kbItem = getProductKnowledge(userId, productNo, { storeId });
      kbLink = {
        mode: 'mirror',
        productNo,
        field,
        contentHash: hash,
        kbUpdatedAt: kbItem?.updatedAt || approvedAt,
      };
    }

    getDb()
      .prepare(
        `UPDATE inquiry_confirmations SET
           status = 'approved',
           approved_answer = ?,
           approved_at = ?,
           product_no = CASE WHEN ? != '' THEN ? ELSE product_no END,
           product_name = CASE WHEN ? != '' THEN ? ELSE product_name END,
           confirm_prompt = ?,
           intent_key = ?,
           knowledge_category = ?,
           source = 'SELLER_APPROVED',
           trust_status = 'approved',
           valid_from = ?,
           valid_to = ?,
           kb_link_json = ?,
           updated_at = datetime('now')
         WHERE user_id = ? AND id = ?`
      )
      .run(
        value.slice(0, 8000),
        approvedAt,
        productNo,
        productNo,
        String(options.productName || existing.productName || '').slice(0, 200),
        String(options.productName || existing.productName || '').slice(0, 200),
        confirmPrompt,
        intentKey,
        knowledgeCategory,
        validFrom,
        validTo,
        JSON.stringify(kbLink),
        userId,
        confirmationId
      );

    return {
      item: kbItem,
      confirmation: getInquiryConfirmation(userId, confirmationId),
      mode,
    };
  });

  try {
    return run();
  } catch (err) {
    // better-sqlite3 transaction already rolled back
    throw err;
  }
}

/** KB mirror 링크와 현재 KB 본문 hash 일치 여부 */
export function checkKbLinkSync(userId, confirmation) {
  const link = confirmation?.kbLink;
  if (!link || link.mode !== 'mirror' || !link.productNo || !link.field) {
    return { synced: true, reason: 'not_mirror' };
  }
  const kb = getProductKnowledge(userId, link.productNo, {
    storeId: confirmation.storeId ?? confirmation.store_id,
  });
  if (!kb) return { synced: false, reason: 'kb_missing' };
  const fieldMap = {
    product_name: kb.productName,
    detail_description: kb.detailDescription,
    specs: kb.specs,
    usage: kb.usage,
    options_compat: kb.optionsCompat,
    cautions: kb.cautions,
    extra: kb.extra,
  };
  const body = fieldMap[link.field];
  if (body == null) return { synced: false, reason: 'unknown_field' };
  const current = contentHash(body);
  if (link.contentHash && current !== link.contentHash) {
    return { synced: false, reason: 'hash_mismatch', currentHash: current };
  }
  const metaHash = kb.fieldMeta?.[link.field]?.contentHash;
  if (metaHash && metaHash !== current) {
    return { synced: false, reason: 'meta_hash_mismatch', currentHash: current };
  }
  return { synced: true, reason: 'ok' };
}

export function dismissInquiryConfirmation(userId, id, { reason = '' } = {}) {
  const existing = getInquiryConfirmation(userId, id);
  if (!existing) {
    const err = new Error('확인 필요 항목을 찾을 수 없습니다.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (existing.status === 'approved') {
    const err = new Error('이미 승인된 항목은 무시할 수 없습니다.');
    err.code = 'CONFLICT';
    throw err;
  }
  getDb()
    .prepare(
      `UPDATE inquiry_confirmations
       SET status = 'dismissed', trust_status = 'dismissed', dismiss_reason = ?, updated_at = datetime('now')
       WHERE user_id = ? AND id = ?`
    )
    .run(String(reason || '').slice(0, 1000), userId, id);
  return getInquiryConfirmation(userId, id);
}

const PRODUCT_FIELD_COLUMNS = Object.freeze({
  product_name: { column: 'product_name', camel: 'productName', max: 200 },
  detail_description: { column: 'detail_description', camel: 'detailDescription', max: 20000 },
  specs: { column: 'specs', camel: 'specs', max: 8000 },
  usage: { column: 'usage', camel: 'usage', max: 8000 },
  options_compat: { column: 'options_compat', camel: 'optionsCompat', max: 8000 },
  cautions: { column: 'cautions', camel: 'cautions', max: 8000 },
  extra: { column: 'extra', camel: 'extra', max: 8000 },
});

const POLICY_FIELD_COLUMNS = Object.freeze({
  shipping: { column: 'shipping', camel: 'shipping', max: 8000 },
  exchange_return: { column: 'exchange_return', camel: 'exchangeReturn', max: 8000 },
  refund: { column: 'refund', camel: 'refund', max: 8000 },
  customer_service: { column: 'customer_service', camel: 'customerService', max: 8000 },
});

function productFieldValue(item, field) {
  const def = PRODUCT_FIELD_COLUMNS[field];
  if (!def || !item) return '';
  return String(item[def.camel] ?? item[def.column] ?? '').trim();
}

function policyFieldValue(item, field) {
  const def = POLICY_FIELD_COLUMNS[field];
  if (!def || !item) return '';
  return String(item[def.camel] ?? item[def.column] ?? '').trim();
}

/** mirror FAQ → conflict (KB 필드 변경 시). KB 본문은 유지. */
export function markMirrorFaqsConflict(userId, productNo, field, reason = 'kb_field_updated') {
  const no = normalizeProductNo(productNo);
  if (!no || !field) return 0;
  const rows = getDb()
    .prepare(
      `SELECT id, kb_link_json FROM inquiry_confirmations
       WHERE user_id = ? AND status = 'approved' AND product_no = ?`
    )
    .all(userId, no);
  let n = 0;
  const upd = getDb().prepare(
    `UPDATE inquiry_confirmations
     SET trust_status = 'conflict', updated_at = datetime('now')
     WHERE user_id = ? AND id = ?`
  );
  for (const row of rows) {
    let link = null;
    try {
      link = row.kb_link_json ? JSON.parse(row.kb_link_json) : null;
    } catch {
      link = null;
    }
    if (link?.mode === 'mirror' && link.field === field) {
      upd.run(userId, row.id);
      n += 1;
    }
  }
  return n;
}

/**
 * 상품 지식 필드 단위 저장 (다른 필드 유지).
 * mirror FAQ는 conflict 표시.
 */
export function setProductKnowledgeField(userId, productNo, field, value, options = {}) {
  const def = PRODUCT_FIELD_COLUMNS[field];
  if (!def) {
    const err = new Error('허용되지 않은 상품 필드입니다.');
    err.code = 'BAD_FIELD';
    throw err;
  }
  const no = normalizeProductNo(productNo);
  if (!no) {
    const err = new Error('productNo가 필요합니다.');
    err.code = 'BAD_REQUEST';
    throw err;
  }
  const storeId = resolveKnowledgeStoreId(options);
  const nextValue = String(value ?? '').slice(0, def.max);
  let existing = getProductKnowledge(userId, no, { storeId });
  if (!existing) {
    const payload = {
      productNo: no,
      storeId,
      productName: field === 'product_name' ? nextValue : options.productName || '',
      source: options.source || 'manual',
      trustStatus: options.trustStatus || 'approved',
      verifiedAt: options.verifiedAt || new Date().toISOString().slice(0, 19).replace('T', ' '),
      validFrom: options.validFrom,
      validTo: options.validTo,
    };
    payload[def.camel] = nextValue;
    existing = upsertProductKnowledge(userId, payload);
  }

  const payload = {
    productNo: no,
    storeId,
    productName: existing.productName,
    detailDescription: existing.detailDescription,
    specs: existing.specs,
    usage: existing.usage,
    optionsCompat: existing.optionsCompat,
    cautions: existing.cautions,
    extra: existing.extra,
    source: options.source || existing.source || 'manual',
    trustStatus: options.trustStatus || existing.trustStatus || 'approved',
    verifiedAt:
      options.verifiedAt ||
      existing.verifiedAt ||
      new Date().toISOString().slice(0, 19).replace('T', ' '),
    validFrom: options.validFrom !== undefined ? options.validFrom : existing.validFrom,
    validTo: options.validTo !== undefined ? options.validTo : existing.validTo,
  };
  payload[def.camel] = nextValue;

  const fieldMeta = mergeFieldMeta(existing.field_meta_json || '{}', field, {
    source: normalizeSource(options.source || existing.source || 'MANUAL'),
    trustStatus: options.trustStatus || 'approved',
    contentHash: contentHash(nextValue),
    validFrom: options.validFrom !== undefined ? options.validFrom : undefined,
    validTo: options.validTo !== undefined ? options.validTo : undefined,
    updatedAt: new Date().toISOString(),
    // 승인·거부 시 자동수집 충돌 스냅샷 제거
    scrapedValue: '',
    scrapedSource: '',
    scrapedHash: '',
    scrapedAt: '',
  });
  payload.fieldMeta = fieldMeta;

  const item = upsertProductKnowledge(userId, payload);
  if (!options.skipConflictMark) {
    markMirrorFaqsConflict(userId, no, field);
  }
  return item;
}

/** 상품 필드 삭제(본문 비움 + 메타 제거). 행 전체는 유지. */
export function clearProductKnowledgeField(userId, productNo, field, options = {}) {
  const def = PRODUCT_FIELD_COLUMNS[field];
  if (!def) {
    const err = new Error('허용되지 않은 상품 필드입니다.');
    err.code = 'BAD_FIELD';
    throw err;
  }
  const storeId = resolveKnowledgeStoreId(options);
  const existing = getProductKnowledge(userId, productNo, { storeId });
  if (!existing) {
    const err = new Error('상품정보를 찾을 수 없습니다.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const payload = {
    productNo: existing.productNo,
    storeId,
    productName: existing.productName,
    detailDescription: existing.detailDescription,
    specs: existing.specs,
    usage: existing.usage,
    optionsCompat: existing.optionsCompat,
    cautions: existing.cautions,
    extra: existing.extra,
    source: existing.source,
    trustStatus: existing.trustStatus,
    verifiedAt: existing.verifiedAt,
    validFrom: existing.validFrom,
    validTo: existing.validTo,
  };
  payload[def.camel] = '';
  payload.fieldMeta = mergeFieldMeta(existing.field_meta_json || '{}', field, null);

  const item = upsertProductKnowledge(userId, payload);
  if (!options.skipConflictMark) {
    markMirrorFaqsConflict(userId, existing.productNo, field);
  }
  return item;
}

export function setStorePolicyField(userId, field, value, options = {}) {
  const def = POLICY_FIELD_COLUMNS[field];
  if (!def) {
    const err = new Error('허용되지 않은 정책 필드입니다.');
    err.code = 'BAD_FIELD';
    throw err;
  }
  const storeId = resolveKnowledgeStoreId(options);
  const existing = getStorePolicies(userId, { storeId }) || {
    shipping: '',
    exchangeReturn: '',
    refund: '',
    customerService: '',
    source: 'manual',
    field_meta_json: '{}',
  };
  const nextValue = String(value ?? '').slice(0, def.max);
  const payload = {
    storeId,
    shipping: existing.shipping || '',
    exchangeReturn: existing.exchangeReturn || '',
    refund: existing.refund || '',
    customerService: existing.customerService || '',
    source: options.source || existing.source || 'manual',
    trustStatus: options.trustStatus || existing.trustStatus || 'approved',
    verifiedAt:
      options.verifiedAt ||
      existing.verifiedAt ||
      new Date().toISOString().slice(0, 19).replace('T', ' '),
    validFrom: options.validFrom !== undefined ? options.validFrom : existing.validFrom,
    validTo: options.validTo !== undefined ? options.validTo : existing.validTo,
  };
  payload[def.camel] = nextValue;
  const fieldMeta = mergeFieldMeta(existing.field_meta_json || '{}', field, {
    source: normalizeSource(options.source || existing.source || 'STORE_POLICY'),
    trustStatus: options.trustStatus || 'approved',
    contentHash: contentHash(nextValue),
    validFrom: options.validFrom !== undefined ? options.validFrom : undefined,
    validTo: options.validTo !== undefined ? options.validTo : undefined,
    updatedAt: new Date().toISOString(),
  });
  payload.fieldMeta = fieldMeta;
  return upsertStorePolicies(userId, payload);
}

export function clearStorePolicyField(userId, field, options = {}) {
  const def = POLICY_FIELD_COLUMNS[field];
  if (!def) {
    const err = new Error('허용되지 않은 정책 필드입니다.');
    err.code = 'BAD_FIELD';
    throw err;
  }
  const storeId = resolveKnowledgeStoreId(options);
  const existing = getStorePolicies(userId, { storeId });
  if (!existing) {
    const err = new Error('스토어 정책을 찾을 수 없습니다.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const payload = {
    storeId,
    shipping: existing.shipping || '',
    exchangeReturn: existing.exchangeReturn || '',
    refund: existing.refund || '',
    customerService: existing.customerService || '',
    source: existing.source,
    trustStatus: existing.trustStatus,
    verifiedAt: existing.verifiedAt,
    validFrom: existing.validFrom,
    validTo: existing.validTo,
  };
  payload[def.camel] = '';
  payload.fieldMeta = mergeFieldMeta(existing.field_meta_json || '{}', field, null);
  return upsertStorePolicies(userId, payload);
}

export function updateApprovedFaq(userId, id, patch = {}) {
  const existing = getInquiryConfirmation(userId, id);
  if (!existing) {
    const err = new Error('FAQ를 찾을 수 없습니다.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (existing.status !== 'approved') {
    const err = new Error('승인된 FAQ만 수정할 수 있습니다.');
    err.code = 'CONFLICT';
    throw err;
  }

  const answer =
    patch.approvedAnswer !== undefined
      ? String(patch.approvedAnswer || '').slice(0, 8000)
      : existing.approvedAnswer;
  const { validFrom, validTo } = assertValidRange(
    patch.validFrom !== undefined ? patch.validFrom : existing.validFrom,
    patch.validTo !== undefined ? patch.validTo : existing.validTo
  );
  const intentKey =
    patch.intentKey !== undefined
      ? String(patch.intentKey || '').slice(0, 120)
      : existing.intentKey;
  const knowledgeCategory =
    patch.knowledgeCategory !== undefined
      ? String(patch.knowledgeCategory || '').slice(0, 80)
      : existing.knowledgeCategory;
  const confirmPrompt =
    patch.confirmPrompt !== undefined
      ? String(patch.confirmPrompt || '').slice(0, 2000)
      : existing.confirmPrompt;

  let kbLink = existing.kbLink;
  const syncKb = patch.syncKb !== false && kbLink?.mode === 'mirror' && kbLink.field;

  getDb().transaction(() => {
    if (syncKb && kbLink?.productNo) {
      setProductKnowledgeField(userId, kbLink.productNo, kbLink.field, answer, {
        source: 'SELLER_APPROVED',
        trustStatus: 'approved',
        validFrom,
        validTo,
        skipConflictMark: true,
      });
      // 동일 필드의 다른 mirror FAQ만 conflict
      markMirrorFaqsConflict(userId, kbLink.productNo, kbLink.field);
      const kb = getProductKnowledge(userId, kbLink.productNo);
      kbLink = {
        ...kbLink,
        contentHash: contentHash(answer),
        kbUpdatedAt: kb?.updatedAt || new Date().toISOString(),
      };
    }

    getDb()
      .prepare(
        `UPDATE inquiry_confirmations SET
           approved_answer = ?,
           valid_from = ?,
           valid_to = ?,
           intent_key = ?,
           knowledge_category = ?,
           confirm_prompt = ?,
           trust_status = 'approved',
           kb_link_json = ?,
           updated_at = datetime('now')
         WHERE user_id = ? AND id = ?`
      )
      .run(
        answer,
        validFrom,
        validTo,
        intentKey,
        knowledgeCategory,
        confirmPrompt,
        kbLink ? JSON.stringify(kbLink) : existing.kbLink ? JSON.stringify(existing.kbLink) : null,
        userId,
        id
      );
  })();

  // 자기 자신은 다시 approved (markMirrorFaqsConflict가 건드렸을 수 있음)
  if (syncKb) {
    getDb()
      .prepare(
        `UPDATE inquiry_confirmations SET trust_status = 'approved', updated_at = datetime('now')
         WHERE user_id = ? AND id = ?`
      )
      .run(userId, id);
  }

  return getInquiryConfirmation(userId, id);
}

/** FAQ 삭제. 연결된 KB는 기본 유지. */
export function deleteInquiryConfirmation(userId, id, { clearKbField = false } = {}) {
  const existing = getInquiryConfirmation(userId, id);
  if (!existing) {
    const err = new Error('FAQ를 찾을 수 없습니다.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const link = existing.kbLink;
  getDb()
    .prepare(`DELETE FROM inquiry_confirmations WHERE user_id = ? AND id = ?`)
    .run(userId, id);
  if (clearKbField && link?.mode === 'mirror' && link.productNo && link.field) {
    try {
      clearProductKnowledgeField(userId, link.productNo, link.field);
    } catch {
      // KB 없어도 FAQ 삭제는 성공
    }
  }
  return { deleted: true, kbCleared: !!clearKbField, keptKb: !clearKbField };
}

export {
  PRODUCT_FIELD_COLUMNS,
  POLICY_FIELD_COLUMNS,
  productFieldValue,
  policyFieldValue,
};
