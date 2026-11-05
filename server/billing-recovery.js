import {
  activateUserSubscription,
  claimBillingOrderRecovery,
  findBillingOrder,
  findUserById,
  isIdempotencyKeyExpired,
  listRenewalOrdersForRecovery,
  markBillingOrderRecovery,
  recordRenewalFailure,
  renewUserSubscriptionPeriod,
} from './db.js';
import {
  assessTossPayment,
  chargeWithBillingKey,
  lookupTossPaymentByOrderId,
  TossPaymentFailedError,
  TossPaymentUnknownError,
} from './billing.js';

const SUBSCRIPTION_DAYS = Number(process.env.SUBSCRIPTION_DAYS || 30);
const RENEWAL_MAX_ATTEMPTS = Number(process.env.RENEWAL_MAX_ATTEMPTS || 3);
const RECOVERY_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000];

function isoIn(ms, from = new Date()) {
  return new Date(from.getTime() + ms).toISOString();
}

function backoffMs(attempts) {
  const index = Math.min(Math.max(Number(attempts) || 1, 1), RECOVERY_BACKOFF_MS.length) - 1;
  return RECOVERY_BACKOFF_MS[index];
}

function alreadySettled(order) {
  return !order || Number(order.usage_applied) === 1 || order.status === 'paid' || order.status === 'refunded';
}

function keepUnknown(order, now, reason) {
  return markBillingOrderRecovery(order.id, {
    status: 'unknown',
    failureReason: reason,
    nextRecoveryAt: isoIn(backoffMs(order.recovery_attempts), now),
  });
}

export async function recoverBillingOrder(orderDbId, now = new Date()) {
  const existing = findBillingOrder(orderDbId);
  if (!existing) return { action: 'missing' };
  if (alreadySettled(existing)) return { action: 'already', order: existing };
  if (existing.status === 'failed' || existing.status === 'manual_review') {
    return { action: 'skip', order: existing };
  }
  if (isIdempotencyKeyExpired(existing, now)) {
    const order = markBillingOrderRecovery(existing.id, {
      status: 'manual_review',
      failureReason: 'idempotency_expired',
      nextRecoveryAt: null,
    });
    return { action: 'manual', order };
  }

  const nowIso = now.toISOString();
  const claimed = claimBillingOrderRecovery(existing.id, nowIso, isoIn(backoffMs(1), now));
  if (!claimed) return { action: 'busy', order: findBillingOrder(existing.id) };

  let payment = null;
  let lookupUnclear = false;
  try {
    payment = await lookupTossPaymentByOrderId(claimed.order_id);
  } catch (_) {
    lookupUnclear = true;
    payment = null;
  }

  if (!lookupUnclear) {
    const decision = assessTossPayment(claimed, payment);
    if (decision.action === 'apply' || decision.action === 'fail' || decision.action === 'mismatch') {
      return settlePaymentDecision(claimed, payment, decision, now);
    }
  }

  return retryIdenticalCharge(claimed, now);
}

function settlePaymentDecision(order, payment, decision, now) {
  if (decision.action === 'apply') {
    try {
      const user = applyRecoveredSubscription(order, payment);
      return { action: 'applied', order: findBillingOrder(order.id), user };
    } catch (error) {
      return { action: 'unknown', order: keepUnknown(order, now, 'db_apply_failed'), error };
    }
  }

  if (decision.action === 'fail') {
    const failed = markBillingOrderRecovery(order.id, {
      status: 'failed',
      failureReason: decision.reason,
      nextRecoveryAt: null,
    });
    if (String(order.order_kind) === 'renewal') {
      recordRenewalFailure(order.user_id, RENEWAL_MAX_ATTEMPTS);
    }
    return { action: 'failed', order: failed };
  }

  const held = markBillingOrderRecovery(order.id, {
    status: 'manual_review',
    failureReason: decision.reason,
    nextRecoveryAt: null,
  });
  return { action: 'mismatch', order: held };
}

async function retryIdenticalCharge(order, now) {
  const fresh = findBillingOrder(order.id) || order;
  if (isIdempotencyKeyExpired(fresh, now)) {
    const held = markBillingOrderRecovery(fresh.id, {
      status: 'manual_review',
      failureReason: 'idempotency_expired',
      nextRecoveryAt: null,
    });
    return { action: 'manual', order: held };
  }

  const billingKey = fresh.charge_billing_key || findUserById(fresh.user_id)?.billing_key;
  if (!billingKey) {
    return { action: 'unknown', order: keepUnknown(fresh, now, 'missing_billing_key') };
  }

  try {
    const charge = await chargeWithBillingKey({
      billingKey,
      customerKey: fresh.customer_key,
      amount: fresh.amount,
      orderId: fresh.order_id,
      orderName: fresh.order_name,
    });
    if (charge.alreadyApplied) return { action: 'already', order: findBillingOrder(fresh.id) };
    const decision = assessTossPayment(fresh, charge.raw);
    if (decision.action === 'unknown') {
      return { action: 'unknown', order: keepUnknown(findBillingOrder(fresh.id) || fresh, now, decision.reason) };
    }
    return settlePaymentDecision(fresh, charge.raw, decision, now);
  } catch (error) {
    if (error instanceof TossPaymentFailedError && error.code === 'PAYLOAD_MISMATCH') {
      return { action: 'rejected', order: findBillingOrder(fresh.id), error };
    }
    if (error instanceof TossPaymentUnknownError && error.code === 'IDEMPOTENCY_EXPIRED') {
      return { action: 'manual', order: findBillingOrder(fresh.id), error };
    }
    if (error instanceof TossPaymentFailedError) {
      const failed = markBillingOrderRecovery(fresh.id, {
        status: 'failed',
        failureReason: error.code,
        nextRecoveryAt: null,
      });
      if (String(fresh.order_kind) === 'renewal') {
        recordRenewalFailure(fresh.user_id, RENEWAL_MAX_ATTEMPTS);
      }
      return { action: 'failed', order: failed, error };
    }
    const reason = error instanceof TossPaymentUnknownError ? error.code : 'RETRY_UNKNOWN';
    return { action: 'unknown', order: keepUnknown(findBillingOrder(fresh.id) || fresh, now, reason), error };
  }
}

function applyRecoveredSubscription(order, payment) {
  const paymentKey = payment?.paymentKey || null;
  if (String(order.order_kind) === 'renewal') {
    return renewUserSubscriptionPeriod(order.user_id, SUBSCRIPTION_DAYS, {
      planId: order.plan_id,
      billingOrderId: order.id,
      paymentKey,
    });
  }
  return activateUserSubscription(order.user_id, order.plan_id, SUBSCRIPTION_DAYS, {
    billingKey: order.charge_billing_key || null,
    autoRenew: true,
    billingOrderId: order.id,
    paymentKey,
  });
}

export async function recoverUnconfirmedBillingOrders(now = new Date()) {
  const due = listRenewalOrdersForRecovery(now.toISOString());
  const results = [];
  for (const order of due) {
    results.push(await recoverBillingOrder(order.id, now));
  }
  return results;
}
