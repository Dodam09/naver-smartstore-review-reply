import {
  activateUserSubscription,
  currentPeriod,
  deactivateUserSubscription,
  findUserById,
  listAllUsers,
} from './db.js';
import { getPlan, normalizePlanId, PLANS } from './plans.js';
import { getSubscriptionSummary, isSubscriptionActive } from './subscription.js';
import { getUsageSummary } from './usage.js';

function formatAdminUser(user, period = currentPeriod()) {
  const subscription = getSubscriptionSummary(user);
  const active = isSubscriptionActive(user);
  const usage = getUsageSummary(user.id, user.plan_id, period, active);
  const plan = getPlan(user.plan_id);

  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name || null,
    authProvider: user.auth_provider || 'email',
    kakaoId: user.kakao_id || null,
    planId: user.plan_id,
    planName: plan.name,
    subscription,
    usage,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

export function getAdminDashboard() {
  const period = currentPeriod();
  const users = listAllUsers();
  const rows = users.map((user) => formatAdminUser(user, period));
  const activeCount = rows.filter((row) => row.subscription.active).length;

  return {
    period,
    stats: {
      totalUsers: rows.length,
      activeSubscriptions: activeCount,
    },
    plans: Object.values(PLANS).map((plan) => ({
      id: plan.id,
      name: plan.name,
      price: plan.price,
      replyLimit: plan.replyLimit,
      toneLimit: plan.toneLimit,
    })),
    users: rows,
  };
}

export function adminGetUser(userId) {
  const user = findUserById(userId);
  if (!user) return null;
  return formatAdminUser(user);
}

export function adminActivateSubscription(userId, planId, days = 30) {
  const user = findUserById(userId);
  if (!user) throw new Error('사용자를 찾을 수 없습니다.');
  const normalizedDays = Math.max(1, Math.min(3650, Number(days) || 30));
  const updated = activateUserSubscription(userId, normalizePlanId(planId || user.plan_id), normalizedDays);
  return formatAdminUser(updated);
}

export function adminDeactivateSubscription(userId) {
  const user = findUserById(userId);
  if (!user) throw new Error('사용자를 찾을 수 없습니다.');
  const updated = deactivateUserSubscription(userId);
  return formatAdminUser(updated);
}
