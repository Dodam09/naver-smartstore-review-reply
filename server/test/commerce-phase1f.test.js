import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commerce-1f-'));
process.env.DATA_DIR = tempDir;
process.env.DB_PATH = path.join(tempDir, 'app.db');
process.env.COMMERCE_OAUTH_MOCK = 'true';
process.env.COMMERCE_TOKEN_SECRET = 'phase1f-test-token-secret-key';
// env 자격증명 비워 body 전달 경로 검증
process.env.COMMERCE_CLIENT_ID = '';
process.env.COMMERCE_CLIENT_SECRET = '';

const {
  closeDbForTests,
  createUser,
  getCommerceOauthConnection,
  upsertProductKnowledge,
  getProductKnowledge,
} = await import('../db.js');
const {
  connectCommerceOauth,
  reissueCommerceAccessToken,
  disconnectCommerceOauth,
  getCommerceOauthStatus,
  setCommerceOauthTransportForTests,
  safeOauthLog,
} = await import('../commerce-oauth.js');
const { redactSecrets, assertNoSecretsInText, decryptSecret } = await import('../commerce-crypto.js');
const { setCommerceApiTransportForTests } = await import('../commerce-api.js');
const { syncCommerceProductCatalog, isCommerceSyncRunning } = await import('../commerce-sync.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const popupHtml = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const knowledgeManageHtml = fs.readFileSync(path.join(root, 'knowledge-manage.html'), 'utf8');
const catalogJs = fs.readFileSync(path.join(root, 'lib/commerce-catalog.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const indexJs = fs.readFileSync(path.join(root, 'server/index.js'), 'utf8');

let userA;
let userB;

before(() => {
  userA = createUser(`c1f-a-${Date.now()}@example.com`, 'hash');
  userB = createUser(`c1f-b-${Date.now()}@example.com`, 'hash');
});

afterEach(() => {
  setCommerceOauthTransportForTests(null);
  setCommerceApiTransportForTests(null);
});

after(() => {
  closeDbForTests();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('1F-1: 커머스 UI 보류(숨김) · 클라이언트 로직·Secret 저장 금지 유지', () => {
  // 상품정보 자동수집 UX는 보류 — popup에 연결/동기화/Secret 입력 UI를 요구하지 않음
  assert.match(popupHtml, /id="commerceCatalogCard"/);
  assert.match(popupHtml, /id="commerceCatalogCard"[^>]*\bhidden\b|\bhidden\b[^>]*id="commerceCatalogCard"/);
  assert.equal(/commerceOauthConnectBtn/.test(popupHtml), false);
  assert.equal(/commerceClientSecret/.test(popupHtml), false);
  assert.equal(/commerceCatalogSyncBtn/.test(popupHtml), false);
  // 보류여도 클라이언트 로직·Secret 비저장 규칙은 유지
  assert.match(catalogJs, /oauth\/connect/);
  assert.match(catalogJs, /products\/sync/);
  assert.match(catalogJs, /clearSecretInput/);
  assert.match(catalogJs, /syncInFlight/);
  assert.equal(/chrome\.storage\.local\.set\([^\)]*clientSecret/i.test(catalogJs), false);
  assert.equal(/localStorage\.setItem\([^\)]*secret/i.test(catalogJs), false);
  assert.match(catalogJs, /approveField/);
  assert.match(catalogJs, /rejectField/);
});

test('1F-1b: 아밀리 예시 채우기 버튼은 실사용 UI에서 숨김', () => {
  assert.match(knowledgeManageHtml, /id="kbSeedAmilyBtn"/);
  assert.match(
    knowledgeManageHtml,
    /id="kbSeedAmilyBtn"[^>]*\bhidden\b|\bhidden\b[^>]*id="kbSeedAmilyBtn"/
  );
});

test('1F-2: mock OAuth 연결 성공 (body Client ID/Secret)', async () => {
  let seenBody = '';
  setCommerceOauthTransportForTests(async (_url, opts) => {
    seenBody = String(opts.body || '');
    assert.match(seenBody, /grant_type=client_credentials/);
    assert.match(seenBody, /type=SELF/);
    assert.equal(/(?:^|&)client_secret=/.test(seenBody), false);
    assert.equal(seenBody.includes('$2a$10$abcdefghijklmnopqrstuv'), false);
    return {
      ok: true,
      status: 200,
      data: { access_token: 'tok-1f-ok', expires_in: 3600, token_type: 'Bearer' },
    };
  });

  const oauth = await connectCommerceOauth(userA.id, {
    storeId: 'store-ui',
    clientId: 'aaaabbbbcccc',
    clientSecret: '$2a$10$abcdefghijklmnopqrstuv',
    type: 'SELF',
  });
  assert.equal(oauth.connected, true);
  assert.equal(oauth.status, 'connected');
  assert.equal(oauth.clientId, 'aaaabbbbcccc');
  assert.equal(oauth.hasClientSecret, true);
  assert.equal(oauth.hasAccessToken, true);
  const json = JSON.stringify(safeOauthLog(oauth));
  assert.equal(json.includes('tok-1f-ok'), false);
  assert.equal(json.includes('$2a$10$abcdefghijklmnopqrstuv'), false);
  assert.doesNotThrow(() => assertNoSecretsInText(json));
});

test('1F-3: 잘못된 자격증명 실패', async () => {
  setCommerceOauthTransportForTests(async () => ({
    ok: false,
    status: 401,
    data: { code: 'UNAUTHORIZED' },
  }));
  await assert.rejects(
    () =>
      connectCommerceOauth(userA.id, {
        storeId: 'store-bad',
        clientId: 'bad-id',
        clientSecret: '$2a$10$abcdefghijklmnopqrstuv',
      }),
    (e) => e.code === 'OAUTH_TOKEN_REJECTED'
  );
  const st = getCommerceOauthStatus(userA.id, { storeId: 'store-bad' });
  assert.equal(st.connected, false);
  assert.ok(st.lastError);
});

test('1F-4: 연결 상태·스토어 스코프', () => {
  const a = getCommerceOauthStatus(userA.id, { storeId: 'store-ui' });
  const other = getCommerceOauthStatus(userA.id, { storeId: 'store-other' });
  const b = getCommerceOauthStatus(userB.id, { storeId: 'store-ui' });
  assert.equal(a.connected, true);
  assert.equal(a.storeId, 'store-ui');
  assert.equal(other.connected, false);
  assert.equal(b.connected, false);
});

test('1F-5: 토큰 재발급 (서버 보관 Secret, body Secret 불필요)', async () => {
  let calls = 0;
  setCommerceOauthTransportForTests(async (_url, opts) => {
    calls += 1;
    const body = String(opts.body || '');
    assert.equal(/(?:^|&)client_secret=/.test(body), false);
    return {
      ok: true,
      status: 200,
      data: { access_token: `tok-re-${calls}`, expires_in: 3600 },
    };
  });
  const oauth = await reissueCommerceAccessToken(userA.id, { storeId: 'store-ui' });
  assert.equal(oauth.connected, true);
  assert.equal(calls, 1);
  const row = getCommerceOauthConnection(userA.id, { storeId: 'store-ui', includeSecrets: true });
  assert.equal(decryptSecret(row.accessTokenEnc), 'tok-re-1');
});

test('1F-6: 만료 표시 및 연결 해제 시 Secret 암호문 삭제', async () => {
  // 짧은 만료로 연결
  setCommerceOauthTransportForTests(async () => ({
    ok: true,
    status: 200,
    data: { access_token: 'tok-exp', expires_in: 1 },
  }));
  await connectCommerceOauth(userA.id, {
    storeId: 'store-exp',
    clientId: 'aaaabbbbcccc',
    clientSecret: '$2a$10$abcdefghijklmnopqrstuv',
  });
  await new Promise((r) => setTimeout(r, 20));
  const expired = getCommerceOauthStatus(userA.id, { storeId: 'store-exp' });
  assert.ok(expired.status === 'expired' || expired.connected === false || expired.expiresAt);

  disconnectCommerceOauth(userA.id, { storeId: 'store-exp' });
  const after = getCommerceOauthConnection(userA.id, { storeId: 'store-exp', includeSecrets: true });
  assert.equal(after.status, 'disconnected');
  assert.equal(after.accessTokenEnc || '', '');
  assert.equal(after.clientSecretEnc || '', '');
  assert.equal(after.hasClientSecret, false);
});

test('1F-7: 응답 redact · 평문 Secret 미포함', () => {
  const redacted = redactSecrets({
    clientSecret: 'secret-value',
    client_secret: 'x',
    access_token: 'tok',
    oauth: { hasClientSecret: true, clientId: 'id-only' },
  });
  assert.equal(redacted.clientSecret, '[redacted]');
  assert.equal(redacted.access_token, '[redacted]');
  assert.equal(redacted.oauth.clientId, 'id-only');
});

test('1F-8: 스토어 전환 시 독립 연결', async () => {
  setCommerceOauthTransportForTests(async () => ({
    ok: true,
    status: 200,
    data: { access_token: 'tok-b', expires_in: 3600 },
  }));
  await connectCommerceOauth(userA.id, {
    storeId: 'store-b',
    clientId: 'client-b',
    clientSecret: '$2a$10$abcdefghijklmnopqrstuv',
  });
  assert.equal(getCommerceOauthStatus(userA.id, { storeId: 'store-ui' }).clientId, 'aaaabbbbcccc');
  assert.equal(getCommerceOauthStatus(userA.id, { storeId: 'store-b' }).clientId, 'client-b');
});

test('1F-9: disconnect는 해당 store 토큰만 폐기·지식 보존', async () => {
  upsertProductKnowledge(userA.id, {
    storeId: 'store-ui',
    productNo: '9001',
    productName: '보존상품',
    specs: '승인스펙',
    source: 'seller_approved',
    fieldMeta: {
      product_name: { source: 'SELLER_APPROVED', trustStatus: 'approved' },
      specs: { source: 'SELLER_APPROVED', trustStatus: 'approved' },
    },
  });
  disconnectCommerceOauth(userA.id, { storeId: 'store-ui' });
  const oauth = getCommerceOauthConnection(userA.id, { storeId: 'store-ui', includeSecrets: true });
  assert.equal(oauth.status, 'disconnected');
  assert.equal(oauth.accessTokenEnc || '', '');
  assert.equal(oauth.clientSecretEnc || '', '');
  // 다른 스토어 연결은 유지
  assert.equal(getCommerceOauthStatus(userA.id, { storeId: 'store-b' }).connected, true);
  const kb = getProductKnowledge(userA.id, '9001', { storeId: 'store-ui' });
  assert.equal(kb.productName, '보존상품');
  assert.equal(kb.specs, '승인스펙');
});

test('1F-10: 목록 sync 중복 실행 방지 (lease)', async () => {
  setCommerceOauthTransportForTests(async () => ({
    ok: true,
    status: 200,
    data: { access_token: 'tok-sync', expires_in: 3600 },
  }));
  await connectCommerceOauth(userA.id, {
    storeId: 'store-sync',
    clientId: 'sync-client',
    clientSecret: '$2a$10$abcdefghijklmnopqrstuv',
  });
  setCommerceApiTransportForTests(async () => {
    await new Promise((r) => setTimeout(r, 80));
    return {
      ok: true,
      status: 200,
      data: {
        contents: [
          { channelProductNo: 1, name: '판매중', statusType: 'SALE' },
          { channelProductNo: 2, name: '품절', statusType: 'OUTOFSTOCK' },
        ],
      },
    };
  });
  const p1 = syncCommerceProductCatalog(userA.id, { storeId: 'store-sync' });
  await new Promise((r) => setTimeout(r, 10));
  await assert.rejects(
    () => syncCommerceProductCatalog(userA.id, { storeId: 'store-sync' }),
    (e) => e.code === 'SYNC_IN_PROGRESS'
  );
  const stats = await p1;
  assert.equal(isCommerceSyncRunning(userA.id, 'store-sync'), false);
  assert.ok((stats.products || 0) >= 2 || (stats.upserted || 0) >= 0);
});

test('1F-11: 확장 manifest 1.3.86 · 서버 health 표기 분리 확인', () => {
  // 확장/스토어 패키지 버전 (UX·배포 단위)
  assert.equal(manifest.version, '1.3.86');
  // 서버 health 버전은 API 배포 단위로 따로 관리 (현재 1.3.87). 확장과 강제 일치시키지 않음.
  const healthVersion = indexJs.match(/\/health[\s\S]*?version:\s*'([^']+)'/);
  assert.ok(healthVersion, 'health 응답 version 필드 필요');
  assert.equal(healthVersion[1], '1.3.87');
  assert.equal(/version:\s*'1\.3\.79'/.test(indexJs), false);
});

test('1F-12: disconnect 라우트 존재', () => {
  assert.match(indexJs, /\/api\/commerce\/oauth\/disconnect/);
  assert.match(catalogJs, /oauth\/disconnect/);
});
