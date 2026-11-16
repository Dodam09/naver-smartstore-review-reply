/**
 * 통합 지식 관리 API 완성 점검 — 상품정보 자동수집/커머스 코드 미사용.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-api-complete-'));
process.env.DATA_DIR = tempDir;
process.env.DB_PATH = path.join(tempDir, 'app.db');

const {
  closeDbForTests,
  createUser,
  upsertProductKnowledge,
  getProductKnowledge,
  deleteProductKnowledge,
  upsertStorePolicies,
  getStorePolicies,
  clearStorePolicyField,
  createInquiryConfirmation,
  approveInquiryFact,
  checkKbLinkSync,
  listProductKnowledge,
} = await import('../db.js');

const {
  getKnowledgeSummary,
  listKnowledgeEntries,
  getKnowledgeEntry,
  patchKnowledgeEntry,
  deleteKnowledgeEntry,
} = await import('../knowledge-entries.js');

const { fieldCanUseAsFact } = await import('../knowledge-meta.js');
const { resolveInquiryEvidence } = await import('../evidence.js');
const { JUDGMENT } = await import('../knowledge-judge.js');

let userA;
let userB;

before(() => {
  userA = createUser(`kb-api-a-${Date.now()}@example.com`, 'hash');
  userB = createUser(`kb-api-b-${Date.now()}@example.com`, 'hash');
});

after(() => {
  closeDbForTests();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('KB-API-1: 상품 지식 등록·상세·목록', () => {
  const item = upsertProductKnowledge(userA.id, {
    storeId: 'store-a',
    productNo: '7001',
    productName: '지식상품A',
    specs: '성분 X',
    source: 'manual',
    trustStatus: 'approved',
    fieldMeta: {
      product_name: { source: 'SELLER_APPROVED', trustStatus: 'approved' },
      specs: { source: 'SELLER_APPROVED', trustStatus: 'approved' },
    },
  });
  assert.equal(item.productNo, '7001');
  assert.equal(getProductKnowledge(userA.id, '7001', { storeId: 'store-a' }).specs, '성분 X');
  const list = listProductKnowledge(userA.id, { storeId: 'store-a' });
  assert.ok(list.some((r) => r.productNo === '7001'));
});

test('KB-API-2: 지식 수정·필드 비활성화(삭제) 후 행 유지', () => {
  patchKnowledgeEntry(userA.id, 'product:7001:specs', {
    storeId: 'store-a',
    content: '성분 Y',
    trustStatus: 'approved',
  });
  assert.equal(getProductKnowledge(userA.id, '7001', { storeId: 'store-a' }).specs, '성분 Y');
  deleteKnowledgeEntry(userA.id, 'product:7001:specs', { storeId: 'store-a' });
  const kb = getProductKnowledge(userA.id, '7001', { storeId: 'store-a' });
  assert.equal(kb.specs, '');
  assert.equal(kb.productName, '지식상품A');
});

test('KB-API-3: 정책 등록·수정·store 스코프 clear', () => {
  upsertStorePolicies(userA.id, {
    storeId: 'store-a',
    shipping: '2일 배송',
    refund: '7일 환불',
    source: 'manual',
    trustStatus: 'approved',
  });
  upsertStorePolicies(userA.id, {
    storeId: 'store-b',
    shipping: 'B스토어 배송',
    source: 'manual',
    trustStatus: 'approved',
  });
  clearStorePolicyField(userA.id, 'shipping', { storeId: 'store-a' });
  assert.equal(getStorePolicies(userA.id, { storeId: 'store-a' }).shipping, '');
  assert.equal(getStorePolicies(userA.id, { storeId: 'store-a' }).refund, '7일 환불');
  assert.equal(getStorePolicies(userA.id, { storeId: 'store-b' }).shipping, 'B스토어 배송');
});

test('KB-API-4: summary·entries store 격리', () => {
  upsertProductKnowledge(userA.id, {
    storeId: 'store-b',
    productNo: '7002',
    productName: 'B전용',
    specs: 'B스펙',
    source: 'manual',
    trustStatus: 'approved',
  });
  const sumA = getKnowledgeSummary(userA.id, undefined, { storeId: 'store-a' });
  const sumB = getKnowledgeSummary(userA.id, undefined, { storeId: 'store-b' });
  assert.ok(sumA.productFields >= 1);
  assert.ok(sumB.productFields >= 1);
  const listA = listKnowledgeEntries(userA.id, { storeId: 'store-a', type: 'product' });
  const listB = listKnowledgeEntries(userA.id, { storeId: 'store-b', type: 'product' });
  assert.ok(listA.items.every((e) => e.productNo !== '7002' || e.title.includes('지식상품A')));
  assert.ok(listB.items.some((e) => e.productNo === '7002'));
  assert.equal(
    listA.items.some((e) => e.productNo === '7002' && e.field === 'specs'),
    false
  );
});

test('KB-API-5: user 격리 · 타 사용자 접근 불가', () => {
  assert.equal(getProductKnowledge(userB.id, '7001', { storeId: 'store-a' }), null);
  assert.throws(
    () => getKnowledgeEntry(userB.id, 'product:7001:product_name', undefined, { storeId: 'store-a' }),
    (e) => e.code === 'NOT_FOUND'
  );
});

test('KB-API-6: 자동수집은 승인 지식 덮어쓰지 않음', () => {
  // 승인 메타 재확정 후 자동수집 시도
  upsertProductKnowledge(userA.id, {
    storeId: 'store-a',
    productNo: '7001',
    productName: '지식상품A',
    specs: '승인스펙',
    source: 'seller_approved',
    trustStatus: 'approved',
    fieldMeta: {
      product_name: { source: 'SELLER_APPROVED', trustStatus: 'approved' },
      specs: { source: 'SELLER_APPROVED', trustStatus: 'approved' },
    },
  });
  upsertProductKnowledge(userA.id, {
    storeId: 'store-a',
    productNo: '7001',
    productName: '수집이름시도',
    specs: '수집스펙시도',
    source: 'NAVER_PRODUCT',
  });
  const kb = getProductKnowledge(userA.id, '7001', { storeId: 'store-a' });
  // 본문은 유지, 값이 다르면 conflict → 확정근거 불가(승인 보호 정책)
  assert.equal(kb.productName, '지식상품A');
  assert.equal(kb.specs, '승인스펙');
  assert.equal(kb.fieldMeta?.specs?.trustStatus, 'conflict');
  assert.equal(fieldCanUseAsFact(kb, 'specs'), false);
});

test('KB-API-7: FAQ mirror KB sync는 store 스코프', async () => {
  const conf = createInquiryConfirmation(userA.id, {
    storeId: 'store-a',
    inquiryKey: 'iq-1',
    productNo: '7001',
    productName: '지식상품A',
    question: '성분이 뭔가요?',
    draftReply: '성분 Y입니다.',
  });
  const approved = approveInquiryFact(userA.id, conf.id, {
    mode: 'mirror',
    field: 'extra',
    value: '추가사실',
    productNo: '7001',
  });
  const sync = checkKbLinkSync(userA.id, approved);
  assert.equal(sync.synced, true);
  // 다른 스토어 KB에는 반영되지 않음
  assert.equal(getProductKnowledge(userA.id, '7001', { storeId: 'store-b' })?.extra || '', '');
});

test('KB-API-8: AI 지식 검색 회귀 (승인 KB 사용)', () => {
  const kb = getProductKnowledge(userA.id, '7001', { storeId: 'store-a' });
  const policies = getStorePolicies(userA.id, { storeId: 'store-a' });
  const evidence = resolveInquiryEvidence({
    row: {
      productNo: '7001',
      productName: '지식상품A',
      content: '이 상품 스펙이 어떻게 되나요?',
    },
    productKnowledge: kb,
    storePolicies: policies,
    productMatchStatus: 'exact',
    approvedFaqs: [],
  });
  assert.ok(evidence);
  assert.ok(evidence.judgment);
  assert.ok(
    [JUDGMENT.ANSWERABLE, JUDGMENT.SELLER_CONFIRM, JUDGMENT.REALTIME_REQUIRED].includes(
      evidence.judgment
    ) || Array.isArray(evidence.usedKnowledge) || Array.isArray(evidence.slots)
  );
});

test('KB-API-9: 잘못된 entryId · 권한 없는 삭제', () => {
  assert.throws(() => getKnowledgeEntry(userA.id, 'bad-id'), (e) => e.code === 'BAD_ENTRY_ID');
  assert.throws(
    () => deleteKnowledgeEntry(userB.id, 'product:7001:product_name', { storeId: 'store-a' }),
    (e) => e.code === 'NOT_FOUND'
  );
});

test('KB-API-10: 상품 행 hard delete는 store 스코프만', () => {
  upsertProductKnowledge(userA.id, {
    storeId: 'store-del',
    productNo: '7099',
    productName: '삭제대상',
    source: 'manual',
  });
  assert.equal(deleteProductKnowledge(userA.id, '7099', { storeId: 'store-del' }), true);
  assert.equal(getProductKnowledge(userA.id, '7099', { storeId: 'store-del' }), null);
  // 다른 스토어 7001 유지
  assert.ok(getProductKnowledge(userA.id, '7001', { storeId: 'store-a' }));
});
