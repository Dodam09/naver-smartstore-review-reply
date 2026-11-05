import {
  createBillingOrder,
  expireEndedSubscriptions,
  expireRenewalGracePeriod,
  findOpenRenewalOrder,
  findUserById,
  getOrCreateCustomerKey,
  isIdempotencyKeyExpired,
  listUsersDueForRenewal,
  markBillingOrderRecovery,
  recordRenewalFailure,
  renewUserSubscriptionPeriod,
} from './db.js';
import { chargeWithBillingKey, createOrderId, isMockBillingKey, TossPaymentFailedError, TossPaymentUnknownError } from './billing.js';
import { recoverBillingOrder, recoverUnconfirmedBillingOrders } from './billing-recovery.js';
import { getPlan } from './plans.js';

const SUBSCRIPTION_DAYS = Number(process.env.SUBSCRIPTION_DAYS || 30);
const RENEWAL_ENABLED = String(process.env.RENEWAL_ENABLED || 'true').toLowerCase() !== 'false';
const RENEWAL_MAX_ATTEMPTS = Number(process.env.RENEWAL_MAX_ATTEMPTS || 3);
const RENEWAL_GRACE_DAYS = Number(process.env.RENEWAL_GRACE_DAYS || 3);

let renewalRunning = false;

export function isRenewalEnabled() {
  return RENEWAL_ENABLED;
}

export async function processSubscriptionRenewals() {
  if (!RENEWAL_ENABLED || renewalRunning) {
    return { skipped: true, expired: 0, graceExpired: 0, renewed: 0, failed: 0 };
  }

  renewalRunning = true;
  const summary = { expired: 0, graceExpired: 0, renewed: 0, failed: 0, recovered: 0, errors: [] };

  try {
    const recovered = await recoverUnconfirmedBillingOrders();
    summary.recovered = recovered.filter((item) => item.action === 'applied').length;
    summary.expired = expireEndedSubscriptions();
    summary.graceExpired = expireRenewalGracePeriod(RENEWAL_GRACE_DAYS, RENEWAL_MAX_ATTEMPTS);

    const dueUsers = listUsersDueForRenewal(undefined, RENEWAL_MAX_ATTEMPTS);
    for (const user of dueUsers) {
      try {
        await renewSingleUser(user);
        summary.renewed += 1;
      } catch (err) {
        summary.failed += 1;
        summary.errors.push({ userId: user.id, error: err.message || String(err) });
        console.error(`[renewal] user ${user.id} failed:`, err.message || err);
        const result = recordRenewalFailure(user.id, RENEWAL_MAX_ATTEMPTS);
        if (result.deactivated) {
          console.error(`[renewal] user ${user.id} deactivated after ${result.failCount} failures`);
        }
      }
    }
  } finally {
    renewalRunning = false;
  }

  if (summary.renewed || summary.failed || summary.expired || summary.graceExpired) {
    console.log(
      `[renewal] expired=${summary.expired} graceExpired=${summary.graceExpired} renewed=${summary.renewed} failed=${summary.failed}`
    );
  }

  return summary;
}

export async function chargeAndApplyRenewal(user, order) {
  let charged = null;
  try {
    const charge = await chargeWithBillingKey({
      billingKey: user.billing_key,
      customerKey: order.customer_key,
      amount: order.amount,
      orderId: order.order_id,
      orderName: order.order_name,
    });
    charged = charge;
    if (charge.alreadyApplied) return findUserById(user.id);
    renewUserSubscriptionPeriod(user.id, SUBSCRIPTION_DAYS, {
      planId: order.plan_id,
      billingOrderId: order.id,
      paymentKey: charge.paymentKey,
    });
    return findUserById(user.id);
  } catch (error) {
    if (error instanceof TossPaymentUnknownError) {
      if (error.code !== 'IDEMPOTENCY_EXPIRED') {
        markBillingOrderRecovery(order.id, {
          status: 'unknown',
          failureReason: error.code,
          nextRecoveryAt: new Date().toISOString(),
        });
      }
      return findUserById(user.id);
    }
    if (charged) {
      markBillingOrderRecovery(order.id, {
        status: 'unknown',
        failureReason: 'db_apply_failed',
        nextRecoveryAt: new Date().toISOString(),
      });
      return findUserById(user.id);
    }
    if (error instanceof TossPaymentFailedError) {
      markBillingOrderRecovery(order.id, {
        status: 'failed',
        failureReason: error.code,
        nextRecoveryAt: null,
      });
    }
    throw error;
  }
}

async function renewSingleUser(user) {
  const open = findOpenRenewalOrder(user.id);
  if (open && !isMockBillingKey(user.billing_key)) {
    if (open.status === 'manual_review' || isIdempotencyKeyExpired(open)) {
      if (open.status !== 'manual_review') {
        markBillingOrderRecovery(open.id, {
          status: 'manual_review',
          failureReason: 'idempotency_expired',
          nextRecoveryAt: null,
        });
      }
      return findUserById(user.id);
    }
    const recovered = await recoverBillingOrder(open.id);
    if (recovered.action !== 'failed') return findUserById(user.id);
  }

  const renewPlanId = user.pending_plan_id || user.plan_id;
  const plan = getPlan(renewPlanId);
  if (!plan.price) {
    throw new Error('갱신할 유료 플랜이 없습니다.');
  }

  const orderId = createOrderId(user.id);
  const customerKey = user.customer_key || getOrCreateCustomerKey(user.id);
  const isDowngradeRenewal = !!(user.pending_plan_id && user.pending_plan_id !== user.plan_id);
  const orderName = isDowngradeRenewal
    ? `스마트스토어 답글 ${plan.name} 다운그레이드 갱신`
    : `스마트스토어 답글 ${plan.name} 자동 갱신`;

  const order = createBillingOrder({
    userId: user.id,
    orderId,
    planId: plan.id,
    amount: plan.price,
    orderName,
    customerKey,
    orderKind: 'renewal',
  });

  if (isMockBillingKey(user.billing_key)) {
    renewUserSubscriptionPeriod(user.id, SUBSCRIPTION_DAYS, {
      planId: plan.id,
      billingOrderId: order.id,
      paymentKey: `mock_renew_${orderId}`,
    });
    return findUserById(user.id);
  }

  return chargeAndApplyRenewal(user, order);
}

export function startRenewalScheduler() {
  if (!RENEWAL_ENABLED) {
    console.log('RENEWAL_ENABLED=false (auto-renewal scheduler off)');
    return;
  }

  const intervalMs = Math.max(60_000, Number(process.env.RENEWAL_INTERVAL_MS || 15 * 60 * 1000));
  console.log(
    `Auto-renewal scheduler every ${Math.round(intervalMs / 60000)} min (grace ${RENEWAL_GRACE_DAYS}d, max ${RENEWAL_MAX_ATTEMPTS} attempts)`
  );

  const tick = () => {
    processSubscriptionRenewals().catch((err) => {
      console.error('[renewal] scheduler error:', err.message || err);
    });
  };

  setTimeout(tick, 15_000);
  setInterval(tick, intervalMs);
}
