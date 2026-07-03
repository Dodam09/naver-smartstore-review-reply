import { findUserById, markUserSubscriptionCancelled, resumeUserSubscription } from './db.js';
import { getPlan, getUpgradePrice, normalizePaidPlanId } from './plans.js';

const RENEWAL_GRACE_DAYS = Number(process.env.RENEWAL_GRACE_DAYS || 3);
const RENEWAL_MAX_ATTEMPTS = Number(process.env.RENEWAL_MAX_ATTEMPTS || 3);

function parseDbDate(value) {
  return new Date(String(value || '').replace(' ', 'T') + 'Z');
}

export function isInRenewalGrace(user, now = new Date()) {
  if (!user) return false;
  if (String(user.subscription_status || 'none') !== 'active') return false;
  if (!user.auto_renew || !user.billing_key || !user.subscription_expires_at) return false;
  const failCount = Number(user.renewal_fail_count || 0);
  if (failCount <= 0 || failCount >= RENEWAL_MAX_ATTEMPTS) return false;
  const expires = parseDbDate(user.subscription_expires_at);
  if (expires.getTime() > now.getTime()) return false;
  const graceEnd = expires.getTime() + RENEWAL_GRACE_DAYS * 86400000;
  return now.getTime() <= graceEnd;
}
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
  const renewalGrace = isInRenewalGrace(user);

  return {
    status,
    active,
    cancelled,
    autoRenew: !!(user.auto_renew && user.billing_key),
    renewalGrace,
    renewalFailCount: Number(user.renewal_fail_count || 0),
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
  const expires = parseDbDate(user.subscription_expires_at);
  if (expires.getTime() > now.getTime()) return true;
  if (status === 'active' && isInRenewalGrace(user, now)) return true;
  return false;
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

export function undoCancelSubscription(userId) {
  const user = findUserById(userId);
  if (!user) throw new Error('사용자를 찾을 수 없습니다.');
  if (String(user.subscription_status || 'none') !== 'cancelled') {
    throw new Error('취소 예약된 구독이 없습니다.');
  }
  if (!isSubscriptionActive(user)) {
    throw new Error('만료된 구독입니다. [구독하기]에서 새로 시작해 주세요.');
  }

  const updated = resumeUserSubscription(userId);
  return getSubscriptionSummary(updated);
}

export function assertCanPurchaseSubscription(user) {
  if (!user) throw new Error('사용자를 찾을 수 없습니다.');
  const status = String(user.subscription_status || 'none');
  if (status === 'active' && isSubscriptionActive(user)) {
    const summary = getSubscriptionSummary(user);
    throw new Error(
      `이미 구독 중입니다. (만료: ${summary.expiresAt || '-'})\n` +
        '더 높은 플랜은 [플랜 업그레이드]에서 차액 결제로 변경할 수 있습니다.'
    );
  }
}

export function resolveCheckoutAction(user, targetPlanId) {
  if (!user) throw new Error('사용자를 찾을 수 없습니다.');

  const target = normalizePaidPlanId(targetPlanId);
  const targetPlan = getPlan(target);
  const status = String(user.subscription_status || 'none');
  const active = isSubscriptionActive(user);
  const currentPlanId = active ? normalizePaidPlanId(user.plan_id) : null;

  if (!active) {
    return {
      type: 'subscribe',
      planId: target,
      amount: targetPlan.price,
      orderName: `스마트스토어 답글 ${targetPlan.name}`,
    };
  }

  if (status === 'cancelled') {
    const summary = getSubscriptionSummary(user);
    throw new Error(
      `구독 취소 예약 중입니다. (만료: ${summary.expiresAt || '-'})\n` +
        '만료일까지 현재 플랜을 이용할 수 있으며, 플랜 변경·재구독은 만료 후에 가능합니다.\n' +
        '취소를 되돌리려면 [취소 철회]를 눌러 주세요.'
    );
  }

  if (status === 'active') {
    if (target === currentPlanId) {
      throw new Error(`이미 ${targetPlan.name} 플랜을 이용 중입니다.`);
    }

    const upgradePrice = getUpgradePrice(currentPlanId, target);
    if (upgradePrice == null) {
      const currentPlan = getPlan(currentPlanId);
      throw new Error(
        `${currentPlan.name}에서 ${targetPlan.name}(으)로 다운그레이드는 지원하지 않습니다.\n` +
          '구독 취소 후 만료일 이후 낮은 플랜으로 다시 구독해 주세요.'
      );
    }

    const currentPlan = getPlan(currentPlanId);
    return {
      type: 'upgrade',
      planId: target,
      fromPlanId: currentPlanId,
      amount: upgradePrice,
      orderName: `스마트스토어 답글 ${currentPlan.name} → ${targetPlan.name} 업그레이드`,
    };
  }

  throw new Error('결제할 수 없는 구독 상태입니다.');
}
export function addDaysIso(days, from = new Date()) {
  const next = new Date(from.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 19).replace('T', ' ');
}
