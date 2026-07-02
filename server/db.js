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

  migrateUsersTable(database);
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

export function createBillingOrder({ userId, orderId, planId, amount, orderName, customerKey }) {
  const result = getDb()
    .prepare(
      `INSERT INTO billing_orders (user_id, order_id, plan_id, amount, order_name, customer_key, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`
    )
    .run(userId, orderId, normalizePlanId(planId), amount, orderName, customerKey);
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

export function activateUserSubscription(userId, planId, days = 30) {
  const user = findUserById(userId);
  if (!user) throw new Error('사용자를 찾을 수 없습니다.');

  const now = new Date();
  let base = now;
  if (user.subscription_status === 'active' && user.subscription_expires_at) {
    const currentExpires = new Date(String(user.subscription_expires_at).replace(' ', 'T') + 'Z');
    if (currentExpires.getTime() > now.getTime()) {
      base = currentExpires;
    }
  }

  const expiresAt = addDaysIsoLocal(days, base);
  getDb()
    .prepare(
      `UPDATE users
       SET plan_id = ?, subscription_status = 'active', subscription_expires_at = ?, updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(normalizePlanId(planId), expiresAt, userId);

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
