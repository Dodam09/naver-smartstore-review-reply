import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ensureAdminUser,
  ensurePasswordUser,
  getAuthFromToken,
  loginUser,
  loginWithKakao,
  logoutUser,
  parseBearerToken,
  registerUser,
} from './auth.js';
import {
  confirmBillingAuthCheckout,
  confirmCardUpdate,
  confirmCheckout,
  getBillingConfig,
  getPaymentHistory,
  logBillingStartupWarnings,
  mockConfirmBillingAuth,
  mockConfirmCardUpdate,
  mockConfirmCheckout,
  mockSubscribe,
  prepareCardUpdate,
  prepareCheckout,
  prepareReviewCheckout,
  refundBillingOrder,
} from './billing.js';
import { recordAnalyticsEvent } from './analytics.js';
import {
  adminActivateSubscription,
  adminCancelSubscription,
  adminChangePlanKeepExpiry,
  adminDeactivateSubscription,
  adminGetUser,
  adminUndoCancelSubscription,
  getAdminDashboard,
} from './admin.js';
import {
  getDb,
  findUserById,
  markUserInstallGenerated,
  updateUserPlan,
  listProductKnowledge,
  getProductKnowledge,
  upsertProductKnowledge,
  deleteProductKnowledge,
  getStorePolicies,
  upsertStorePolicies,
  createInquiryConfirmation,
  getInquiryConfirmation,
  listInquiryConfirmations,
  approveInquiryFact,
  dismissInquiryConfirmation,
  checkKbLinkSync,
  listCommerceProductSync,
} from './db.js';
import {
  deleteKnowledgeEntry,
  getKnowledgeEntry,
  getKnowledgeSummary,
  listKnowledgeEntries,
  patchKnowledgeEntry,
} from './knowledge-entries.js';
import {
  connectCommerceOauth,
  disconnectCommerceOauth,
  getCommerceOauthStatus,
  reissueCommerceAccessToken,
  safeOauthLog,
} from './commerce-oauth.js';
import { getCommerceSyncStatus, syncCommerceProductCatalog } from './commerce-sync.js';
import {
  approveCommerceProductField,
  fetchCommerceProductDetail,
  getCommerceProductCatalog,
  rejectCommerceProductField,
} from './commerce-detail.js';
import { CommerceApiError } from './commerce-api.js';
import {
  resolveProductKnowledgeMatch,
  resolveInquiryEvidence,
  buildSellerConfirmDraft,
  formatVerifiedFactsForPrompt,
} from './evidence.js';
import {
  GeminiError,
  GeminiQueueFullError,
  GeminiTimeoutError,
  generateText,
  generateWithSystem,
  getGeminiQueueStats,
  isGeminiConfigured,
} from './gemini.js';
import { FREE_TRIAL, getPlan, normalizePlanId } from './plans.js';
import {
  buildAnalyzeToneV2Prompt,
  buildInquiryPlaybookPrompt,
  buildInquiryKnowledgeDraftPrompt,
  normalizeInquiryPairs,
  buildInquiryUserContent,
  buildProductFactLookupPrompt,
  buildProductSearchKeywords,
  buildReviewUserContent,
  appendReplyHardRules,
  sanitizeLearnedStylePrompt,
  scrubReplyPlaceholders,
  inquiryNeedsWebSearch,
  normalizeSamples,
  parseProductFactLookup,
  parseInquiryKnowledgeDraft,
  assessInquiryReplyGrounding,
  buildInquiryGroundingRewritePrompt,
  parseToneProfileJson,
  resolveToneSystemPrompt,
} from './prompts.js';
import { SubscriptionError, cancelUserSubscriptionAtPeriodEnd, clearPendingDowngrade, undoCancelSubscription } from './subscription.js';
import { startRenewalScheduler } from './renewal.js';
import { assertWithinLimit, getUsageSummary, recordUsage, UsageLimitError, withUserLock } from './usage.js';
import { devApiBypassEnabled, readDevApiSecret } from './dev-auth.js';
import {
  buildAuthorizeUrl,
  buildKakaoSuccessUrl,
  consumeOAuthState,
  createOAuthState,
  exchangeCodeForToken,
  fetchKakaoUser,
  getKakaoRedirectUri,
  isKakaoConfigured,
} from './kakao.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 8787;
const ADMIN_SECRET = String(process.env.ADMIN_SECRET || '').trim();
const ALLOW_REGISTRATION = String(process.env.ALLOW_REGISTRATION || 'false').toLowerCase() === 'true';
const REQUIRE_SUBSCRIPTION = String(process.env.REQUIRE_SUBSCRIPTION ?? 'true').toLowerCase() === 'true';

getDb();

const adminEmail = String(process.env.ADMIN_EMAIL || '').trim();
const adminPassword = String(process.env.ADMIN_PASSWORD || '').trim();
if (adminEmail && adminPassword) {
  const admin = ensureAdminUser(adminEmail, adminPassword, 'pro');
  if (admin) {
    console.log(`Admin ready: ${admin.email} (${admin.planId})`);
  }
}

const reviewEmail = String(process.env.TOSS_REVIEW_EMAIL || '').trim();
const reviewPassword = String(process.env.TOSS_REVIEW_PASSWORD || '').trim();
if (reviewEmail && reviewPassword) {
  try {
    const reviewUser = ensurePasswordUser(reviewEmail, reviewPassword, 'none');
    if (reviewUser) {
      console.log(`Toss review login ready: ${reviewUser.email}`);
    }
  } catch (err) {
    console.warn('Toss review user setup failed:', err.message || err);
  }
}

app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Secret');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

function authenticate(req, res, next) {
  const token = parseBearerToken(req.headers.authorization);
  const devSecret = readDevApiSecret();

  if (devSecret && token === devSecret) {
    req.auth = { mode: 'dev', unlimited: true };
    next();
    return;
  }

  const auth = getAuthFromToken(token);
  if (!auth) {
    res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
    return;
  }

  req.auth = {
    mode: 'user',
    unlimited: false,
    token,
    user: auth.user,
    usage: auth.usage,
  };
  next();
}

function requireAdmin(req, res, next) {
  const configured = String(process.env.ADMIN_SECRET || '').trim();
  const secret = String(req.headers['x-admin-secret'] || '').trim();
  if (!configured || secret !== configured) {
    res.status(403).json({ ok: false, error: '관리자 권한이 필요합니다.' });
    return;
  }
  next();
}

function sendUsageLimit(res, err) {
  res.status(429).json({
    ok: false,
    code: 'USAGE_LIMIT',
    error: err.message,
    usage: err.usage,
  });
}

function sendSubscriptionRequired(res, err) {
  res.status(402).json({
    ok: false,
    error: err.message,
    subscription: err.subscription,
  });
}

function attachClientAbort(_req, res) {
  const ac = new AbortController();
  const onClose = () => {
    if (!res.writableEnded) ac.abort();
  };
  res.on('close', onClose);
  return ac.signal;
}

function sendAiError(res, err) {
  if (res.headersSent) return;
  if (err instanceof UsageLimitError) {
    sendUsageLimit(res, err);
    return;
  }
  if (err instanceof SubscriptionError) {
    sendSubscriptionRequired(res, err);
    return;
  }
  if (err instanceof GeminiQueueFullError || err instanceof GeminiTimeoutError || err instanceof GeminiError) {
    const status = err.status === 429 ? 503 : Number(err.status) || 500;
    res.status(status >= 400 && status < 600 ? status : 500).json({
      ok: false,
      error: err.message,
      retryable: !!err.retryable,
      code: err.code || err.name,
    });
    return;
  }
  if (err?.name === 'AbortError') {
    res.status(503).json({
      ok: false,
      error: '요청이 취소되었습니다. 잠시 후 다시 시도해 주세요.',
      retryable: true,
      code: 'REQUEST_ABORTED',
    });
    return;
  }
  res.status(500).json({ ok: false, error: err.message || String(err) });
}

function isReqSubscriptionActive(req) {
  return !!req.auth.user?.subscription?.active;
}

const publicDir = path.join(__dirname, 'public');

function sendPrivacyPolicy(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.type('html');
  res.sendFile(path.join(publicDir, 'privacy.html'));
}

function sendLanding(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.type('html');
  res.sendFile(path.join(publicDir, 'index.html'));
}

app.get('/', sendLanding);

app.get(['/privacy', '/privacy/', '/privacy.html', '/legal/privacy'], sendPrivacyPolicy);

app.use(express.static(publicDir));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'naver-smartstore-reply-api',
    // 패키징 기준: 루트 manifest.json (배포/CWS 업로드 없음 — 표기 정합만)
    version: '1.3.81',
    geminiConfigured: isGeminiConfigured(),
    authEnabled: true,
    registrationOpen: ALLOW_REGISTRATION,
    kakaoLoginEnabled: isKakaoConfigured(),
    adminConfigured: !!ADMIN_SECRET,
    billing: getBillingConfig(),
    requireSubscription: REQUIRE_SUBSCRIPTION,
    freeTrial: FREE_TRIAL,
    geminiQueue: getGeminiQueueStats(),
  });
});

app.post('/api/auth/register', (req, res) => {
  if (!ALLOW_REGISTRATION) {
    res.status(403).json({ ok: false, error: '현재는 가입을 받지 않습니다. 관리자에게 문의해 주세요.' });
    return;
  }

  try {
    const user = registerUser({
      email: req.body?.email,
      password: req.body?.password,
      planId: req.body?.planId,
    });
    res.status(201).json({ ok: true, user });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const result = loginUser({
      email: req.body?.email,
      password: req.body?.password,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(401).json({ ok: false, error: err.message || String(err) });
  }
});

app.get('/api/auth/kakao/login', (req, res) => {
  if (!isKakaoConfigured()) {
    res.status(503).json({ ok: false, error: '카카오 로그인이 설정되지 않았습니다.' });
    return;
  }

  const source = req.query.source === 'extension' ? 'extension' : 'web';
  const state = createOAuthState(source);
  res.redirect(buildAuthorizeUrl(state));
});

app.get('/api/auth/kakao/callback', async (req, res) => {
  if (!isKakaoConfigured()) {
    res.redirect(buildKakaoSuccessUrl({ error: '카카오 로그인이 설정되지 않았습니다.' }));
    return;
  }

  const code = String(req.query.code || '');
  const state = String(req.query.state || '');
  const kakaoError = String(req.query.error || '');

  if (kakaoError) {
    res.redirect(buildKakaoSuccessUrl({ error: '카카오 로그인이 취소되었습니다.' }));
    return;
  }

  if (!code || !consumeOAuthState(state)) {
    res.redirect(buildKakaoSuccessUrl({ error: '로그인 요청이 만료되었거나 올바르지 않습니다.' }));
    return;
  }

  try {
    const tokenData = await exchangeCodeForToken(code);
    const profile = await fetchKakaoUser(tokenData.access_token);
    const kakaoAccount = profile.kakao_account || {};
    const result = loginWithKakao({
      kakaoId: profile.id,
      email: kakaoAccount.email || null,
      nickname: kakaoAccount.profile?.nickname || profile.properties?.nickname || null,
    });
    res.redirect(buildKakaoSuccessUrl({ token: result.token }));
  } catch (err) {
    res.redirect(buildKakaoSuccessUrl({ error: err.message || '카카오 로그인에 실패했습니다.' }));
  }
});

app.get('/api/auth/kakao/config', (_req, res) => {
  res.json({
    ok: true,
    enabled: isKakaoConfigured(),
    redirectUri: isKakaoConfigured() ? getKakaoRedirectUri() : null,
    clientSecretConfigured: !!String(process.env.KAKAO_CLIENT_SECRET || '').trim(),
  });
});

app.post('/api/auth/logout', authenticate, (req, res) => {
  if (req.auth.mode === 'user' && req.auth.token) {
    logoutUser(req.auth.token);
  }
  res.json({ ok: true });
});

app.get('/api/auth/me', authenticate, (req, res) => {
  if (req.auth.mode === 'dev') {
    res.json({
      ok: true,
      mode: 'dev',
      user: null,
      usage: null,
    });
    return;
  }

  const usage = getUsageSummary(
    req.auth.user.id,
    req.auth.user.planId,
    undefined,
    !!req.auth.user.subscription?.active
  );
  res.json({
    ok: true,
    mode: 'user',
    user: req.auth.user,
    usage,
    subscription: req.auth.user.subscription,
  });
});

app.get('/api/billing/config', (_req, res) => {
  res.json({ ok: true, ...getBillingConfig() });
});

app.get('/api/billing/history', authenticate, (req, res) => {
  if (req.auth.mode !== 'user') {
    res.status(400).json({ ok: false, error: '로그인 계정으로만 조회할 수 있습니다.' });
    return;
  }
  try {
    const history = getPaymentHistory(req.auth.user.id);
    res.json({ ok: true, history });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

app.post('/api/billing/prepare-card-update', authenticate, (req, res) => {
  if (req.auth.mode !== 'user') {
    res.status(400).json({ ok: false, error: '로그인 계정으로만 변경할 수 있습니다.' });
    return;
  }
  try {
    const cardUpdate = prepareCardUpdate(req.auth.user.id);
    res.json({ ok: true, cardUpdate });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

app.post('/api/billing/confirm-card-update', authenticate, async (req, res) => {
  if (req.auth.mode !== 'user') {
    res.status(400).json({ ok: false, error: '로그인 계정으로만 변경할 수 있습니다.' });
    return;
  }
  try {
    const result = await confirmCardUpdate(req.auth.user.id, {
      authKey: req.body?.authKey,
      customerKey: req.body?.customerKey,
    });
    res.json({
      ok: true,
      user: {
        id: result.user.id,
        email: result.user.email,
        planId: result.user.plan_id,
        plan: getPlan(result.user.plan_id),
        subscription: result.subscription,
      },
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

app.post('/api/billing/mock-card-update', authenticate, async (req, res) => {
  if (req.auth.mode !== 'user') {
    res.status(400).json({ ok: false, error: '로그인 계정으로만 변경할 수 있습니다.' });
    return;
  }
  try {
    const result = await mockConfirmCardUpdate(req.auth.user.id);
    res.json({
      ok: true,
      user: {
        id: result.user.id,
        email: result.user.email,
        planId: result.user.plan_id,
        plan: getPlan(result.user.plan_id),
        subscription: result.subscription,
      },
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

app.post('/api/billing/prepare', authenticate, (req, res) => {
  if (req.auth.mode !== 'user') {
    res.status(400).json({ ok: false, error: '로그인 계정으로만 결제할 수 있습니다.' });
    return;
  }

  try {
    const checkout = prepareCheckout(req.auth.user.id, req.body?.planId, {
      legalConsent: req.body?.legalConsent,
    });
    res.json({ ok: true, checkout });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

app.post('/api/billing/prepare-review', authenticate, (req, res) => {
  if (req.auth.mode !== 'user') {
    res.status(400).json({ ok: false, error: '로그인 계정으로만 결제할 수 있습니다.' });
    return;
  }

  try {
    const checkout = prepareReviewCheckout(req.auth.user.id, {
      mode: req.body?.mode,
      planId: req.body?.planId,
      productKey: req.body?.productKey,
      legalConsent: req.body?.legalConsent,
    });
    res.json({ ok: true, checkout });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

app.post('/api/billing/confirm', authenticate, async (req, res) => {
  if (req.auth.mode !== 'user') {
    res.status(400).json({ ok: false, error: '로그인 계정으로만 결제할 수 있습니다.' });
    return;
  }

  try {
    const result = await confirmCheckout(req.auth.user.id, {
      paymentKey: req.body?.paymentKey,
      orderId: req.body?.orderId,
      amount: req.body?.amount,
    });
    res.json({
      ok: true,
      alreadyPaid: result.alreadyPaid,
      user: result.user ? {
        id: result.user.id,
        email: result.user.email,
        planId: result.user.plan_id,
        plan: getPlan(result.user.plan_id),
        subscription: result.subscription,
      } : null,
      usage: getUsageSummary(req.auth.user.id, result.user.plan_id, undefined, true),
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

app.post('/api/billing/mock-subscribe', authenticate, async (req, res) => {
  if (req.auth.mode !== 'user') {
    res.status(400).json({ ok: false, error: '로그인 계정으로만 결제할 수 있습니다.' });
    return;
  }

  try {
    const result = await mockSubscribe(req.auth.user.id, req.body?.planId, {
      legalConsent: req.body?.legalConsent,
    });
    res.json({
      ok: true,
      scheduled: !!result.scheduled,
      checkoutType: result.checkoutType || null,
      user: {
        id: result.user.id,
        email: result.user.email,
        planId: result.user.plan_id,
        plan: getPlan(result.user.plan_id),
        subscription: result.subscription,
      },
      usage: getUsageSummary(req.auth.user.id, result.user.plan_id, undefined, true),
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

app.post('/api/billing/mock-confirm', authenticate, async (req, res) => {
  if (req.auth.mode !== 'user') {
    res.status(400).json({ ok: false, error: '로그인 계정으로만 결제할 수 있습니다.' });
    return;
  }

  try {
    const result = await mockConfirmCheckout(req.auth.user.id, req.body?.orderId);
    res.json({
      ok: true,
      user: {
        id: result.user.id,
        email: result.user.email,
        planId: result.user.plan_id,
        plan: getPlan(result.user.plan_id),
        subscription: result.subscription,
      },
      usage: getUsageSummary(req.auth.user.id, result.user.plan_id, undefined, true),
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

app.post('/api/billing/confirm-billing-auth', authenticate, async (req, res) => {
  if (req.auth.mode !== 'user') {
    res.status(400).json({ ok: false, error: '로그인 계정으로만 결제할 수 있습니다.' });
    return;
  }

  try {
    const result = await confirmBillingAuthCheckout(req.auth.user.id, {
      authKey: req.body?.authKey,
      customerKey: req.body?.customerKey,
      orderId: req.body?.orderId,
    });
    res.json({
      ok: true,
      alreadyPaid: result.alreadyPaid,
      user: result.user
        ? {
            id: result.user.id,
            email: result.user.email,
            planId: result.user.plan_id,
            plan: getPlan(result.user.plan_id),
            subscription: result.subscription,
          }
        : null,
      usage: getUsageSummary(req.auth.user.id, result.user.plan_id, undefined, true),
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

app.post('/api/billing/mock-billing-auth', authenticate, async (req, res) => {
  if (req.auth.mode !== 'user') {
    res.status(400).json({ ok: false, error: '로그인 계정으로만 결제할 수 있습니다.' });
    return;
  }

  try {
    const result = await mockConfirmBillingAuth(req.auth.user.id, req.body?.orderId);
    res.json({
      ok: true,
      user: {
        id: result.user.id,
        email: result.user.email,
        planId: result.user.plan_id,
        plan: getPlan(result.user.plan_id),
        subscription: result.subscription,
      },
      usage: getUsageSummary(req.auth.user.id, result.user.plan_id, undefined, true),
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

app.post('/api/billing/cancel-subscription', authenticate, (req, res) => {
  if (req.auth.mode !== 'user') {
    res.status(400).json({ ok: false, error: '로그인 계정으로만 구독을 취소할 수 있습니다.' });
    return;
  }

  try {
    const subscription = cancelUserSubscriptionAtPeriodEnd(req.auth.user.id);
    const user = findUserById(req.auth.user.id);
    res.json({
      ok: true,
      subscription,
      usage: getUsageSummary(user.id, user.plan_id, undefined, true),
      user: {
        id: user.id,
        email: user.email,
        planId: user.plan_id,
        plan: getPlan(user.plan_id),
        subscription,
      },
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

app.post('/api/billing/undo-cancel', authenticate, (req, res) => {
  if (req.auth.mode !== 'user') {
    res.status(400).json({ ok: false, error: '로그인 계정으로만 취소를 철회할 수 있습니다.' });
    return;
  }

  try {
    const subscription = undoCancelSubscription(req.auth.user.id);
    const user = findUserById(req.auth.user.id);
    res.json({
      ok: true,
      subscription,
      usage: getUsageSummary(user.id, user.plan_id, undefined, true),
      user: {
        id: user.id,
        email: user.email,
        planId: user.plan_id,
        plan: getPlan(user.plan_id),
        subscription,
      },
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

app.post('/api/billing/pending-plan/clear', authenticate, (req, res) => {
  if (req.auth.mode !== 'user') {
    res.status(400).json({ ok: false, error: '로그인 계정으로만 예약을 취소할 수 있습니다.' });
    return;
  }

  try {
    const subscription = clearPendingDowngrade(req.auth.user.id);
    const user = findUserById(req.auth.user.id);
    res.json({
      ok: true,
      subscription,
      usage: getUsageSummary(user.id, user.plan_id, undefined, true),
      user: {
        id: user.id,
        email: user.email,
        planId: user.plan_id,
        plan: getPlan(user.plan_id),
        subscription,
      },
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

app.patch('/api/admin/users/:id/plan', requireAdmin, (req, res) => {
  try {
    const userId = Number(req.params.id);
    const planId = normalizePlanId(req.body?.planId);
    if (!userId) {
      res.status(400).json({ ok: false, error: 'user id가 필요합니다.' });
      return;
    }
    const user = updateUserPlan(userId, planId);
    if (!user) {
      res.status(404).json({ ok: false, error: '사용자를 찾을 수 없습니다.' });
      return;
    }
    res.json({ ok: true, user: adminGetUser(user.id) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

app.get('/api/admin/status', (_req, res) => {
  res.json({
    ok: true,
    configured: !!ADMIN_SECRET,
    adminPage: '/admin.html',
  });
});

app.post('/api/analytics/event', (req, res) => {
  try {
    let userId = null;
    const token = parseBearerToken(req.headers.authorization);
    const devSecret = readDevApiSecret();
    if (token && token !== devSecret) {
      const auth = getAuthFromToken(token);
      if (auth?.user?.id) userId = auth.user.id;
    }

    const result = recordAnalyticsEvent({
      installId: req.body?.installId,
      event: req.body?.event,
      userId,
      extensionVersion: req.body?.version || req.body?.extensionVersion || null,
      meta: req.body?.meta && typeof req.body.meta === 'object' ? req.body.meta : null,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

app.get('/api/admin/users', requireAdmin, (_req, res) => {
  try {
    res.json({ ok: true, ...getAdminDashboard() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

app.get('/api/admin/users/:id', requireAdmin, (req, res) => {
  try {
    const userId = Number(req.params.id);
    const user = adminGetUser(userId);
    if (!user) {
      res.status(404).json({ ok: false, error: '사용자를 찾을 수 없습니다.' });
      return;
    }
    res.json({ ok: true, user });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

app.patch('/api/admin/users/:id/subscription', requireAdmin, (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!userId) {
      res.status(400).json({ ok: false, error: 'user id가 필요합니다.' });
      return;
    }

    const action = String(req.body?.action || 'activate').trim();
    if (action === 'deactivate') {
      const user = adminDeactivateSubscription(userId);
      res.json({ ok: true, user });
      return;
    }
    if (action === 'cancel') {
      const user = adminCancelSubscription(userId);
      res.json({ ok: true, user });
      return;
    }
    if (action === 'undo-cancel') {
      const user = adminUndoCancelSubscription(userId);
      res.json({ ok: true, user });
      return;
    }
    if (action === 'change-plan') {
      const user = adminChangePlanKeepExpiry(userId, req.body?.planId);
      res.json({ ok: true, user });
      return;
    }

    const user = adminActivateSubscription(userId, req.body?.planId, req.body?.days);
    res.json({ ok: true, user });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

app.post('/api/admin/orders/:id/refund', requireAdmin, async (req, res) => {
  try {
    const orderDbId = Number(req.params.id);
    if (!orderDbId) {
      res.status(400).json({ ok: false, error: 'order id가 필요합니다.' });
      return;
    }
    const order = await refundBillingOrder(orderDbId, {
      reason: String(req.body?.reason || '관리자 환불').slice(0, 200),
    });
    res.json({ ok: true, order: { id: order.id, status: order.status, orderId: order.order_id } });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

app.post('/api/analyze-tone', authenticate, async (req, res) => {
  const signal = attachClientAbort(req, res);
  const work = async () => {
    if (req.auth.mode === 'user') {
      assertWithinLimit(
        req.auth.user.id,
        req.auth.user.planId,
        'tone',
        undefined,
        isReqSubscriptionActive(req)
      );
    }

    const context = req.body?.context === 'inquiry' ? 'inquiry' : 'review';
    const model = req.body?.model;
    const inquiryPairs = context === 'inquiry' ? normalizeInquiryPairs(req.body?.pairs) : [];
    const normalized =
      inquiryPairs.length >= 2
        ? inquiryPairs.map((item) => item.answer)
        : normalizeSamples(req.body?.samples);

    if (normalized.length < 2) {
      const rawCount = (req.body?.samples || []).filter((s) => String(s).trim().length >= 8).length;
      if (rawCount >= 2) {
        res.status(400).json({
          ok: false,
          error:
            '선택한 답글의 앞부분이 너무 비슷해 분석 샘플이 부족합니다.\n' +
            '내용이 서로 다른 답글을 2개 이상 선택해 주세요.',
        });
        return;
      }
      res.status(400).json({ ok: false, error: '분석할 샘플 답글이 2개 이상 필요합니다.' });
      return;
    }

    const metaPrompt =
      inquiryPairs.length >= 2
        ? buildInquiryPlaybookPrompt(inquiryPairs)
        : buildAnalyzeToneV2Prompt(context, normalized);
    let raw = await generateText(metaPrompt, { model, temperature: 0.2, signal });
    let toneProfile = parseToneProfileJson(raw, context);
    if (!toneProfile) {
      const retryPrompt = `${metaPrompt}\n\n이전 출력이 올바른 JSON이 아닙니다. 스키마에 맞는 JSON 객체만 다시 출력하세요.`;
      raw = await generateText(retryPrompt, { model, temperature: 0.1, signal });
      toneProfile = parseToneProfileJson(raw, context);
    }

    const resolved = resolveToneSystemPrompt({
      toneProfile,
      previousToneProfile: req.body?.previousToneProfile || null,
      channel: context,
      parseFailed: !toneProfile,
    });

    if (!resolved.prompt || resolved.prompt.length < 30) {
      res.status(502).json({ ok: false, error: '스타일 분석 결과가 너무 짧습니다. 샘플을 더 추가해 보세요.' });
      return;
    }

    let usage;
    if (req.auth.mode === 'user') {
      recordUsage(req.auth.user.id, 'tone', context, undefined, isReqSubscriptionActive(req));
      usage = getUsageSummary(
        req.auth.user.id,
        req.auth.user.planId,
        undefined,
        isReqSubscriptionActive(req)
      );
    }

    res.json({
      ok: true,
      prompt: sanitizeLearnedStylePrompt(resolved.prompt),
      toneProfile: resolved.toneProfile,
      usedFallback: resolved.usedFallback,
      fallbackReason: resolved.fallbackReason || '',
      sampleCount: inquiryPairs.length >= 2 ? inquiryPairs.length : normalized.length,
      usage: usage || null,
    });
  };

  try {
    if (req.auth.mode === 'user') await withUserLock(req.auth.user.id, work);
    else await work();
  } catch (err) {
    sendAiError(res, err);
  }
});

function requestStoreScope(req) {
  const raw =
    req.query?.storeId ??
    req.query?.store_id ??
    req.body?.storeId ??
    req.body?.store_id;
  return { storeId: raw };
}

app.get('/api/product-knowledge', authenticate, (req, res) => {
  if (req.auth.mode !== 'user') {
    res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
    return;
  }
  res.json({ ok: true, items: listProductKnowledge(req.auth.user.id, requestStoreScope(req)) });
});

app.get('/api/product-knowledge/:productNo', authenticate, (req, res) => {
  if (req.auth.mode !== 'user') {
    res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
    return;
  }
  const item = getProductKnowledge(req.auth.user.id, req.params.productNo, requestStoreScope(req));
  if (!item) {
    res.status(404).json({ ok: false, error: '상품정보를 찾을 수 없습니다.' });
    return;
  }
  res.json({ ok: true, item });
});

app.post('/api/product-knowledge', authenticate, (req, res) => {
  if (req.auth.mode !== 'user') {
    res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
    return;
  }
  try {
    const item = upsertProductKnowledge(req.auth.user.id, {
      ...(req.body || {}),
      ...requestStoreScope(req),
    });
    res.json({ ok: true, item });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

app.put('/api/product-knowledge/:productNo', authenticate, (req, res) => {
  if (req.auth.mode !== 'user') {
    res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
    return;
  }
  try {
    const item = upsertProductKnowledge(req.auth.user.id, {
      ...(req.body || {}),
      ...requestStoreScope(req),
      productNo: req.params.productNo,
    });
    res.json({ ok: true, item });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

app.delete('/api/product-knowledge/:productNo', authenticate, (req, res) => {
  if (req.auth.mode !== 'user') {
    res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
    return;
  }
  const deleted = deleteProductKnowledge(req.auth.user.id, req.params.productNo, requestStoreScope(req));
  res.json({ ok: true, deleted });
});

app.get('/api/store-policies', authenticate, (req, res) => {
  if (req.auth.mode !== 'user') {
    res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
    return;
  }
  res.json({ ok: true, policies: getStorePolicies(req.auth.user.id, requestStoreScope(req)) });
});

app.put('/api/store-policies', authenticate, (req, res) => {
  if (req.auth.mode !== 'user') {
    res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
    return;
  }
  try {
    const policies = upsertStorePolicies(req.auth.user.id, {
      ...(req.body || {}),
      ...requestStoreScope(req),
    });
    res.json({ ok: true, policies });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

app.get('/api/commerce/oauth/status', authenticate, (req, res) => {
  if (req.auth.mode !== 'user') {
    res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
    return;
  }
  res.json({ ok: true, oauth: getCommerceOauthStatus(req.auth.user.id, requestStoreScope(req)) });
});

app.post('/api/commerce/oauth/connect', authenticate, async (req, res) => {
  if (req.auth.mode !== 'user') {
    res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
    return;
  }
  try {
    const oauth = await connectCommerceOauth(req.auth.user.id, {
      ...requestStoreScope(req),
      type: req.body?.type || 'SELF',
      accountId: req.body?.accountId,
      // Secret은 요청 처리·서버 암호 보관만. 응답에 포함하지 않음.
      clientId: req.body?.clientId,
      clientSecret: req.body?.clientSecret,
    });
    const safe = safeOauthLog(oauth);
    if (safe && typeof safe === 'object') {
      delete safe.clientSecret;
      delete safe.client_secret;
      delete safe.accessTokenEnc;
      delete safe.clientSecretEnc;
    }
    res.json({ ok: true, oauth: safe });
  } catch (err) {
    res.status(err.status && err.status < 500 ? err.status : 400).json({
      ok: false,
      error: err.message || String(err),
      code: err.code,
    });
  }
});

app.post('/api/commerce/oauth/reissue', authenticate, async (req, res) => {
  if (req.auth.mode !== 'user') {
    res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
    return;
  }
  try {
    const oauth = await reissueCommerceAccessToken(req.auth.user.id, {
      ...requestStoreScope(req),
      clientId: req.body?.clientId,
      clientSecret: req.body?.clientSecret,
    });
    res.json({ ok: true, oauth: safeOauthLog(oauth) });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err), code: err.code });
  }
});

/** 레거시 인가코드 경로 — 410으로 교체 안내 */
app.post('/api/commerce/oauth/begin', authenticate, (_req, res) => {
  res.status(410).json({
    ok: false,
    error: '인가 코드 OAuth는 제거되었습니다. POST /api/commerce/oauth/connect 를 사용하세요.',
    code: 'OAUTH_LEGACY_REMOVED',
  });
});
app.post('/api/commerce/oauth/complete', authenticate, (_req, res) => {
  res.status(410).json({
    ok: false,
    error: '인가 코드 OAuth는 제거되었습니다. POST /api/commerce/oauth/connect 를 사용하세요.',
    code: 'OAUTH_LEGACY_REMOVED',
  });
});
app.post('/api/commerce/oauth/refresh', authenticate, async (req, res) => {
  if (req.auth.mode !== 'user') {
    res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
    return;
  }
  try {
    const oauth = await reissueCommerceAccessToken(req.auth.user.id, requestStoreScope(req));
    res.json({ ok: true, oauth: safeOauthLog(oauth) });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err), code: err.code });
  }
});

app.post('/api/commerce/oauth/disconnect', authenticate, (req, res) => {
  if (req.auth.mode !== 'user') {
    res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
    return;
  }
  const oauth = disconnectCommerceOauth(req.auth.user.id, requestStoreScope(req));
  res.json({ ok: true, oauth });
});

app.post('/api/commerce/products/sync', authenticate, async (req, res) => {
  if (req.auth.mode !== 'user') {
    res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
    return;
  }
  try {
    const stats = await syncCommerceProductCatalog(req.auth.user.id, {
      ...requestStoreScope(req),
      pageSize: req.body?.pageSize,
      maxPages: req.body?.maxPages,
    });
    res.json({ ok: true, sync: stats });
  } catch (err) {
    const status =
      err instanceof CommerceApiError
        ? err.status === 429
          ? 429
          : 400
        : err.code === 'SYNC_IN_PROGRESS'
          ? 409
          : err.code === 'OAUTH_NOT_CONNECTED'
            ? 401
            : 400;
    res.status(status).json({
      ok: false,
      error: err.message || String(err),
      code: err.code,
      retryable: !!err.retryable,
    });
  }
});

app.get('/api/commerce/products/sync/status', authenticate, (req, res) => {
  if (req.auth.mode !== 'user') {
    res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
    return;
  }
  const scope = requestStoreScope(req);
  res.json({
    ok: true,
    status: getCommerceSyncStatus(req.auth.user.id, scope),
    items: listCommerceProductSync(req.auth.user.id, scope).map((row) => ({
      channelProductNo: row.channel_product_no,
      originProductNo: row.origin_product_no,
      productName: row.product_name,
      status: row.status,
      contentHash: row.content_hash,
      lastSyncedAt: row.last_synced_at,
      detailFetched: !!(row.detail_fetched_at || row.detail_content_hash),
      detailOk: row.detail_ok === 1 || row.detail_ok === true,
      detailFetchedAt: row.detail_fetched_at || null,
      detailError: row.detail_error || '',
      // raw_json / detail_raw_json / 토큰 미노출
    })),
  });
});

app.get('/api/commerce/products/catalog', authenticate, (req, res) => {
  if (req.auth.mode !== 'user') {
    res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
    return;
  }
  const catalog = getCommerceProductCatalog(req.auth.user.id, requestStoreScope(req));
  res.json({ ok: true, catalog });
});

app.post('/api/commerce/products/detail', authenticate, async (req, res) => {
  if (req.auth.mode !== 'user') {
    res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
    return;
  }
  try {
    const result = await fetchCommerceProductDetail(req.auth.user.id, {
      ...requestStoreScope(req),
      channelProductNo: req.body?.channelProductNo || req.body?.productNo,
      force: !!req.body?.force,
    });
    res.json({
      ok: true,
      detail: {
        ...result,
        knowledge: result.knowledge
          ? {
              productNo: result.knowledge.productNo,
              productName: result.knowledge.productName,
              source: result.knowledge.source,
              trustStatus: result.knowledge.trustStatus,
              fieldMeta: result.knowledge.fieldMeta,
            }
          : null,
        // sync raw / tokens 미노출
        sync: result.sync
          ? {
              channelProductNo: result.sync.channel_product_no,
              detailFetchedAt: result.sync.detail_fetched_at,
              detailOk: result.sync.detail_ok,
              detailError: result.sync.detail_error,
              status: result.sync.status,
            }
          : null,
      },
    });
  } catch (err) {
    const status =
      err instanceof CommerceApiError
        ? err.status === 429
          ? 429
          : err.status === 404
            ? 404
            : 400
        : err.code === 'DETAIL_IN_PROGRESS'
          ? 409
          : err.code === 'OAUTH_NOT_CONNECTED'
            ? 401
            : 400;
    res.status(status).json({
      ok: false,
      error: err.message || String(err),
      code: err.code,
      retryable: !!err.retryable,
    });
  }
});

app.post(
  '/api/commerce/products/:channelProductNo/fields/:field/approve',
  authenticate,
  (req, res) => {
    if (req.auth.mode !== 'user') {
      res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
      return;
    }
    try {
      const item = approveCommerceProductField(req.auth.user.id, {
        ...requestStoreScope(req),
        channelProductNo: req.params.channelProductNo,
        field: req.params.field,
        value: req.body?.value,
        useScraped: req.body?.useScraped !== false,
      });
      res.json({ ok: true, item });
    } catch (err) {
      const status = err.code === 'NOT_FOUND' ? 404 : 400;
      res.status(status).json({ ok: false, error: err.message || String(err), code: err.code });
    }
  }
);

app.post(
  '/api/commerce/products/:channelProductNo/fields/:field/reject',
  authenticate,
  (req, res) => {
    if (req.auth.mode !== 'user') {
      res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
      return;
    }
    try {
      const item = rejectCommerceProductField(req.auth.user.id, {
        ...requestStoreScope(req),
        channelProductNo: req.params.channelProductNo,
        field: req.params.field,
      });
      res.json({ ok: true, item });
    } catch (err) {
      const status = err.code === 'NOT_FOUND' ? 404 : 400;
      res.status(status).json({ ok: false, error: err.message || String(err), code: err.code });
    }
  }
);

app.get('/api/inquiry-confirmations', authenticate, (req, res) => {
  if (req.auth.mode !== 'user') {
    res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
    return;
  }
  const status = String(req.query?.status || 'needs_confirm');
  res.json({
    ok: true,
    items: listInquiryConfirmations(req.auth.user.id, {
      status,
      ...requestStoreScope(req),
    }),
  });
});

app.post('/api/inquiry-confirmations/:id/approve-fact', authenticate, (req, res) => {
  if (req.auth.mode !== 'user') {
    res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
    return;
  }
  try {
    const id = Number(req.params.id);
    const mode = req.body?.mode === 'faq_only' ? 'faq_only' : 'mirror';
    const result = approveInquiryFact(req.auth.user.id, id, {
      mode,
      field: req.body?.field || 'extra',
      value: req.body?.value,
      productNo: req.body?.productNo,
      productName: req.body?.productName,
      validFrom: req.body?.validFrom,
      validTo: req.body?.validTo,
      intentKey: req.body?.intentKey,
      knowledgeCategory: req.body?.knowledgeCategory,
      confirmPrompt: req.body?.confirmPrompt,
    });
    const sync =
      result.confirmation?.kbLink?.mode === 'mirror'
        ? checkKbLinkSync(req.auth.user.id, result.confirmation)
        : { synced: true, reason: 'faq_only' };
    res.json({
      ok: true,
      item: result.item,
      confirmation: result.confirmation,
      mode: result.mode,
      kbSync: sync,
    });
  } catch (err) {
    const code = err.code === 'NOT_FOUND' ? 404 : err.code === 'CONFLICT' ? 409 : 400;
    res.status(code).json({ ok: false, error: err.message || String(err) });
  }
});

app.post('/api/inquiry-confirmations/:id/dismiss', authenticate, (req, res) => {
  if (req.auth.mode !== 'user') {
    res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
    return;
  }
  try {
    const id = Number(req.params.id);
    const confirmation = dismissInquiryConfirmation(req.auth.user.id, id, {
      reason: req.body?.reason,
    });
    res.json({ ok: true, confirmation });
  } catch (err) {
    const code = err.code === 'NOT_FOUND' ? 404 : err.code === 'CONFLICT' ? 409 : 400;
    res.status(code).json({ ok: false, error: err.message || String(err) });
  }
});

function requireUserAuth(req, res) {
  if (req.auth.mode !== 'user') {
    res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
    return false;
  }
  return true;
}

function knowledgeErrorStatus(err) {
  if (err.code === 'NOT_FOUND') return 404;
  if (err.code === 'CONFLICT') return 409;
  if (err.code === 'BAD_ENTRY_ID' || err.code === 'BAD_FIELD' || err.code === 'BAD_REQUEST') return 400;
  if (err.code === 'INVALID_VALIDITY_RANGE') return 400;
  return 400;
}

app.post('/api/knowledge/draft-from-inquiries', authenticate, async (req, res) => {
  const signal = attachClientAbort(req, res);
  try {
    if (req.auth.mode === 'user' && !requireUserAuth(req, res)) return;

    const pairs = normalizeInquiryPairs(req.body?.pairs);
    if (pairs.length < 2) {
      res.status(400).json({
        ok: false,
        error: '답변 완료 문의/답변 페어가 2건 이상 필요합니다.',
      });
      return;
    }

    const model = req.body?.model;
    const prompt = buildInquiryKnowledgeDraftPrompt(pairs);
    let raw = await generateText(prompt, { model, temperature: 0.1, signal });
    let draft = parseInquiryKnowledgeDraft(raw);
    if (draft.parseFailed) {
      raw = await generateText(
        `${prompt}\n\n이전 출력이 올바른 JSON이 아닙니다. 스키마에 맞는 JSON 객체만 다시 출력하세요.`,
        { model, temperature: 0.05, signal }
      );
      draft = parseInquiryKnowledgeDraft(raw);
    }

    res.json({
      ok: true,
      draft: {
        products: draft.products,
        policies: draft.policies,
        warnings: draft.warnings,
      },
      sampleCount: pairs.length,
      parseFailed: !!draft.parseFailed,
    });
  } catch (err) {
    sendAiError(res, err);
  }
});

app.get('/api/knowledge/summary', authenticate, (req, res) => {
  if (!requireUserAuth(req, res)) return;
  res.json({
    ok: true,
    summary: getKnowledgeSummary(req.auth.user.id, undefined, requestStoreScope(req)),
  });
});

app.get('/api/knowledge/entries', authenticate, (req, res) => {
  if (!requireUserAuth(req, res)) return;
  const result = listKnowledgeEntries(req.auth.user.id, {
    ...(req.query || {}),
    ...requestStoreScope(req),
  });
  res.json({ ok: true, ...result });
});

function knowledgeEntryIdFromReq(req) {
  // product:123:specs 처럼 콜론 포함 — path 잔여분 또는 encode된 params
  const raw = req.params.entryId || req.params[0] || '';
  try {
    return decodeURIComponent(String(raw));
  } catch {
    return String(raw);
  }
}

app.get(/^\/api\/knowledge\/entries\/(.+)$/, authenticate, (req, res) => {
  if (!requireUserAuth(req, res)) return;
  try {
    const entry = getKnowledgeEntry(
      req.auth.user.id,
      knowledgeEntryIdFromReq(req),
      undefined,
      requestStoreScope(req)
    );
    res.json({ ok: true, entry });
  } catch (err) {
    res.status(knowledgeErrorStatus(err)).json({ ok: false, error: err.message || String(err) });
  }
});

app.patch(/^\/api\/knowledge\/entries\/(.+)$/, authenticate, (req, res) => {
  if (!requireUserAuth(req, res)) return;
  try {
    const entry = patchKnowledgeEntry(req.auth.user.id, knowledgeEntryIdFromReq(req), {
      ...(req.body || {}),
      ...requestStoreScope(req),
    });
    res.json({ ok: true, entry });
  } catch (err) {
    res.status(knowledgeErrorStatus(err)).json({ ok: false, error: err.message || String(err) });
  }
});

app.delete(/^\/api\/knowledge\/entries\/(.+)$/, authenticate, (req, res) => {
  if (!requireUserAuth(req, res)) return;
  try {
    const result = deleteKnowledgeEntry(req.auth.user.id, knowledgeEntryIdFromReq(req), {
      ...requestStoreScope(req),
      clearKbField: req.query?.clearKb === '1' || req.body?.clearKbField === true,
      reason: req.body?.reason || req.query?.reason,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(knowledgeErrorStatus(err)).json({ ok: false, error: err.message || String(err) });
  }
});

app.post('/api/generate-reply', authenticate, async (req, res) => {
  const signal = attachClientAbort(req, res);
  const work = async () => {
    if (req.auth.mode === 'user') {
      assertWithinLimit(
        req.auth.user.id,
        req.auth.user.planId,
        'reply',
        undefined,
        isReqSubscriptionActive(req)
      );
    }

    const channel = req.body?.channel === 'inquiry' ? 'inquiry' : 'review';
    const systemPrompt = String(req.body?.systemPrompt || '').trim();
    const row = req.body?.row;
    const model = req.body?.model;

    if (!systemPrompt) {
      res.status(400).json({ ok: false, error: 'systemPrompt가 필요합니다.' });
      return;
    }
    if (!row?.content) {
      res.status(400).json({ ok: false, error: 'row.content가 필요합니다.' });
      return;
    }

    let evidence = null;
    let verifiedFacts = null;
    let missingFacts = [];
    let officialSources = [];
    const wantsFactLookup = channel === 'inquiry' && inquiryNeedsWebSearch(row);

    if (channel === 'inquiry' && req.auth.mode === 'user') {
      const userId = req.auth.user.id;
      const storeScope = {
        storeId: req.body?.storeId ?? req.body?.store_id,
      };
      const match = resolveProductKnowledgeMatch({
        userId,
        productNo: row.productNo,
        productName: row.product,
        listByUser: (uid) => listProductKnowledge(uid, storeScope),
        getByProductNo: (uid, pno) => getProductKnowledge(uid, pno, storeScope),
      });
      const policies = getStorePolicies(userId, storeScope);
      let officialFacts = [];
      let officialMissing = [];

      const kbMissForFactSlots =
        match.status !== 'exact' ||
        !match.product ||
        wantsFactLookup;

      if (kbMissForFactSlots && wantsFactLookup) {
        const lookupFacts = async (targetRow) => {
          const factRaw = await generateWithSystem(
            '당신은 상품 정보 검증기입니다. 지시된 JSON만 출력하세요. 출처를 확인한 사실만 넣으세요.',
            buildProductFactLookupPrompt(targetRow, req.body?.references || []),
            { model, temperature: 0.1, googleSearch: true, signal }
          );
          return parseProductFactLookup(factRaw);
        };

        try {
          let parsed = await lookupFacts(row);
          if (!parsed.facts.length) {
            const { core } = buildProductSearchKeywords(row.product, row.content);
            if (core && core !== String(row.product || '').trim()) {
              parsed = await lookupFacts({ ...row, product: core });
            }
          }
          officialFacts = parsed.facts;
          officialMissing = parsed.missing;
          officialSources = parsed.sources || [];
        } catch (err) {
          if (err?.name === 'AbortError') throw err;
          console.warn('상품 사실 검색 실패');
          officialMissing = ['상품 정보 검색 실패'];
        }
      }

      const approvedFaqs = (
        listInquiryConfirmations(userId, {
          status: 'approved',
          limit: 100,
          ...storeScope,
        }) || []
      ).filter(Boolean);
      evidence = resolveInquiryEvidence({
        row,
        userId,
        productKnowledge: match.product,
        storePolicies: policies,
        productMatchStatus: match.status,
        productMatchReason: match.reason || '',
        officialFacts,
        officialMissing,
        officialSources,
        approvedFaqs,
      });
      verifiedFacts = formatVerifiedFactsForPrompt(evidence);
      missingFacts = evidence.missingFields || [];
    } else if (channel === 'inquiry' && wantsFactLookup) {
      // 비로그인/개발 모드는 기존 웹검색 호환 (출처 필수)
      try {
        const factRaw = await generateWithSystem(
          '당신은 상품 정보 검증기입니다. 지시된 JSON만 출력하세요. 출처를 확인한 사실만 넣으세요.',
          buildProductFactLookupPrompt(row, req.body?.references || []),
          { model, temperature: 0.1, googleSearch: true, signal }
        );
        const parsed = parseProductFactLookup(factRaw);
        verifiedFacts = parsed.facts;
        missingFacts = parsed.missing;
        officialSources = parsed.sources || [];
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        verifiedFacts = [];
        missingFacts = ['상품 정보 검색 실패'];
      }
    }

    const useFacts = channel === 'inquiry' && verifiedFacts != null;
    const judgment = evidence?.judgment || null;
    const userContent =
      channel === 'inquiry'
        ? buildInquiryUserContent(row, req.body?.references || [], {
            webSearch: false,
            verifiedFacts: useFacts ? verifiedFacts : null,
            missingFacts: useFacts ? missingFacts : [],
            judgment,
            usedKnowledge: evidence?.usedKnowledge || [],
          })
        : buildReviewUserContent(row);

    let text = await generateWithSystem(appendReplyHardRules(systemPrompt, row), userContent, {
      model,
      temperature: useFacts ? 0.3 : 0.35,
      googleSearch: false,
      signal,
    });

    let confirmation = null;
    if (channel === 'inquiry') {
      const refs = req.body?.references || [];
      const facts = useFacts ? verifiedFacts || [] : [];
      const guidelines = systemPrompt;
      let grounding = assessInquiryReplyGrounding(row, text, refs, facts, guidelines);
      if (!grounding.grounded) {
        try {
          text = await generateWithSystem(
            '당신은 판매자 답글 교정기입니다. 근거에 없는 구체 사실을 삭제하고 수정된 답글 본문만 출력하세요.',
            buildInquiryGroundingRewritePrompt(row, text, refs, facts, guidelines),
            { model, temperature: 0.15, googleSearch: false, signal }
          );
        } catch (err) {
          if (err?.name === 'AbortError') throw err;
          text = '';
        }
        grounding = assessInquiryReplyGrounding(row, text, refs, facts, guidelines);
        if (!grounding.grounded) text = '';
      }

      if (evidence?.needsSellerConfirm && req.auth.mode === 'user') {
        // REALTIME_REQUIRED: 공식 조회 없이 단정 답 금지 → 확인 초안 고정
        if (!text || evidence.judgment === 'REALTIME_REQUIRED') {
          text = buildSellerConfirmDraft(row, evidence);
        }
        confirmation = createInquiryConfirmation(req.auth.user.id, {
          inquiryKey: String(row.id || row.inquiryId || '').slice(0, 120),
          productNo: row.productNo || '',
          productName: row.product || '',
          question: row.content || '',
          missingFields: (evidence.missingFields || []).join(', '),
          reason: evidence.confirmReason || '',
          draftReply: text,
          evidenceJson: JSON.stringify({
            slots: evidence.slots,
            sources: evidence.sources,
            judgment: evidence.judgment,
            usedKnowledge: evidence.usedKnowledge,
          }),
        });
      }
    }

    if (text) text = scrubReplyPlaceholders(text);
    text = String(text || '').trim();
    if (!text) {
      res.status(502).json({
        ok: false,
        error: '답글을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.',
        retryable: true,
        code: 'EMPTY_REPLY',
      });
      return;
    }

    let usage;
    if (req.auth.mode === 'user') {
      recordUsage(req.auth.user.id, 'reply', channel, undefined, isReqSubscriptionActive(req));
      markUserInstallGenerated(req.auth.user.id, { channel, touchLastSeen: true });
      usage = getUsageSummary(
        req.auth.user.id,
        req.auth.user.planId,
        undefined,
        isReqSubscriptionActive(req)
      );
    }

    res.json({
      ok: true,
      text,
      usage: usage || null,
      evidence: evidence
        ? {
            needsSellerConfirm: evidence.needsSellerConfirm,
            missingFields: evidence.missingFields,
            confirmReason: evidence.confirmReason,
            slots: evidence.slots,
            sources: evidence.sources,
            verifiedFacts: evidence.verifiedFacts,
            judgment: evidence.judgment || null,
            realtimeRequired: !!evidence.realtimeRequired,
            faqConflict: !!evidence.faqConflict,
          }
        : null,
      judgment: evidence?.judgment || null,
      usedKnowledge: evidence?.usedKnowledge || [],
      confirmation,
      needsConfirm: !!(evidence && evidence.needsSellerConfirm),
    });
  };

  try {
    if (req.auth.mode === 'user') await withUserLock(req.auth.user.id, work);
    else await work();
  } catch (err) {
    sendAiError(res, err);
  }
});

app.use((_req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' });
});

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return path.normalize(fileURLToPath(import.meta.url)) === path.normalize(path.resolve(entry));
  } catch (_) {
    return false;
  }
}

if (isDirectRun()) {
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Reply API listening on port ${PORT}`);
  if (!String(process.env.GEMINI_API_KEY || '').trim()) {
    console.warn('WARN: GEMINI_API_KEY is not set');
  }
  if (devApiBypassEnabled()) {
    console.log('DEV_API_SECRET enabled (development only)');
  } else if (String(process.env.DEV_API_SECRET || '').trim()) {
    console.log('DEV_API_SECRET ignored');
  } else {
    console.log('User login required for AI endpoints');
  }
  const billing = getBillingConfig();
  logBillingStartupWarnings();
  if (billing.mockMode) {
    console.log('BILLING_MOCK enabled (test payments without Toss)');
  }
  if (String(process.env.RENEWAL_ENABLED || 'true').toLowerCase() !== 'false') {
    startRenewalScheduler();
  }
  console.log(
    `Free trial: ${FREE_TRIAL.replyLimit} replies + ${FREE_TRIAL.toneLimit} tone / account (lifetime)`
  );
  if (isKakaoConfigured()) {
    console.log(`Kakao login enabled (redirect: ${getKakaoRedirectUri()})`);
  }
  if (ADMIN_SECRET) {
    console.log('Admin page: /admin.html');
  }
});
}

export { app };
