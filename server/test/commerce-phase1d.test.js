import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, afterEach, test } from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commerce-1d-'));
process.env.DATA_DIR = tempDir;
process.env.DB_PATH = path.join(tempDir, 'app.db');
process.env.COMMERCE_OAUTH_MOCK = 'true';
process.env.COMMERCE_TOKEN_SECRET = 'phase1d-test-token-secret-key';
process.env.COMMERCE_CLIENT_ID = 'aaaabbbbcccc';
process.env.COMMERCE_CLIENT_SECRET = '$2a$10$abcdefghijklmnopqrstuv';
process.env.COMMERCE_API_MAX_RETRIES = '2';
process.env.COMMERCE_SYNC_STALE_MS = '1000';

const { closeDbForTests, createUser, upsertCommerceSyncRun, getCommerceSyncRun } =
  await import('../db.js');
const {
  generateCommerceClientSecretSign,
  buildCommerceTokenRequestParams,
  assertNoPlainClientSecretInTokenBody,
  connectCommerceOauth,
  reissueCommerceAccessToken,
  getValidAccessToken,
  setCommerceOauthTransportForTests,
  beginCommerceOauth,
} = await import('../commerce-oauth.js');
const {
  setCommerceApiTransportForTests,
  searchCommerceProducts,
  getCommerceChannelProduct,
  resolveCommerceRedirectUrl,
  DEFAULT_PRODUCT_STATUS_TYPES,
  CommerceApiError,
} = await import('../commerce-api.js');
const {
  tryAcquireCommerceLease,
  releaseCommerceLease,
  recoverStaleCommerceSyncRuns,
  isCommerceLeaseHeld,
} = await import('../commerce-lease.js');
const { syncCommerceProductCatalog, getCommerceSyncStatus } = await import('../commerce-sync.js');

let userA;

before(() => {
  userA = createUser(`c1d-${Date.now()}@example.com`, 'hash');
});

afterEach(() => {
  setCommerceOauthTransportForTests(null);
  setCommerceApiTransportForTests(null);
});

after(() => {
  closeDbForTests();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('1D-1: 공식 OAuth 서명 생성 (문서 Node 예시 고정값)', () => {
  const sign = generateCommerceClientSecretSign(
    'aaaabbbbcccc',
    '$2a$10$abcdefghijklmnopqrstuv',
    1643961623299
  );
  assert.equal(
    sign,
    'JDJhJDEwJGFiY2RlZmdoaWprbG1ub3BxcnN0dXVCVldZSk42T0VPdEx1OFY0cDQxa2IuTnpVaUEzbmsy'
  );
});

test('1D-2: 잘못된 서명 입력·필수 필드 누락', () => {
  assert.throws(() => generateCommerceClientSecretSign('', 'salt', 1), (e) => e.code === 'OAUTH_CLIENT_ID_REQUIRED');
  assert.throws(() => generateCommerceClientSecretSign('id', '', 1), (e) => e.code === 'OAUTH_CLIENT_SECRET_REQUIRED');
  assert.throws(() => generateCommerceClientSecretSign('id', 'salt', 'x'), (e) => e.code === 'OAUTH_TIMESTAMP_REQUIRED');
  assert.throws(
    () =>
      buildCommerceTokenRequestParams({
        clientId: 'id',
        clientSecret: '$2a$10$abcdefghijklmnopqrstuv',
        type: 'SELLER',
        accountId: '',
      }),
    (e) => e.code === 'OAUTH_ACCOUNT_ID_REQUIRED'
  );
});

test('1D-3: SELF 인증 요청 구조 (account_id 미포함, grant_type=client_credentials)', () => {
  const params = buildCommerceTokenRequestParams({
    clientId: 'aaaabbbbcccc',
    clientSecret: '$2a$10$abcdefghijklmnopqrstuv',
    timestamp: 1643961623299,
    type: 'SELF',
  });
  const body = params.toString();
  assert.match(body, /grant_type=client_credentials/);
  assert.match(body, /type=SELF/);
  assert.match(body, /client_secret_sign=/);
  assert.match(body, /timestamp=1643961623299/);
  assert.equal(body.includes('account_id'), false);
  assert.equal(/(?:^|&)client_secret=/.test(body), false);
});

test('1D-4: client_secret 평문 전송 방지', () => {
  const secret = '$2a$10$abcdefghijklmnopqrstuv';
  const params = buildCommerceTokenRequestParams({
    clientId: 'aaaabbbbcccc',
    clientSecret: secret,
    timestamp: 1643961623299,
    type: 'SELF',
  });
  assert.doesNotThrow(() => assertNoPlainClientSecretInTokenBody(params.toString(), secret));
  assert.throws(() => assertNoPlainClientSecretInTokenBody(`client_secret=${encodeURIComponent(secret)}`, secret));
});

test('1D-5: 토큰 만료 시 client_credentials 재발급', async () => {
  let calls = 0;
  setCommerceOauthTransportForTests(async (_url, opts) => {
    calls += 1;
    const body = String(opts.body || '');
    assert.match(body, /grant_type=client_credentials/);
    assert.equal(body.includes('refresh_token'), false);
    assert.equal(/(?:^|&)client_secret=/.test(body), false);
    return {
      ok: true,
      status: 200,
      data: {
        access_token: calls === 1 ? 'tok-old' : 'tok-new',
        expires_in: calls === 1 ? 1 : 3600,
        token_type: 'Bearer',
      },
    };
  });
  await connectCommerceOauth(userA.id, { storeId: 'store-d' });
  assert.equal(await getValidAccessToken(userA.id, { storeId: 'store-d', skewMs: 0 }), 'tok-old');
  await reissueCommerceAccessToken(userA.id, { storeId: 'store-d' });
  assert.equal(await getValidAccessToken(userA.id, { storeId: 'store-d', skewMs: 0 }), 'tok-new');
  assert.equal(calls, 2);
});

test('1D-6: 401 GW.AUTHN 재발급 후 재시도', async () => {
  setCommerceOauthTransportForTests(async () => ({
    ok: true,
    status: 200,
    data: { access_token: 'tok-authn', expires_in: 3600 },
  }));
  await connectCommerceOauth(userA.id, { storeId: 'store-authn' });

  let apiCalls = 0;
  let tokenCalls = 0;
  setCommerceOauthTransportForTests(async () => {
    tokenCalls += 1;
    return { ok: true, status: 200, data: { access_token: 'tok-refreshed', expires_in: 3600 } };
  });
  setCommerceApiTransportForTests(async (_url, opts) => {
    apiCalls += 1;
    const auth = opts.headers?.Authorization || '';
    if (apiCalls === 1) {
      return { ok: false, status: 401, data: { code: 'GW.AUTHN', message: '권한 없음' } };
    }
    assert.match(auth, /tok-refreshed/);
    return {
      ok: true,
      status: 200,
      data: { contents: [{ channelProductNo: 1, name: 'a', statusType: 'SALE' }], totalElements: 1 },
    };
  });

  const result = await searchCommerceProducts({
    accessToken: 'tok-authn',
    userId: userA.id,
    storeId: 'store-authn',
  });
  assert.equal(result.contents.length, 1);
  assert.equal(apiCalls, 2);
  assert.equal(tokenCalls, 1);
});

test('1D-7: 다중 프로세스형 DB lease 중복 차단', () => {
  const a = tryAcquireCommerceLease({
    jobType: 'catalog',
    userId: userA.id,
    storeId: 'lease-a',
    ttlMs: 60_000,
  });
  assert.equal(a.ok, true);
  const b = tryAcquireCommerceLease({
    jobType: 'catalog',
    userId: userA.id,
    storeId: 'lease-a',
    ttlMs: 60_000,
  });
  assert.equal(b.ok, false);
  assert.equal(b.code, 'LEASE_HELD');
  assert.equal(isCommerceLeaseHeld('catalog', userA.id, 'lease-a'), true);
  releaseCommerceLease(a.leaseKey, a.ownerToken);
  const c = tryAcquireCommerceLease({
    jobType: 'catalog',
    userId: userA.id,
    storeId: 'lease-a',
  });
  assert.equal(c.ok, true);
  releaseCommerceLease(c.leaseKey, c.ownerToken);
});

test('1D-8: stale running 복구 (유효 lease 없으면 idle)', () => {
  upsertCommerceSyncRun(userA.id, {
    storeId: 'stale-a',
    status: 'running',
    pages: 1,
    products: 0,
    startedAt: '2000-01-01 00:00:00',
    finishedAt: null,
    lastError: '',
  });
  const { recovered } = recoverStaleCommerceSyncRuns({
    userId: userA.id,
    storeId: 'stale-a',
    staleMs: 1000,
  });
  assert.ok(recovered >= 1);
  const run = getCommerceSyncRun(userA.id, { storeId: 'stale-a' });
  assert.equal(run.status, 'idle');

  // 유효 lease 보유 중이면 복구하지 않음
  const lease = tryAcquireCommerceLease({
    jobType: 'catalog',
    userId: userA.id,
    storeId: 'stale-b',
    ttlMs: 120_000,
  });
  upsertCommerceSyncRun(userA.id, {
    storeId: 'stale-b',
    status: 'running',
    pages: 0,
    products: 0,
    startedAt: '2000-01-01 00:00:00',
    finishedAt: null,
    lastError: '',
  });
  const r2 = recoverStaleCommerceSyncRuns({ userId: userA.id, storeId: 'stale-b', staleMs: 1000 });
  assert.equal(r2.recovered, 0);
  assert.equal(getCommerceSyncRun(userA.id, { storeId: 'stale-b' }).status, 'running');
  releaseCommerceLease(lease.leaseKey, lease.ownerToken);
});

test('1D-9: SALE/OUTOFSTOCK 기본 필터 · 품절 삭제 없음', async () => {
  setCommerceOauthTransportForTests(async () => ({
    ok: true,
    status: 200,
    data: { access_token: 'tok-stock', expires_in: 3600 },
  }));
  await connectCommerceOauth(userA.id, { storeId: 'store-stock' });

  let seenBody;
  setCommerceApiTransportForTests(async (_url, opts) => {
    seenBody = JSON.parse(opts.body);
    return {
      ok: true,
      status: 200,
      data: {
        contents: [
          { channelProductNo: 501, name: '판매', statusType: 'SALE' },
          { channelProductNo: 502, name: '품절', statusType: 'OUTOFSTOCK' },
        ],
        totalElements: 2,
      },
    };
  });
  assert.deepEqual([...DEFAULT_PRODUCT_STATUS_TYPES], ['SALE', 'OUTOFSTOCK']);
  const stats = await syncCommerceProductCatalog(userA.id, { storeId: 'store-stock', pageSize: 50 });
  assert.deepEqual(seenBody.productStatusTypes, ['SALE', 'OUTOFSTOCK']);
  assert.equal(stats.products, 2);
  const status = getCommerceSyncStatus(userA.id, { storeId: 'store-stock' });
  assert.equal(status.catalogCount, 2);
});

test('1D-10: 308 리다이렉트 처리·호스트 검증·루프 방지', async () => {
  const visited = new Set();
  const next = resolveCommerceRedirectUrl(
    'https://api.commerce.naver.com/external/v2/products/channel-products/1',
    'https://api.commerce.naver.com/external/v2/products/channel-products/2',
    { visited }
  );
  assert.match(next, /channel-products\/2$/);

  assert.throws(
    () =>
      resolveCommerceRedirectUrl(
        'https://api.commerce.naver.com/external/v2/products/channel-products/1',
        'https://evil.example/x',
        { visited: new Set() }
      ),
    (e) => e.code === 'COMMERCE_REDIRECT_HOST'
  );

  setCommerceOauthTransportForTests(async () => ({
    ok: true,
    status: 200,
    data: { access_token: 'tok-308', expires_in: 3600 },
  }));
  await connectCommerceOauth(userA.id, { storeId: 'store-308' });

  let hits = 0;
  setCommerceApiTransportForTests(async (url) => {
    hits += 1;
    if (String(url).endsWith('/111')) {
      return {
        ok: false,
        status: 308,
        data: {},
        headers: {
          get: (k) =>
            String(k).toLowerCase() === 'location'
              ? 'https://api.commerce.naver.com/external/v2/products/channel-products/222'
              : null,
        },
      };
    }
    return {
      ok: true,
      status: 200,
      data: { channelProductNo: 222, originProduct: { name: '리다이렉트상품' } },
    };
  });
  const detail = await getCommerceChannelProduct({
    accessToken: 'tok-308',
    channelProductNo: '111',
    userId: userA.id,
    storeId: 'store-308',
  });
  assert.equal(detail.productName, '리다이렉트상품');
  assert.equal(hits, 2);
});

test('1D-11: 레거시 authorization_code begin 제거', () => {
  assert.throws(() => beginCommerceOauth(), (e) => e.code === 'OAUTH_LEGACY_REMOVED');
});
