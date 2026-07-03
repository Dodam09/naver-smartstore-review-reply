import crypto from 'node:crypto';
import {
  createBillingOrder,
  deactivateUserSubscription,
  expireEndedSubscriptions,
  findUserById,
  getOrCreateCustomerKey,
  listUsersDueForRenewal,
  markBillingOrderPaid,
  renewUserSubscriptionPeriod,
} from './db.js';
import { chargeWithBillingKey, createOrderId, isMockBillingKey } from './billing.js';
import { getPlan } from './plans.js';

const SUBSCRIPTION_DAYS = Number(process.env.SUBSCRIPTION_DAYS || 30);
const RENEWAL_ENABLED = String(process.env.RENEWAL_ENABLED || 'true').toLowerCase() !== 'false';

let renewalRunning = false;

export function isRenewalEnabled() {
  return RENEWAL_ENABLED;
}

export async function processSubscriptionRenewals() {
  if (!RENEWAL_ENABLED || renewalRunning) {
    return { skipped: true, expired: 0, renewed: 0, failed: 0 };
  }

  renewalRunning = true;
  const summary = { expired: 0, renewed: 0, failed: 0, errors: [] };

  try {
    summary.expired = expireEndedSubscriptions();

    const dueUsers = listUsersDueForRenewal();
    for (const user of dueUsers) {
      try {
        await renewSingleUser(user);
        summary.renewed += 1;
      } catch (err) {
        summary.failed += 1;
        summary.errors.push({ userId: user.id, error: err.message || String(err) });
        console.error(`[renewal] user ${user.id} failed:`, err.message || err);
        try {
          deactivateUserSubscription(user.id);
        } catch (deactivateErr) {
          console.error(`[renewal] deactivate user ${user.id} failed:`, deactivateErr.message || deactivateErr);
        }
      }
    }
  } finally {
    renewalRunning = false;
  }

  if (summary.renewed || summary.failed || summary.expired) {
    console.log(
      `[renewal] expired=${summary.expired} renewed=${summary.renewed} failed=${summary.failed}`
    );
  }

  return summary;
}

async function renewSingleUser(user) {
  const plan = getPlan(user.plan_id);
  if (!plan.price) {
    throw new Error('갱신할 유료 플랜이 없습니다.');
  }

  const orderId = createOrderId(user.id);
  const customerKey = user.customer_key || getOrCreateCustomerKey(user.id);
  const orderName = `스마트스토어 답글 ${plan.name} 자동 갱신`;

  const order = createBillingOrder({
    userId: user.id,
    orderId,
    planId: plan.id,
    amount: plan.price,
    orderName,
    customerKey,
  });

  let paymentKey;
  if (isMockBillingKey(user.billing_key)) {
    paymentKey = `mock_renew_${orderId}`;
  } else {
    const charge = await chargeWithBillingKey({
      billingKey: user.billing_key,
      customerKey,
      amount: plan.price,
      orderId,
      orderName,
    });
    paymentKey = charge.paymentKey || `billing_${orderId}`;
  }

  markBillingOrderPaid(order.id, paymentKey);
  renewUserSubscriptionPeriod(user.id, SUBSCRIPTION_DAYS);
  return findUserById(user.id);
}

export function startRenewalScheduler() {
  if (!RENEWAL_ENABLED) {
    console.log('RENEWAL_ENABLED=false (auto-renewal scheduler off)');
    return;
  }

  const intervalMs = Math.max(60_000, Number(process.env.RENEWAL_INTERVAL_MS || 15 * 60 * 1000));
  console.log(`Auto-renewal scheduler every ${Math.round(intervalMs / 60000)} min`);

  const tick = () => {
    processSubscriptionRenewals().catch((err) => {
      console.error('[renewal] scheduler error:', err.message || err);
    });
  };

  setTimeout(tick, 15_000);
  setInterval(tick, intervalMs);
}
