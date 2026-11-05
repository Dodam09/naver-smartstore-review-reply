import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { makeKoreanNickname } from './nicknames.js';
import { DEFAULT_PLAN_ID, normalizePaidPlanId, normalizePlanId } from './plans.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'app.db');

let db;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
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
  `);

  migrateBillingOrdersTable(database);
  migrateUsersTable(database);
  migrateLegacySubscriptionUsage(database);
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
  db = new Database(DB_PATH, { timeout: 5000 });
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
