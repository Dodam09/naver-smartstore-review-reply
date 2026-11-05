import { parentPort, workerData } from 'node:worker_threads';

if (parentPort && workerData) {
  process.env.DATA_DIR = workerData.dataDir;
  process.env.DB_PATH = workerData.dbPath;
  process.env.BILLING_MOCK = 'true';
  process.env.ALLOW_REGISTRATION = 'true';
  process.env.RENEWAL_ENABLED = 'false';

  const { confirmBillingAuthCheckout } = await import('./billing.js');

  try {
    const result = await confirmBillingAuthCheckout(workerData.userId, {
      authKey: workerData.authKey,
      customerKey: workerData.customerKey,
      orderId: workerData.orderId,
    });
    parentPort.postMessage({
      ok: true,
      alreadyPaid: result.alreadyPaid === true,
      usageCycle: Number(result.user?.usage_cycle || 0),
      expiresAt: result.user?.subscription_expires_at || null,
    });
  } catch (error) {
    parentPort.postMessage({ ok: false, error: error.message || String(error) });
  }
}
