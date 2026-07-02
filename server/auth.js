import crypto from 'node:crypto';
import {
  createSession,
  createUser,
  deleteSession,
  findSession,
  findUserByEmail,
  findUserById,
  setUserSubscriptionActive,
} from './db.js';
import { DEFAULT_PLAN_ID, getPlan, normalizePlanId } from './plans.js';
import { getSubscriptionSummary } from './subscription.js';
import { getUsageSummary } from './usage.js';

const SESSION_DAYS = Number(process.env.SESSION_DAYS || 30);
const PASSWORD_MIN_LENGTH = 8;

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, expectedHash] = String(stored || '').split(':');
  if (!salt || !expectedHash) return false;
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  if (hash.length !== expectedHash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expectedHash, 'hex'));
}

function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

function sessionExpiryIso(days = SESSION_DAYS) {
  const expires = new Date();
  expires.setUTCDate(expires.getUTCDate() + days);
  return expires.toISOString().slice(0, 19).replace('T', ' ');
}

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    planId: user.plan_id,
    plan: getPlan(user.plan_id),
    subscription: getSubscriptionSummary(user),
  };
}

export function registerUser({ email, password, planId = DEFAULT_PLAN_ID }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const plainPassword = String(password || '');

  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    throw new Error('올바른 이메일을 입력해 주세요.');
  }
  if (plainPassword.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`비밀번호는 ${PASSWORD_MIN_LENGTH}자 이상이어야 합니다.`);
  }
  if (findUserByEmail(normalizedEmail)) {
    throw new Error('이미 가입된 이메일입니다.');
  }

  const user = createUser(normalizedEmail, hashPassword(plainPassword), normalizePlanId(planId));
  return sanitizeUser(user);
}

export function loginUser({ email, password }) {
  const user = findUserByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw new Error('이메일 또는 비밀번호가 올바르지 않습니다.');
  }

  const token = createToken();
  createSession(user.id, token, sessionExpiryIso());
  return {
    token,
    user: sanitizeUser(user),
    usage: getUsageSummary(user.id, user.plan_id),
    subscription: getSubscriptionSummary(user),
  };
}

export function logoutUser(token) {
  if (token) deleteSession(token);
}

export function getAuthFromToken(token) {
  const session = findSession(token);
  if (!session) return null;
  const user = findUserById(session.user_id);
  if (!user) return null;
  return {
    token,
    user: sanitizeUser(user),
    usage: getUsageSummary(user.id, user.plan_id),
    subscription: getSubscriptionSummary(user),
  };
}

export function ensureAdminUser(email, password, planId = 'pro') {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const plainPassword = String(password || '');
  if (!normalizedEmail || plainPassword.length < PASSWORD_MIN_LENGTH) return null;

  const existing = findUserByEmail(normalizedEmail);
  if (existing) {
    setUserSubscriptionActive(existing.id, normalizePlanId(planId), 3650);
    return sanitizeUser(findUserById(existing.id));
  }

  const user = createUser(normalizedEmail, hashPassword(plainPassword), normalizePlanId(planId));
  setUserSubscriptionActive(user.id, normalizePlanId(planId), 3650);
  return sanitizeUser(findUserById(user.id));
}

export function parseBearerToken(headerValue) {
  const auth = String(headerValue || '');
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
}
