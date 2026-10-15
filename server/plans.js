export const FREE_TRIAL = {
  replyLimit: 10,
  toneLimit: 1,
  lifetime: true,
};

export const PLANS = {
  none: {
    id: 'none',
    name: '무료 체험',
    price: 0,
    replyLimit: FREE_TRIAL.replyLimit,
    toneLimit: FREE_TRIAL.toneLimit,
  },
  basic: {
    id: 'basic',
    name: '베이직',
    price: 9900,
    replyLimit: 150,
    toneLimit: 50,
  },
  standard: {
    id: 'standard',
    name: '스탠다드',
    price: 19900,
    replyLimit: 600,
    toneLimit: 120,
  },
  pro: {
    id: 'pro',
    name: '프로',
    price: 39900,
    replyLimit: 2000,
    toneLimit: 300,
  },
};

export const PAID_PLAN_IDS = ['basic', 'standard', 'pro'];
export const DEFAULT_PLAN_ID = 'none';

export function getPlan(planId) {
  return PLANS[planId] || PLANS.none;
}

export function normalizePlanId(planId) {
  return PLANS[planId] ? planId : DEFAULT_PLAN_ID;
}

export function normalizePaidPlanId(planId) {
  return PAID_PLAN_IDS.includes(planId) ? planId : 'basic';
}

export function listPaidPlans() {
  return PAID_PLAN_IDS.map((id) => PLANS[id]);
}

const PLAN_RANK = { basic: 1, standard: 2, pro: 3 };

export function getPlanRank(planId) {
  return PLAN_RANK[normalizePaidPlanId(planId)] || 0;
}

export function comparePlans(fromPlanId, toPlanId) {
  return getPlanRank(toPlanId) - getPlanRank(fromPlanId);
}

export function getUpgradePrice(fromPlanId, toPlanId) {
  if (comparePlans(fromPlanId, toPlanId) <= 0) return null;
  const from = getPlan(fromPlanId);
  const to = getPlan(toPlanId);
  return to.price - from.price;
}

/** 카드사 심사용 단건(업그레이드) 금액 — 베이직 차액 기준 */
export const REVIEW_ONETIME_AMOUNTS = {
  basic: 9900,
  standard: 10000,
  pro: 30000,
};

export function listReviewBillingProducts() {
  return listPaidPlans().map((plan) => ({
    id: plan.id,
    name: plan.name,
    label: `${plan.name} 정기결제`,
    amount: plan.price,
    mode: 'billing',
    replyLimit: plan.replyLimit,
    toneLimit: plan.toneLimit,
  }));
}

export function listReviewOnetimeProducts() {
  return listPaidPlans().map((plan) => ({
    id: plan.id,
    name: plan.name,
    label: `${plan.name} 업그레이드`,
    amount: REVIEW_ONETIME_AMOUNTS[plan.id],
    mode: 'onetime',
    replyLimit: plan.replyLimit,
    toneLimit: plan.toneLimit,
  }));
}
