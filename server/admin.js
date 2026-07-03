import {
  activateUserSubscription,
  currentPeriod,
  deactivateUserSubscription,
  findUserById,
  listAllUsers,
  listRecentBillingOrders,
  upgradeUserSubscription,
} from './db.js';
import { getPlan, listPaidPlans, normalizePaidPlanId } from './plans.js';
import {
  cancelUserSubscriptionAtPeriodEnd,
  getSubscriptionSummary,
  isSubscriptionActive,
  undoCancelSubscription,
} from './subscription.js';
import { getUsageSummary } from './usage.js';

function formatAdminUser(user, period = currentPeriod()) {
  const subscription = getSubscriptionSummary(user);
  const active = isSubscriptionActive(user);
  const usage = getUsageSummary(user.id, user.plan_id, period, active);
  const plan = getPlan(active ? user.plan_id : 'none');

  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name || null,
    authProvider: user.auth_provider || 'email',
    kakaoId: user.kakao_id || null,
    planId: active ? user.plan_id : 'none',
    planName: plan.name,
    activationPlanId: active ? user.plan_id : 'basic',
    billingKeyRegistered: !!user.billing_key,
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
  const cancelledPendingCount = rows.filter(
    (row) => row.subscription.active && (row.subscription.cancelled || row.subscription.status === 'cancelled')
  ).length;
  const paidActiveCount = rows.filter(
    (row) =>
      row.subscription.active &&
      row.subscription.status === 'active' &&
      !row.subscription.cancelled
  ).length;
  const autoRenewCount = rows.filter(
    (row) => row.subscription.active && row.subscription.autoRenew
  ).length;

  return {
    period,
    stats: {
      totalUsers: rows.length,
      activeSubscriptions: activeCount,
      paidActiveSubscriptions: paidActiveCount,
      cancelledPending: cancelledPendingCount,
      autoRenewSubscriptions: autoRenewCount,
    },
    plans: listPaidPlans().map((plan) => ({
      id: plan.id,
      name: plan.name,
      price: plan.price,
      replyLimit: plan.replyLimit,
      toneLimit: plan.toneLimit,
    })),
    recentOrders: listRecentBillingOrders(30).map((order) => ({
      id: order.id,
      userId: order.user_id,
      email: order.email,
      displayName: order.display_name,
      orderId: order.order_id,
      planId: order.plan_id,
      planName: getPlan(order.plan_id).name,
      amount: order.amount,
      kind: order.order_kind || 'payment',
      status: order.status,
      paidAt: order.paid_at || order.created_at,
      orderName: order.order_name,
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
  const targetPlan = normalizePaidPlanId(planId || user.plan_id);
  const updated = activateUserSubscription(userId, targetPlan, normalizedDays);
  return formatAdminUser(updated);
}

export function adminDeactivateSubscription(userId) {
  const user = findUserById(userId);
  if (!user) throw new Error('사용자를 찾을 수 없습니다.');
  const updated = deactivateUserSubscription(userId);
  return formatAdminUser(updated);
}

export function adminCancelSubscription(userId) {
  const user = findUserById(userId);
  if (!user) throw new Error('사용자를 찾을 수 없습니다.');
  cancelUserSubscriptionAtPeriodEnd(userId);
  return formatAdminUser(findUserById(userId));
}

export function adminUndoCancelSubscription(userId) {
  const user = findUserById(userId);
  if (!user) throw new Error('사용자를 찾을 수 없습니다.');
  undoCancelSubscription(userId);
  return formatAdminUser(findUserById(userId));
}

export function adminChangePlanKeepExpiry(userId, planId) {
  const user = findUserById(userId);
  if (!user) throw new Error('사용자를 찾을 수 없습니다.');
  if (!isSubscriptionActive(user)) {
    throw new Error('만료일이 남은 활성 구독이 없습니다. [구독 활성화]를 사용하세요.');
  }
  upgradeUserSubscription(userId, normalizePaidPlanId(planId));
  return formatAdminUser(findUserById(userId));
}
