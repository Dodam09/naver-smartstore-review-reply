import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-p0-'));
process.env.DATA_DIR = tempDir;
process.env.DB_PATH = path.join(tempDir, 'app.db');

const {
  closeDbForTests,
  createUser,
  upsertProductKnowledge,
  getProductKnowledge,
  listProductKnowledge,
  upsertStorePolicies,
  getStorePolicies,
  createInquiryConfirmation,
  listInquiryConfirmations,
  upsertCommerceProductSync,
  listCommerceProductSync,
  getCommerceProductSync,
  migrateKnowledgeTables,
  getDb,
} = await import('../db.js');
import { fieldCanUseAsFact } from '../knowledge-meta.js';
import { JUDGMENT } from '../knowledge-judge.js';
import { resolveInquiryEvidence } from '../evidence.js';

let userA;
let userB;

before(() => {
  userA = createUser(`p0a-${Date.now()}@example.com`, 'hash');
  userB = createUser(`p0b-${Date.now()}@example.com`, 'hash');
});

after(() => {
  closeDbForTests();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('P0-1: 승인 지식 본문이 자동수집으로 덮이지 않는다', () => {
  upsertProductKnowledge(userA.id, {
    productNo: '90001',
    productName: '승인상품',
    specs: '승인스펙',
    usage: '하루 1회',
    source: 'seller_approved',
    fieldMeta: {
      specs: { source: 'SELLER_APPROVED', trustStatus: 'approved' },
      usage: { source: 'SELLER_APPROVED', trustStatus: 'approved' },
    },
  });
  const after = upsertProductKnowledge(userA.id, {
    productNo: '90001',
    productName: '수집상품명',
    specs: '수집스펙',
    usage: '하루 2회',
    cautions: '신규주의',
    source: 'NAVER_PRODUCT',
    verifiedAt: null,
  });
  assert.equal(after.specs, '승인스펙');
  assert.equal(after.usage, '하루 1회');
  assert.equal(after.cautions, '신규주의');
  assert.equal(after.productName, '승인상품');
  assert.equal(after.source, 'seller_approved');
});

test('P0-2: 자동수집 값이 승인 지식과 다르면 conflict', () => {
  const row = getProductKnowledge(userA.id, '90001');
  assert.equal(row.fieldMeta.specs.trustStatus, 'conflict');
  assert.equal(row.fieldMeta.usage.trustStatus, 'conflict');
  assert.ok(row.fieldMeta.specs.scrapedValue);
  assert.equal(fieldCanUseAsFact(row, 'specs'), false);
});

test('P0-3: 미승인 자동수집은 확정 근거로 쓰이지 않는다', () => {
  const scraped = upsertProductKnowledge(userA.id, {
    productNo: '90002',
    productName: '수집만',
    specs: '미검증스펙',
    source: 'NAVER_PRODUCT',
    verifiedAt: null,
  });
  assert.equal(scraped.trustStatus, 'unverified');
  assert.equal(fieldCanUseAsFact(scraped, 'specs'), false);

  const evidence = resolveInquiryEvidence({
    row: { content: '스펙이 어떻게 되나요?', productNo: '90002' },
    productKnowledge: scraped,
    productMatchStatus: 'exact',
    storePolicies: null,
  });
  assert.notEqual(evidence.judgment, JUDGMENT.ANSWERABLE);
});

test('P0-4: 동일 user 스토어 A/B 완전 분리', () => {
  upsertProductKnowledge(userA.id, {
    storeId: 'store-a',
    productNo: '91001',
    productName: 'A스토어상품',
    specs: 'A스펙',
    source: 'manual',
  });
  upsertProductKnowledge(userA.id, {
    storeId: 'store-b',
    productNo: '91001',
    productName: 'B스토어상품',
    specs: 'B스펙',
    source: 'manual',
  });
  upsertStorePolicies(userA.id, { storeId: 'store-a', shipping: 'A배송' });
  upsertStorePolicies(userA.id, { storeId: 'store-b', shipping: 'B배송' });
  createInquiryConfirmation(userA.id, {
    storeId: 'store-a',
    productNo: '91001',
    question: 'A문의',
  });
  createInquiryConfirmation(userA.id, {
    storeId: 'store-b',
    productNo: '91001',
    question: 'B문의',
  });

  assert.equal(getProductKnowledge(userA.id, '91001', { storeId: 'store-a' }).specs, 'A스펙');
  assert.equal(getProductKnowledge(userA.id, '91001', { storeId: 'store-b' }).specs, 'B스펙');
  assert.equal(getProductKnowledge(userA.id, '91001', { storeId: 'store-a' }).productName, 'A스토어상품');
  assert.equal(getStorePolicies(userA.id, { storeId: 'store-a' }).shipping, 'A배송');
  assert.equal(getStorePolicies(userA.id, { storeId: 'store-b' }).shipping, 'B배송');
  assert.equal(listProductKnowledge(userA.id, { storeId: 'store-a' }).length, 1);
  assert.ok(
    listInquiryConfirmations(userA.id, { status: '', storeId: 'store-a' }).every((r) =>
      r.question.includes('A')
    )
  );
  assert.ok(
    listInquiryConfirmations(userA.id, { status: '', storeId: 'store-b' }).every((r) =>
      r.question.includes('B')
    )
  );
});

test('P0-5: 다른 user_id 접근 차단', () => {
  assert.equal(getProductKnowledge(userB.id, '91001', { storeId: 'store-a' }), null);
  assert.equal(getStorePolicies(userB.id, { storeId: 'store-a' }), null);
  assert.equal(listProductKnowledge(userB.id, { storeId: 'store-a' }).length, 0);
});

test('P0-6: 레거시 unscoped(store_id="") 하위 호환', () => {
  upsertProductKnowledge(userA.id, {
    productNo: '92001',
    productName: '레거시',
    specs: '레거시스펙',
    source: 'manual',
  });
  const legacy = getProductKnowledge(userA.id, '92001');
  assert.equal(legacy.storeId, '');
  assert.equal(legacy.specs, '레거시스펙');
  assert.equal(getProductKnowledge(userA.id, '92001', { storeId: 'store-a' }), null);
  assert.ok(listProductKnowledge(userA.id).some((r) => r.productNo === '92001'));
});

test('P0-7: 동기화 재실행 시 commerce_product_sync 중복 없음', () => {
  upsertCommerceProductSync(userA.id, {
    storeId: 'store-a',
    channelProductNo: '93001',
    productName: '동기1',
    status: 'SALE',
    contentHash: 'hash1',
  });
  upsertCommerceProductSync(userA.id, {
    storeId: 'store-a',
    channelProductNo: '93001',
    productName: '동기2',
    status: 'SALE',
    contentHash: 'hash2',
  });
  const list = listCommerceProductSync(userA.id, { storeId: 'store-a' }).filter(
    (r) => r.channel_product_no === '93001'
  );
  assert.equal(list.length, 1);
  assert.equal(getCommerceProductSync(userA.id, '93001', { storeId: 'store-a' }).product_name, '동기2');
  assert.equal(getCommerceProductSync(userA.id, '93001', { storeId: 'store-b' }), null);
});

test('P0-8: ANSWERABLE / SELLER_CONFIRM / REALTIME 판정 유지', () => {
  const approved = upsertProductKnowledge(userA.id, {
    productNo: '94001',
    productName: '판정상품',
    usage: '식후 1포',
    source: 'seller_approved',
    fieldMeta: { usage: { source: 'SELLER_APPROVED', trustStatus: 'approved' } },
  });
  const answerable = resolveInquiryEvidence({
    row: { content: '사용법이 어떻게 되나요?', productNo: '94001' },
    productKnowledge: approved,
    productMatchStatus: 'exact',
  });
  assert.equal(answerable.judgment, JUDGMENT.ANSWERABLE);

  const realtime = resolveInquiryEvidence({
    row: { content: '제 주문 송장번호 알려주세요', productNo: '94001' },
    productKnowledge: approved,
    productMatchStatus: 'exact',
  });
  assert.equal(realtime.judgment, JUDGMENT.REALTIME_REQUIRED);

  const noMatch = resolveInquiryEvidence({
    row: { content: '성분이 뭐예요?', productNo: '99999' },
    productKnowledge: null,
    productMatchStatus: 'seller_confirm',
    productMatchReason: '상품번호에 해당하는 등록 상품정보가 없습니다.',
  });
  assert.equal(noMatch.judgment, JUDGMENT.SELLER_CONFIRM);
});

test('P0: migrateKnowledgeTables 재실행 안전 + 레거시 store_id 유지', () => {
  const before = getProductKnowledge(userA.id, '92001');
  migrateKnowledgeTables(getDb());
  migrateKnowledgeTables(getDb());
  const after = getProductKnowledge(userA.id, '92001');
  assert.equal(after.specs, before.specs);
  assert.equal(after.storeId, '');
});
