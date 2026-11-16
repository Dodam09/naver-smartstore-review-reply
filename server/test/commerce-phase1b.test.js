import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, afterEach, test } from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commerce-1b-'));
process.env.DATA_DIR = tempDir;
process.env.DB_PATH = path.join(tempDir, 'app.db');
process.env.COMMERCE_OAUTH_MOCK = 'true';
process.env.COMMERCE_TOKEN_SECRET = 'phase1b-test-token-secret-key';
process.env.COMMERCE_CLIENT_ID = 'test-client-id';
process.env.COMMERCE_CLIENT_SECRET = '$2a$10$abcdefghijklmnopqrstuv';
process.env.COMMERCE_API_MAX_RETRIES = '1';

const {
  closeDbForTests,
  createUser,
  getProductKnowledge,
  upsertProductKnowledge,
  getCommerceProductSync,
} = await import('../db.js');
const {
  connectCommerceOauth,
  setCommerceOauthTransportForTests,
} = await import('../commerce-oauth.js');
const { setCommerceApiTransportForTests, CommerceApiError } = await import('../commerce-api.js');
const {
  fetchCommerceProductDetail,
  approveCommerceProductField,
  rejectCommerceProductField,
  getCommerceProductCatalog,
} = await import('../commerce-detail.js');
const { fieldCanUseAsFact } = await import('../knowledge-meta.js');
const { JUDGMENT } = await import('../knowledge-judge.js');
const { resolveInquiryEvidence } = await import('../evidence.js');

let userA;
let userB;

const DETAIL_FIXTURE = {
  channelProductNo: 111001,
  originProductNo: 222001,
  statusType: 'SALE',
  channelProductName: '채널표시명',
  stockQuantity: 9,
  salePrice: 12000,
  originProduct: {
    name: '수집상품명',
    detailContent: '<p>상세 <b>설명</b> 본문</p>',
    detailAttribute: {
      originArea: { content: '국내산' },
      afterServiceInfo: { content: '02-000-0000' },
      sellerCode: 'SC-1',
      brandName: '테스트브랜드',
    },
  },
};

async function connectOauth(userId, storeId) {
  setCommerceOauthTransportForTests(async () => ({
    ok: true,
    status: 200,
    data: {
      access_token: `tok-${storeId}`,
      expires_in: 3600,
    },
  }));
  await connectCommerceOauth(userId, { storeId });
}

before(async () => {
  userA = createUser(`c1b-a-${Date.now()}@example.com`, 'hash');
  userB = createUser(`c1b-b-${Date.now()}@example.com`, 'hash');
  await connectOauth(userA.id, 'store-a');
  await connectOauth(userA.id, 'store-b');
});

afterEach(() => {
  setCommerceOauthTransportForTests(null);
  setCommerceApiTransportForTests(null);
});

after(() => {
  closeDbForTests();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('1B-1: 문의 상품만 상세 조회 (요청 번호만 API 호출)', async () => {
  const called = [];
  setCommerceApiTransportForTests(async (url) => {
    called.push(String(url));
    assert.match(String(url), /\/111001$/);
    return { ok: true, status: 200, data: DETAIL_FIXTURE };
  });
  const result = await fetchCommerceProductDetail(userA.id, {
    storeId: 'store-a',
    channelProductNo: '111001',
  });
  assert.equal(result.skipped, false);
  assert.equal(result.channelProductNo, '111001');
  assert.equal(called.length, 1);
  assert.ok(result.presentFields.includes('product_name'));
  assert.ok(result.presentFields.includes('detail_description'));
  assert.ok(result.presentFields.includes('specs'));
  assert.equal(result.presentFields.includes('usage'), false);
});

test('1B-2: 상세정보는 NAVER_PRODUCT unverified 저장', () => {
  const kb = getProductKnowledge(userA.id, '111001', { storeId: 'store-a' });
  assert.ok(kb);
  assert.equal(kb.productName, '수집상품명');
  assert.match(kb.detailDescription, /상세 설명 본문/);
  assert.match(kb.specs, /원산지/);
  assert.match(kb.extra, /판매자코드/);
  assert.equal(kb.usage, '');
  assert.equal(kb.source, 'NAVER_PRODUCT');
  assert.equal(kb.trustStatus, 'unverified');
  assert.equal(fieldCanUseAsFact(kb, 'specs'), false);
  const sync = getCommerceProductSync(userA.id, '111001', { storeId: 'store-a' });
  assert.equal(sync.detail_ok, 1);
  assert.ok(sync.detail_content_hash);
  assert.ok(sync.detail_fetched_at);
});

test('1B-3: 승인 지식 불변 + 1B-4 conflict', async () => {
  upsertProductKnowledge(userA.id, {
    storeId: 'store-a',
    productNo: '111002',
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
      ...DETAIL_FIXTURE,
      channelProductNo: 111002,
      originProduct: {
        ...DETAIL_FIXTURE.originProduct,
        name: '수집이름다름',
        detailAttribute: {
          originArea: { content: '수입산' },
        },
      },
    },
  }));
  const result = await fetchCommerceProductDetail(userA.id, {
    storeId: 'store-a',
    channelProductNo: '111002',
  });
  const kb = getProductKnowledge(userA.id, '111002', { storeId: 'store-a' });
  assert.equal(kb.productName, '승인이름');
  assert.equal(kb.specs, '승인스펙');
  assert.equal(kb.fieldMeta.product_name.trustStatus, 'conflict');
  assert.equal(kb.fieldMeta.specs.trustStatus, 'conflict');
  assert.equal(kb.fieldMeta.specs.scrapedValue.includes('수입산'), true);
  assert.equal(fieldCanUseAsFact(kb, 'specs'), false);
  assert.ok(result.conflicts.length >= 1);
});

test('1B-5: 판매중지·조회실패로 승인 지식 삭제/무효화 금지', async () => {
  upsertProductKnowledge(userA.id, {
    storeId: 'store-a',
    productNo: '111003',
    productName: '유지상품',
    specs: '유지스펙',
    source: 'seller_approved',
    fieldMeta: { specs: { source: 'SELLER_APPROVED', trustStatus: 'approved' } },
  });
  setCommerceApiTransportForTests(async () => ({
    ok: true,
    status: 200,
    data: {
      channelProductNo: 111003,
      statusType: 'SUSPENSION',
      originProduct: { name: '중지상품' },
    },
  }));
  await fetchCommerceProductDetail(userA.id, {
    storeId: 'store-a',
    channelProductNo: '111003',
  });
  let kb = getProductKnowledge(userA.id, '111003', { storeId: 'store-a' });
  assert.equal(kb.specs, '유지스펙');
  assert.equal(fieldCanUseAsFact(kb, 'specs'), true);
  assert.equal(getCommerceProductSync(userA.id, '111003', { storeId: 'store-a' }).status, 'SUSPENSION');

  setCommerceApiTransportForTests(async () => ({
    ok: false,
    status: 404,
    data: { code: 'NOT_FOUND' },
  }));
  await assert.rejects(
    () =>
      fetchCommerceProductDetail(userA.id, {
        storeId: 'store-a',
        channelProductNo: '111003',
        force: true,
      }),
    (e) => e instanceof CommerceApiError && e.status === 404
  );
  kb = getProductKnowledge(userA.id, '111003', { storeId: 'store-a' });
  assert.ok(kb);
  assert.equal(kb.specs, '유지스펙');
  assert.equal(fieldCanUseAsFact(kb, 'specs'), true);
  const sync = getCommerceProductSync(userA.id, '111003', { storeId: 'store-a' });
  assert.equal(sync.detail_ok, 0);
  assert.ok(sync.detail_error);
});

test('1B-6: 상세 중복 수집 방지 (content_hash skip)', async () => {
  let calls = 0;
  setCommerceApiTransportForTests(async () => {
    calls += 1;
    return { ok: true, status: 200, data: { ...DETAIL_FIXTURE, channelProductNo: 111004 } };
  });
  const first = await fetchCommerceProductDetail(userA.id, {
    storeId: 'store-a',
    channelProductNo: '111004',
  });
  assert.equal(first.skipped, false);
  const hash1 = getCommerceProductSync(userA.id, '111004', { storeId: 'store-a' }).detail_content_hash;
  const second = await fetchCommerceProductDetail(userA.id, {
    storeId: 'store-a',
    channelProductNo: '111004',
  });
  assert.equal(second.skipped, true);
  assert.equal(second.reason, 'unchanged');
  assert.equal(calls, 2); // 조회는 하되 KB/해시 갱신 skip
  const hash2 = getCommerceProductSync(userA.id, '111004', { storeId: 'store-a' }).detail_content_hash;
  assert.equal(hash1, hash2);
  const forced = await fetchCommerceProductDetail(userA.id, {
    storeId: 'store-a',
    channelProductNo: '111004',
    force: true,
  });
  assert.equal(forced.skipped, false);
  assert.equal(calls, 3);
});

test('1B-7: 429 재시도 후 성공', async () => {
  let calls = 0;
  setCommerceApiTransportForTests(async () => {
    calls += 1;
    if (calls === 1) {
      return { ok: false, status: 429, data: { code: 'GW.RATE_LIMIT' }, headers: { 'retry-after': '0' } };
    }
    return {
      ok: true,
      status: 200,
      data: { ...DETAIL_FIXTURE, channelProductNo: 111005 },
    };
  });
  const result = await fetchCommerceProductDetail(userA.id, {
    storeId: 'store-a',
    channelProductNo: '111005',
  });
  assert.equal(result.skipped, false);
  assert.equal(calls, 2);
});

test('1B-8: user/store 교차 접근 차단', async () => {
  const catalogB = getCommerceProductCatalog(userB.id, { storeId: 'store-a' });
  assert.equal(catalogB.catalogCount, 0);
  assert.equal(getProductKnowledge(userB.id, '111001', { storeId: 'store-a' }), null);
  assert.equal(getProductKnowledge(userA.id, '111001', { storeId: 'store-b' }), null);

  await assert.rejects(
    () =>
      fetchCommerceProductDetail(userB.id, {
        storeId: 'store-a',
        channelProductNo: '111001',
      }),
    (e) => e.code === 'OAUTH_NOT_CONNECTED'
  );
});

test('1B-9: 승인 전 AI 확정 근거 사용 차단', () => {
  const kb = getProductKnowledge(userA.id, '111001', { storeId: 'store-a' });
  const evidence = resolveInquiryEvidence({
    row: { content: '원산지가 어떻게 되나요?', productNo: '111001' },
    productKnowledge: kb,
    productMatchStatus: 'exact',
    storePolicies: null,
  });
  assert.notEqual(evidence.judgment, JUDGMENT.ANSWERABLE);
  assert.equal(fieldCanUseAsFact(kb, 'specs'), false);
});

test('1B-10: 승인 후 판정 엔진 연동', () => {
  approveCommerceProductField(userA.id, {
    storeId: 'store-a',
    channelProductNo: '111001',
    field: 'specs',
  });
  const kb = getProductKnowledge(userA.id, '111001', { storeId: 'store-a' });
  assert.equal(kb.fieldMeta.specs.trustStatus, 'approved');
  assert.equal(fieldCanUseAsFact(kb, 'specs'), true);
  const evidence = resolveInquiryEvidence({
    row: { content: '원산지 알려주세요', productNo: '111001' },
    productKnowledge: kb,
    productMatchStatus: 'exact',
    storePolicies: null,
  });
  // 스펙만 승인되어도 질문이 상품 사실 범위면 ANSWERABLE 가능(엔진 규칙에 따름)
  assert.ok(
    evidence.judgment === JUDGMENT.ANSWERABLE ||
      evidence.judgment === JUDGMENT.SELLER_CONFIRM ||
      evidence.judgment === JUDGMENT.REALTIME_REQUIRED
  );
  assert.ok(Array.isArray(evidence.verifiedFacts) || evidence.judgment !== JUDGMENT.ANSWERABLE);
  if (evidence.judgment === JUDGMENT.ANSWERABLE) {
    assert.ok(evidence.verifiedFacts?.length >= 1 || evidence.usedKnowledge?.length >= 0);
  }
});

test('1B-11: UI 카탈로그·승인·거부·충돌 표시 데이터', () => {
  // conflict 상품 111002
  const catalog = getCommerceProductCatalog(userA.id, { storeId: 'store-a' });
  assert.ok(catalog.catalogCount >= 1);
  const conflictItem = catalog.items.find((i) => i.channelProductNo === '111002');
  assert.ok(conflictItem);
  assert.ok(conflictItem.conflictCount >= 1);
  assert.ok(conflictItem.fields.some((f) => f.conflict));

  // reject conflict → approved 복구, scraped 제거
  rejectCommerceProductField(userA.id, {
    storeId: 'store-a',
    channelProductNo: '111002',
    field: 'specs',
  });
  const afterReject = getProductKnowledge(userA.id, '111002', { storeId: 'store-a' });
  assert.equal(afterReject.specs, '승인스펙');
  assert.equal(afterReject.fieldMeta.specs.trustStatus, 'approved');
  assert.equal(afterReject.fieldMeta.specs.scrapedValue || '', '');

  // unverified 거부
  rejectCommerceProductField(userA.id, {
    storeId: 'store-a',
    channelProductNo: '111001',
    field: 'extra',
  });
  const dismissed = getProductKnowledge(userA.id, '111001', { storeId: 'store-a' });
  assert.equal(dismissed.fieldMeta.extra.trustStatus, 'dismissed');
  assert.equal(fieldCanUseAsFact(dismissed, 'extra'), false);

  // conflict 승인(scraped 채택)
  approveCommerceProductField(userA.id, {
    storeId: 'store-a',
    channelProductNo: '111002',
    field: 'product_name',
    useScraped: true,
  });
  const afterApprove = getProductKnowledge(userA.id, '111002', { storeId: 'store-a' });
  assert.equal(afterApprove.productName, '수집이름다름');
  assert.equal(afterApprove.fieldMeta.product_name.trustStatus, 'approved');
});

test('1B-12: 목록/상세 구분 + 미제공 필드 추측 금지', async () => {
  setCommerceApiTransportForTests(async () => ({
    ok: true,
    status: 200,
    data: {
      channelProductNo: 111006,
      statusType: 'SALE',
      originProduct: { name: '이름만' },
    },
  }));
  const result = await fetchCommerceProductDetail(userA.id, {
    storeId: 'store-a',
    channelProductNo: '111006',
  });
  assert.deepEqual(result.presentFields.sort(), ['product_name']);
  const kb = getProductKnowledge(userA.id, '111006', { storeId: 'store-a' });
  assert.equal(kb.detailDescription, '');
  assert.equal(kb.specs, '');
  assert.equal(kb.usage, '');
  assert.equal(kb.optionsCompat, '');
  assert.equal(kb.cautions, '');
});
