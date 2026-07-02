export const PLANS = {
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

export const DEFAULT_PLAN_ID = 'basic';

export function getPlan(planId) {
  return PLANS[planId] || PLANS[DEFAULT_PLAN_ID];
}

export function normalizePlanId(planId) {
  return PLANS[planId] ? planId : DEFAULT_PLAN_ID;
}
