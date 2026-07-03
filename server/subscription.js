import { findUserById, markUserSubscriptionCancelled } from './db.js';
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
  const cancelled = status === 'cancelled';

  return {
    status,
    active,
    cancelled,
    expiresAt,
    planId: active ? user.plan_id : 'none',
    planName: active ? plan.name : '구독 전',
    price: active ? plan.price : 0,
  };
}

export function isSubscriptionActive(user, now = new Date()) {
  if (!user) return false;
  const status = String(user.subscription_status || 'none');
  if (status !== 'active' && status !== 'cancelled') return false;
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

export function cancelUserSubscriptionAtPeriodEnd(userId) {
  const user = findUserById(userId);
  if (!user) throw new Error('사용자를 찾을 수 없습니다.');
  if (String(user.subscription_status || 'none') === 'cancelled') {
    throw new Error('이미 구독 취소가 예약되어 있습니다.');
  }
  if (String(user.subscription_status || 'none') !== 'active' || !isSubscriptionActive(user)) {
    throw new Error('취소할 활성 구독이 없습니다.');
  }

  const updated = markUserSubscriptionCancelled(userId);
  return getSubscriptionSummary(updated);
}

export function assertCanPurchaseSubscription(user) {
  if (!user) throw new Error('사용자를 찾을 수 없습니다.');
  const status = String(user.subscription_status || 'none');
  if (status === 'active' && isSubscriptionActive(user)) {
    const summary = getSubscriptionSummary(user);
    throw new Error(
      `이미 구독 중입니다. (만료: ${summary.expiresAt || '-'})\n` +
        '추가 결제는 [구독 취소] 후 다시 구독하거나, 만료 이후에 가능합니다.'
    );
  }
}

export function addDaysIso(days, from = new Date()) {
  const next = new Date(from.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 19).replace('T', ' ');
}
