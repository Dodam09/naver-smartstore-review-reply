import { findUserById } from './db.js';
import { getPlan } from './plans.js';

export class SubscriptionError extends Error {
  constructor(message, subscription) {
    super(message);
    this.name = 'SubscriptionError';
    this.subscription = subscription;
  }
}

export function getSubscriptionSummary(user) {
  if (!user) return null;
  const plan = getPlan(user.plan_id);
  const status = String(user.subscription_status || 'none');
  const expiresAt = user.subscription_expires_at || null;
  const active = isSubscriptionActive(user);

  return {
    status,
    active,
    expiresAt,
    planId: user.plan_id,
    planName: plan.name,
    price: plan.price,
  };
}

export function isSubscriptionActive(user, now = new Date()) {
  if (!user) return false;
  const status = String(user.subscription_status || 'none');
  if (status !== 'active') return false;
  if (!user.subscription_expires_at) return false;
  const expires = new Date(String(user.subscription_expires_at).replace(' ', 'T') + 'Z');
  return expires.getTime() > now.getTime();
}

export function assertSubscriptionActive(userId) {
  const user = findUserById(userId);
  const subscription = getSubscriptionSummary(user);
  if (!isSubscriptionActive(user)) {
    throw new SubscriptionError(
      '구독이 필요합니다. [설정] → 구독하기에서 플랜을 결제해 주세요.',
      subscription
    );
  }
  return subscription;
}

export function addDaysIso(days, from = new Date()) {
  const next = new Date(from.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 19).replace('T', ' ');
}
