import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, afterEach, test } from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commerce-1a-'));
process.env.DATA_DIR = tempDir;
process.env.DB_PATH = path.join(tempDir, 'app.db');
process.env.COMMERCE_OAUTH_MOCK = 'true';
process.env.COMMERCE_TOKEN_SECRET = 'phase1a-test-token-secret-key';
process.env.COMMERCE_CLIENT_ID = 'test-client-id';
process.env.COMMERCE_CLIENT_SECRET = '$2a$10$abcdefghijklmnopqrstuv';

const { closeDbForTests, createUser, getProductKnowledge, upsertProductKnowledge } =
  await import('../db.js');
const {
  connectCommerceOauth,
  disconnectCommerceOauth,
  getCommerceOauthStatus,
  reissueCommerceAccessToken,
  setCommerceOauthTransportForTests,
  getValidAccessToken,
  beginCommerceOauth,
} = await import('../commerce-oauth.js');
const { setCommerceApiTransportForTests, CommerceApiError } = await import('../commerce-api.js');
const { syncCommerceProductCatalog, getCommerceSyncStatus, isCommerceSyncRunning } =
  await import('../commerce-sync.js');
const { encryptSecret, decryptSecret, redactSecrets, assertNoSecretsInText } =
  await import('../commerce-crypto.js');
const { fieldCanUseAsFact } = await import('../knowledge-meta.js');

let userA;
let userB;

async function mockConnect(userId, storeId, accessToken = `tok-${storeId}`) {
  setCommerceOauthTransportForTests(async (_url, opts) => {
    const body = String(opts.body || '');
    assert.match(body, /grant_type=client_credentials/);
    assert.equal(/(?:^|&)client_secret=/.test(body), false);
    return {
      ok: true,
      status: 200,
      data: { access_token: accessToken, expires_in: 3600, token_type: 'Bearer' },
    };
  });
  return connectCommerceOauth(userId, { storeId });
}

before(() => {
  userA = createUser(`c1a-${Date.now()}@example.com`, 'hash');
  userB = createUser(`c1b-${Date.now()}@example.com`, 'hash');
});

afterEach(() => {
  setCommerceOauthTransportForTests(null);
  setCommerceApiTransportForTests(null);
});

after(() => {
  closeDbForTests();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('1A-1: client_credentials 연결 성공 / 레거시 begin 제거 / 토큰 미노출', async () => {
  assert.throws(() => beginCommerceOauth(), (e) => e.code === 'OAUTH_LEGACY_REMOVED');
  const ok = await mockConnect(userA.id, 'store-a', 'access-token-aaa');
  assert.equal(ok.status, 'connected');
  assert.equal(ok.connected, true);
  assert.equal(ok.hasAccessToken, true);
  const json = JSON.stringify(ok);
  assert.equal(json.includes('access-token-aaa'), false);
});

test('1A-2: 토큰 만료 시 재발급', async () => {
  let calls = 0;
  setCommerceOauthTransportForTests(async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      data: {
        access_token: calls === 1 ? 'access-old' : 'access-new',
        expires_in: calls === 1 ? 1 : 3600,
      },
    };
  });
  await connectCommerceOauth(userA.id, { storeId: 'store-refresh' });
  await reissueCommerceAccessToken(userA.id, { storeId: 'store-refresh' });
  const token = await getValidAccessToken(userA.id, { storeId: 'store-refresh', skewMs: 0 });
  assert.equal(token, 'access-new');
  assert.equal(calls, 2);
});

test('1A-3: 토큰 암호화 및 로그 노출 방지', () => {
  const enc = encryptSecret('super-secret-token-value');
  assert.notEqual(enc, 'super-secret-token-value');
  assert.equal(decryptSecret(enc), 'super-secret-token-value');
  const redacted = redactSecrets({
    access_token: 'plain',
    nested: { refresh_token: 'r' },
    ok: true,
  });
  assert.equal(redacted.access_token, '[redacted]');
  assert.equal(redacted.nested.refresh_token, '[redacted]');
  assert.doesNotThrow(() => assertNoSecretsInText(JSON.stringify({ status: 'connected' })));
  assert.throws(() => assertNoSecretsInText('access_token: "abc123"'));
});

test('1A-4: user/store 교차 접근 차단', async () => {
  await mockConnect(userA.id, 'store-a', 'tok-a');
  assert.equal(getCommerceOauthStatus(userB.id, { storeId: 'store-a' }).connected, false);
  assert.equal(getCommerceOauthStatus(userA.id, { storeId: 'store-b' }).connected, false);
  await assert.rejects(() => getValidAccessToken(userB.id, { storeId: 'store-a' }), (e) =>
    e.code === 'OAUTH_NOT_CONNECTED'
  );
});

test('1A-5: 상품 목록 페이지네이션', async () => {
  const pages = [];
  setCommerceApiTransportForTests(async (_url, opts) => {
    const body = JSON.parse(opts.body);
    pages.push(body.page);
    if (body.page === 1) {
      return {
        ok: true,
        status: 200,
        data: {
          contents: Array.from({ length: 2 }, (_, i) => ({
            channelProductNo: 1000 + i,
            name: `P${i}`,
            statusType: 'SALE',
          })),
          totalPages: 2,
          totalElements: 3,
        },
      };
    }
    return {
      ok: true,
      status: 200,
      data: {
        contents: [{ channelProductNo: 1002, name: 'P2', statusType: 'SALE' }],
        totalPages: 2,
        totalElements: 3,
      },
    };
  });
  await mockConnect(userA.id, 'store-page', 'tok-page');
  const stats = await syncCommerceProductCatalog(userA.id, {
    storeId: 'store-page',
    pageSize: 2,
    maxPages: 10,
  });
  assert.deepEqual(pages, [1, 2]);
  assert.equal(stats.pages, 2);
  assert.equal(getCommerceSyncStatus(userA.id, { storeId: 'store-page' }).catalogCount, 3);
});

test('1A-6: 429 재시도 후 성공', async () => {
  let calls = 0;
  setCommerceApiTransportForTests(async () => {
    calls += 1;
    if (calls === 1) {
      return { ok: false, status: 429, data: { code: 'GW.RATE_LIMIT' }, headers: { 'retry-after': '0' } };
    }
    return {
      ok: true,
      status: 200,
      data: { contents: [{ channelProductNo: 1, name: 'x', statusType: 'SALE' }] },
    };
  });
  await mockConnect(userA.id, 'store-429', 'tok-429');
  const stats = await syncCommerceProductCatalog(userA.id, { storeId: 'store-429' });
  assert.equal(stats.products, 1);
  assert.equal(calls, 2);
});

test('1A-6b: 429 소진 시 오류', async () => {
  process.env.COMMERCE_API_MAX_RETRIES = '0';
  setCommerceApiTransportForTests(async () => ({
    ok: false,
    status: 429,
    data: { code: 'GW.RATE_LIMIT' },
    headers: { 'retry-after': '0' },
  }));
  await mockConnect(userA.id, 'store-429b', 'tok');
  await assert.rejects(
    () => syncCommerceProductCatalog(userA.id, { storeId: 'store-429b' }),
    (e) => e instanceof CommerceApiError && e.status === 429
  );
  delete process.env.COMMERCE_API_MAX_RETRIES;
});

test('1A-7: 중복 동기화 방지 + content_hash skip', async () => {
  setCommerceApiTransportForTests(async () => ({
    ok: true,
    status: 200,
    data: {
      contents: [{ channelProductNo: 77, name: 'dup', statusType: 'SALE' }],
    },
  }));
  await mockConnect(userA.id, 'store-dup', 'tok-dup');
  await syncCommerceProductCatalog(userA.id, { storeId: 'store-dup' });
  const second = await syncCommerceProductCatalog(userA.id, { storeId: 'store-dup' });
  assert.ok(second.skipped >= 1);

  // lease 중복
  setCommerceApiTransportForTests(async () => {
    await new Promise((r) => setTimeout(r, 80));
    return { ok: true, status: 200, data: { contents: [] } };
  });
  const p1 = syncCommerceProductCatalog(userA.id, { storeId: 'store-dup' });
  await new Promise((r) => setTimeout(r, 10));
  await assert.rejects(
    () => syncCommerceProductCatalog(userA.id, { storeId: 'store-dup' }),
    (e) => e.code === 'SYNC_IN_PROGRESS'
  );
  await p1;
  assert.equal(isCommerceSyncRunning(userA.id, 'store-dup'), false);
});

test('1A-8: 승인 지식 불변 (목록 sync)', async () => {
  upsertProductKnowledge(userA.id, {
    storeId: 'store-guard',
    productNo: '88',
    productName: '승인이름',
    specs: '승인스펙',
    source: 'seller_approved',
    fieldMeta: {
      product_name: { source: 'SELLER_APPROVED', trustStatus: 'approved' },
      specs: { source: 'SELLER_APPROVED', trustStatus: 'approved' },
    },
  });
  setCommerceApiTransportForTests(async () => ({
    ok: true,
    status: 200,
    data: {
      contents: [{ channelProductNo: 88, name: '수집이름', statusType: 'SALE' }],
    },
  }));
  await mockConnect(userA.id, 'store-guard', 'tok-g');
  await syncCommerceProductCatalog(userA.id, { storeId: 'store-guard' });
  const kb = getProductKnowledge(userA.id, '88', { storeId: 'store-guard' });
  assert.equal(kb.productName, '승인이름');
  assert.equal(kb.specs, '승인스펙');
  assert.equal(fieldCanUseAsFact(kb, 'specs'), true);
  assert.equal(fieldCanUseAsFact(kb, 'product_name'), false);
});

test('1A-9: 레거시 unscoped store 호환 + disconnect', async () => {
  await mockConnect(userA.id, '', 'tok-u');
  assert.equal(getCommerceOauthStatus(userA.id, {}).connected, true);
  disconnectCommerceOauth(userA.id, {});
  assert.equal(getCommerceOauthStatus(userA.id, {}).connected, false);
});

test('1A-10: OAuth 실패 상태', async () => {
  setCommerceOauthTransportForTests(async () => ({
    ok: false,
    status: 401,
    data: { code: 'UNAUTHORIZED' },
  }));
  await assert.rejects(
    () => connectCommerceOauth(userA.id, { storeId: 'store-fail' }),
    (e) => e.code === 'OAUTH_TOKEN_REJECTED'
  );
  assert.equal(getCommerceOauthStatus(userA.id, { storeId: 'store-fail' }).connected, false);
});
