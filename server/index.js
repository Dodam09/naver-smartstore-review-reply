import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ensureAdminUser,
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
  refundBillingOrder,
} from './billing.js';
import {
  adminActivateSubscription,
  adminCancelSubscription,
  adminChangePlanKeepExpiry,
  adminDeactivateSubscription,
  adminGetUser,
  adminUndoCancelSubscription,
  getAdminDashboard,
} from './admin.js';
import { getDb, findUserById, updateUserPlan } from './db.js';
import { generateText, generateWithSystem } from './gemini.js';
import { getPlan, normalizePlanId } from './plans.js';
import {
  buildAnalyzeMetaPrompt,
  buildInquiryUserContent,
  buildProductFactLookupPrompt,
  buildProductSearchKeywords,
  buildReviewUserContent,
  inquiryNeedsWebSearch,
  normalizeSamples,
  parseProductFactLookup,
} from './prompts.js';
import { assertSubscriptionActive, SubscriptionError, cancelUserSubscriptionAtPeriodEnd, undoCancelSubscription } from './subscription.js';
import { startRenewalScheduler } from './renewal.js';
import { assertWithinLimit, getUsageSummary, recordUsage, UsageLimitError } from './usage.js';
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
const DEV_SECRET = String(process.env.DEV_API_SECRET || '').trim();
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

app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Secret');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

function authenticate(req, res, next) {
  const token = parseBearerToken(req.headers.authorization);

  if (DEV_SECRET && token === DEV_SECRET) {
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
  const secret = String(req.headers['x-admin-secret'] || '').trim();
  if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
    res.status(403).json({ ok: false, error: '관리자 권한이 필요합니다.' });
    return;
  }
  next();
}

function sendUsageLimit(res, err) {
  res.status(429).json({
    ok: false,
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

function assertUserCanUseAi(req) {
  if (req.auth.mode !== 'user') return;
  if (REQUIRE_SUBSCRIPTION) {
    assertSubscriptionActive(req.auth.user.id);
  }
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'naver-smartstore-reply-api',
    version: '1.3.43',
    geminiConfigured: !!String(process.env.GEMINI_API_KEY || '').trim(),
    authEnabled: true,
    registrationOpen: ALLOW_REGISTRATION,
    kakaoLoginEnabled: isKakaoConfigured(),
    adminConfigured: !!ADMIN_SECRET,
    billing: getBillingConfig(),
    requireSubscription: REQUIRE_SUBSCRIPTION,
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
  try {
    if (req.auth.mode === 'user') {
      assertUserCanUseAi(req);
      assertWithinLimit(req.auth.user.id, req.auth.user.planId, 'tone');
    }

    const context = req.body?.context === 'inquiry' ? 'inquiry' : 'review';
    const model = req.body?.model;
    const normalized = normalizeSamples(req.body?.samples);

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

    const metaPrompt = buildAnalyzeMetaPrompt(context, normalized);
    const prompt = await generateText(metaPrompt, { model, temperature: 0.35 });

    if (!prompt || prompt.length < 30) {
      res.status(502).json({ ok: false, error: '스타일 분석 결과가 너무 짧습니다. 샘플을 더 추가해 보세요.' });
      return;
    }

    let usage;
    if (req.auth.mode === 'user') {
      recordUsage(req.auth.user.id, 'tone', context);
      usage = getUsageSummary(req.auth.user.id, req.auth.user.planId, undefined, !!req.auth.user.subscription?.active);
    }

    res.json({ ok: true, prompt: prompt.trim(), sampleCount: normalized.length, usage: usage || null });
  } catch (err) {
    if (err instanceof UsageLimitError) {
      sendUsageLimit(res, err);
      return;
    }
    if (err instanceof SubscriptionError) {
      sendSubscriptionRequired(res, err);
      return;
    }
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

app.post('/api/generate-reply', authenticate, async (req, res) => {
  try {
    if (req.auth.mode === 'user') {
      assertUserCanUseAi(req);
      assertWithinLimit(req.auth.user.id, req.auth.user.planId, 'reply');
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

    const webSearch = channel === 'inquiry' && inquiryNeedsWebSearch(row);
    let verifiedFacts = null;
    let missingFacts = [];

    if (webSearch) {
      const lookupFacts = async (targetRow) => {
        const factRaw = await generateWithSystem(
          '당신은 상품 정보 검증기입니다. 지시된 JSON만 출력하세요.',
          buildProductFactLookupPrompt(targetRow, req.body?.references || []),
          { model, temperature: 0.1, googleSearch: true }
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

        verifiedFacts = parsed.facts;
        missingFacts = parsed.missing;
      } catch (err) {
        console.warn('상품 사실 검색 실패:', err.message || err);
        verifiedFacts = [];
        missingFacts = ['상품 정보 검색 실패'];
      }
    }

    const userContent =
      channel === 'inquiry'
        ? buildInquiryUserContent(row, req.body?.references || [], {
            webSearch: false,
            verifiedFacts: webSearch ? verifiedFacts : null,
            missingFacts: webSearch ? missingFacts : [],
          })
        : buildReviewUserContent(row);

    const text = await generateWithSystem(systemPrompt, userContent, {
      model,
      temperature: webSearch ? 0.35 : 0.7,
      googleSearch: false,
    });

    let usage;
    if (req.auth.mode === 'user') {
      recordUsage(req.auth.user.id, 'reply', channel);
      usage = getUsageSummary(req.auth.user.id, req.auth.user.planId, undefined, !!req.auth.user.subscription?.active);
    }

    res.json({ ok: true, text, usage: usage || null });
  } catch (err) {
    if (err instanceof UsageLimitError) {
      sendUsageLimit(res, err);
      return;
    }
    if (err instanceof SubscriptionError) {
      sendSubscriptionRequired(res, err);
      return;
    }
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

app.use((_req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Reply API listening on port ${PORT}`);
  if (!String(process.env.GEMINI_API_KEY || '').trim()) {
    console.warn('WARN: GEMINI_API_KEY is not set');
  }
  if (DEV_SECRET) {
    console.log('DEV_API_SECRET enabled (local dev bypass)');
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
  if (REQUIRE_SUBSCRIPTION) {
    console.log('REQUIRE_SUBSCRIPTION enabled (paid subscription required for AI)');
  }
  if (isKakaoConfigured()) {
    console.log(`Kakao login enabled (redirect: ${getKakaoRedirectUri()})`);
  }
  if (ADMIN_SECRET) {
    console.log('Admin page: /admin.html');
  }
});
