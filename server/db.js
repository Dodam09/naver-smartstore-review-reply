import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { DEFAULT_PLAN_ID, normalizePlanId } from './plans.js';

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
  `);

  migrateBillingOrdersTable(database);
  migrateUsersTable(database);
}

function migrateBillingOrdersTable(database) {
  const cols = database.prepare('PRAGMA table_info(billing_orders)').all().map((c) => c.name);
  if (!cols.includes('order_kind')) {
    database.exec(`ALTER TABLE billing_orders ADD COLUMN order_kind TEXT NOT NULL DEFAULT 'payment'`);
  }
  if (!cols.includes('legal_consent_at')) {
    database.exec(`ALTER TABLE billing_orders ADD COLUMN legal_consent_at TEXT`);
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

  database.exec(`
    UPDATE users
    SET plan_id = 'none', updated_at = datetime('now')
    WHERE COALESCE(subscription_status, 'none') NOT IN ('active', 'cancelled')
      AND plan_id IN ('basic', 'standard', 'pro')
  `);
}

export function getDb() {
  if (db) return db;
  ensureDataDir();
  db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');
  initSchema(db);
  return db;
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

export function createKakaoUser({ kakaoId, email, displayName, planId = DEFAULT_PLAN_ID }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedPlan = normalizePlanId(planId);
  const result = getDb()
    .prepare(
      `INSERT INTO users (email, password_hash, plan_id, kakao_id, auth_provider, display_name)
       VALUES (?, 'oauth:kakao', ?, ?, 'kakao', ?)`
    )
    .run(normalizedEmail, normalizedPlan, String(kakaoId), displayName || null);
  return findUserById(result.lastInsertRowid);
}

export function createUser(email, passwordHash, planId = DEFAULT_PLAN_ID) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedPlan = normalizePlanId(planId);
  const result = getDb()
    .prepare(
      `INSERT INTO users (email, password_hash, plan_id)
       VALUES (?, ?, ?)`
    )
    .run(normalizedEmail, passwordHash, normalizedPlan);
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
       SET subscription_status = 'cancelled', auto_renew = 0, updated_at = datetime('now')
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
           updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(userId);
  return findUserById(userId);
}

export function setUserBillingKey(userId, billingKey, { enableAutoRenew = true } = {}) {
  getDb()
    .prepare(
      `UPDATE users
       SET billing_key = ?, auto_renew = ?, renewal_fail_count = 0, renewal_last_attempt_at = NULL,
           updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(String(billingKey || ''), enableAutoRenew ? 1 : 0, userId);
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
           updated_at = datetime('now')
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

export function incrementUsage(userId, kind, channel, period = currentPeriod()) {
  ensureUsageRow(userId, period);
  const column = kind === 'tone' ? 'tone_count' : 'reply_count';
  getDb()
    .prepare(
      `UPDATE usage_monthly
       SET ${column} = ${column} + 1, updated_at = datetime('now')
       WHERE user_id = ? AND period = ?`
    )
    .run(userId, period);

  getDb()
    .prepare(
      `INSERT INTO usage_logs (user_id, period, kind, channel)
       VALUES (?, ?, ?, ?)`
    )
    .run(userId, period, kind, channel || null);

  return getUsageRow(userId, period);
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
  const result = getDb()
    .prepare(
      `INSERT INTO billing_orders (user_id, order_id, plan_id, amount, order_name, customer_key, status, order_kind, legal_consent_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
    )
    .run(
      userId,
      orderId,
      normalizePlanId(planId),
      amount,
      orderName,
      customerKey,
      orderKind,
      legalConsentAt
    );
  return findBillingOrder(result.lastInsertRowid);
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

export function activateUserSubscription(userId, planId, days = 30, options = {}) {
  const user = findUserById(userId);
  if (!user) throw new Error('사용자를 찾을 수 없습니다.');
  const { billingKey = null, autoRenew = null } = options;

  const now = new Date();
  let base = now;
  if (user.subscription_status === 'active' && user.subscription_expires_at) {
    const currentExpires = new Date(String(user.subscription_expires_at).replace(' ', 'T') + 'Z');
    if (currentExpires.getTime() > now.getTime()) {
      base = currentExpires;
    }
  }
  if (user.subscription_status === 'cancelled' && user.subscription_expires_at) {
    const currentExpires = new Date(String(user.subscription_expires_at).replace(' ', 'T') + 'Z');
    if (currentExpires.getTime() > now.getTime()) {
      base = currentExpires;
    }
  }

  const expiresAt = addDaysIsoLocal(days, base);
  const nextBillingKey = billingKey != null ? billingKey : user.billing_key;
  const nextAutoRenew =
    autoRenew != null ? (autoRenew ? 1 : 0) : billingKey != null ? 1 : user.auto_renew ? 1 : 0;

  getDb()
    .prepare(
      `UPDATE users
       SET plan_id = ?, subscription_status = 'active', subscription_expires_at = ?,
           billing_key = ?, auto_renew = ?, updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(normalizePlanId(planId), expiresAt, nextBillingKey, nextAutoRenew, userId);

  return findUserById(userId);
}

export function renewUserSubscriptionPeriod(userId, days = 30) {
  const user = findUserById(userId);
  if (!user) throw new Error('사용자를 찾을 수 없습니다.');
  if (!user.subscription_expires_at) {
    throw new Error('갱신할 구독 만료일이 없습니다.');
  }

  const base = new Date(String(user.subscription_expires_at).replace(' ', 'T') + 'Z');
  const expiresAt = addDaysIsoLocal(days, base);
  getDb()
    .prepare(
      `UPDATE users
       SET subscription_status = 'active', subscription_expires_at = ?, auto_renew = 1,
           renewal_fail_count = 0, renewal_last_attempt_at = NULL, updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(expiresAt, userId);

  return findUserById(userId);
}

export function upgradeUserSubscription(userId, planId) {
  const user = findUserById(userId);
  if (!user) throw new Error('사용자를 찾을 수 없습니다.');
  if (!user.subscription_expires_at) {
    throw new Error('업그레이드할 활성 구독이 없습니다.');
  }

  getDb()
    .prepare(
      `UPDATE users
       SET plan_id = ?, subscription_status = 'active', updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(normalizePlanId(planId), userId);

  return findUserById(userId);
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
       WHERE user_id = ? AND status IN ('paid', 'refunded')
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
