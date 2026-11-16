import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-db-'));
process.env.DATA_DIR = tempDir;
process.env.DB_PATH = path.join(tempDir, 'app.db');

const {
  closeDbForTests,
  createUser,
  getDb,
  migrateKnowledgeTables,
  upsertProductKnowledge,
  getProductKnowledge,
  listProductKnowledge,
  deleteProductKnowledge,
  upsertStorePolicies,
  getStorePolicies,
  mergeProductKnowledgeField,
  createInquiryConfirmation,
  listInquiryConfirmations,
  updateInquiryConfirmationStatus,
  approveInquiryFact,
  dismissInquiryConfirmation,
  checkKbLinkSync,
} = await import('../db.js');
import { contentHash } from '../knowledge-meta.js';


let userA;
let userB;

before(() => {
  userA = createUser(`a-${Date.now()}@example.com`, 'hash');
  userB = createUser(`b-${Date.now()}@example.com`, 'hash');
});

after(() => {
  closeDbForTests();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('동일 productNo라도 판매자별로 격리된다', () => {
  upsertProductKnowledge(userA.id, {
    productNo: '12345',
    productName: 'A상품',
    specs: 'A스펙',
  });
  upsertProductKnowledge(userB.id, {
    productNo: '12345',
    productName: 'B상품',
    specs: 'B스펙',
  });

  assert.equal(getProductKnowledge(userA.id, '12345').specs, 'A스펙');
  assert.equal(getProductKnowledge(userB.id, '12345').specs, 'B스펙');
  assert.equal(listProductKnowledge(userA.id).length, 1);
  assert.equal(getProductKnowledge(userA.id, '999'), null);
});

test('스토어 정책과 승인 merge가 user 스코프로 동작한다', () => {
  upsertStorePolicies(userA.id, { shipping: '2~3일', refund: '7일' });
  assert.equal(getStorePolicies(userA.id).shipping, '2~3일');
  assert.equal(getStorePolicies(userB.id), null);

  const merged = mergeProductKnowledgeField(userA.id, '12345', 'extra', '판매자 확인: 무설탕', {
    source: 'seller_approved',
  });
  assert.match(merged.extra, /무설탕/);
  assert.equal(merged.source, 'seller_approved');
  assert.ok(merged.verifiedAt);
});

test('확인 필요 기록 생성·승인 상태 변경', () => {
  const row = createInquiryConfirmation(userA.id, {
    productNo: '12345',
    question: '성분이요',
    missingFields: '성분·재질·사양',
    reason: 'KB 부족',
    draftReply: '확인 후 안내드리겠습니다.',
  });
  assert.equal(row.status, 'needs_confirm');
  const listed = listInquiryConfirmations(userA.id, { status: 'needs_confirm' });
  assert.ok(listed.some((item) => item.id === row.id));
  const approved = updateInquiryConfirmationStatus(userA.id, row.id, 'approved');
  assert.equal(approved.status, 'approved');
  assert.equal(updateInquiryConfirmationStatus(userB.id, row.id, 'dismissed'), null);
});

test('삭제도 본인 것만 된다', () => {
  assert.equal(deleteProductKnowledge(userB.id, '12345'), true);
  assert.equal(getProductKnowledge(userA.id, '12345').productNo, '12345');
});

test('메타 컬럼: 레거시 수동 저장은 approved, 자동수집은 unverified', () => {
  const manual = upsertProductKnowledge(userA.id, {
    productNo: '77701',
    productName: '메타테스트',
    specs: '비타민C',
    source: 'manual',
  });
  assert.equal(manual.trustStatus, 'approved');
  assert.equal(manual.sourceNormalized, 'MANUAL');
  assert.equal(manual.effective, true);
  assert.ok(manual.fieldMeta);
  assert.equal(typeof manual.field_meta_json, 'string');

  const scraped = upsertProductKnowledge(userA.id, {
    productNo: '77702',
    productName: '수집상품',
    specs: '미검증스펙',
    source: 'NAVER_PRODUCT',
    verifiedAt: null,
  });
  assert.equal(scraped.trustStatus, 'unverified');
  assert.equal(scraped.sourceNormalized, 'NAVER_PRODUCT');
});

test('valid_from > valid_to 저장 거부', () => {
  assert.throws(() =>
    upsertProductKnowledge(userA.id, {
      productNo: '77703',
      productName: '기간오류',
      validFrom: '2026-12-31',
      validTo: '2026-01-01',
    })
  );
});

test('정책 field_meta_json 보존·하위호환', () => {
  const pol = upsertStorePolicies(userA.id, {
    shipping: '2~3일',
    refund: '7일',
    fieldMeta: {
      shipping: { source: 'STORE_POLICY', trustStatus: 'approved', validTo: null },
    },
  });
  assert.equal(pol.shipping, '2~3일');
  assert.equal(pol.fieldMeta.shipping.trustStatus, 'approved');
  assert.equal(pol.trustStatus, 'approved');
});

test('자동수집 upsert가 승인된 field_meta·본문을 덮어쓰지 않는다', () => {
  upsertProductKnowledge(userA.id, {
    productNo: '77710',
    productName: '승인보존',
    specs: '판매자승인스펙',
    source: 'seller_approved',
    fieldMeta: {
      specs: { source: 'SELLER_APPROVED', trustStatus: 'approved' },
    },
  });
  const afterScrape = upsertProductKnowledge(userA.id, {
    productNo: '77710',
    productName: '승인보존',
    specs: '수집스펙',
    source: 'NAVER_PRODUCT',
    verifiedAt: null,
  });
  assert.equal(afterScrape.specs, '판매자승인스펙');
  assert.equal(afterScrape.fieldMeta.specs.trustStatus, 'conflict');
  assert.equal(afterScrape.fieldMeta.specs.scrapedValue, '수집스펙');
  assert.equal(afterScrape.source, 'seller_approved');
  assert.equal(afterScrape.trustStatus, 'approved');
});

test('migrateKnowledgeTables 두 번 실행해도 안전하다', () => {
  const db = getDb();
  migrateKnowledgeTables(db);
  migrateKnowledgeTables(db);
  const before = getProductKnowledge(userA.id, '77701');
  assert.ok(before);
  migrateKnowledgeTables(db);
  const after = getProductKnowledge(userA.id, '77701');
  assert.equal(after.specs, before.specs);
  assert.equal(after.productName, before.productName);
});

test('approve-fact mirror: FAQ+KB 원자 승인 및 contentHash', () => {
  const row = createInquiryConfirmation(userA.id, {
    productNo: '88801',
    productName: '미러상품',
    question: '1+1인가요?',
  });
  const result = approveInquiryFact(userA.id, row.id, {
    mode: 'mirror',
    field: 'extra',
    value: '네, 1+1 구성입니다.',
    productNo: '88801',
  });
  assert.equal(result.mode, 'mirror');
  assert.equal(result.confirmation.status, 'approved');
  assert.equal(result.confirmation.approvedAnswer, '네, 1+1 구성입니다.');
  assert.equal(result.confirmation.kbLink.mode, 'mirror');
  assert.ok(result.item.extra.includes('1+1'));
  assert.equal(result.item.fieldMeta.extra.trustStatus, 'approved');
  assert.equal(result.item.fieldMeta.extra.contentHash, contentHash(result.item.extra));
  assert.equal(checkKbLinkSync(userA.id, result.confirmation).synced, true);
  assert.throws(() =>
    approveInquiryFact(userB.id, row.id, { value: 'x', productNo: '88801' })
  );
});

test('approve-fact mirror 실패 시 confirmation 롤백', () => {
  const row = createInquiryConfirmation(userA.id, {
    productNo: '88802',
    question: '롤백테스트',
  });
  assert.throws(() =>
    approveInquiryFact(userA.id, row.id, {
      mode: 'mirror',
      field: 'not_a_real_field',
      value: '값',
      productNo: '88802',
    })
  );
  const again = listInquiryConfirmations(userA.id, { status: 'needs_confirm' });
  assert.ok(again.some((item) => item.id === row.id));
  assert.equal(getProductKnowledge(userA.id, '88802'), null);
});

test('approve-fact faq_only: KB 없이 FAQ만 승인', () => {
  const row = createInquiryConfirmation(userA.id, {
    productNo: '88803',
    question: 'FAQ only',
  });
  const result = approveInquiryFact(userA.id, row.id, {
    mode: 'faq_only',
    value: '직접 입력한 답만 저장',
    productNo: '88803',
  });
  assert.equal(result.mode, 'faq_only');
  assert.equal(result.item, null);
  assert.equal(result.confirmation.kbLink.mode, 'faq_only');
  assert.equal(getProductKnowledge(userA.id, '88803'), null);
});

test('dismiss: needs_confirm만 가능, approved는 409', () => {
  const row = createInquiryConfirmation(userA.id, {
    productNo: '88804',
    question: '무시할 질문',
  });
  const dismissed = dismissInquiryConfirmation(userA.id, row.id, { reason: '중복' });
  assert.equal(dismissed.status, 'dismissed');
  assert.equal(dismissed.dismissReason, '중복');

  const approvedRow = createInquiryConfirmation(userA.id, {
    productNo: '88805',
    question: '승인후무시금지',
  });
  approveInquiryFact(userA.id, approvedRow.id, {
    mode: 'faq_only',
    value: '승인됨',
  });
  assert.throws(() => dismissInquiryConfirmation(userA.id, approvedRow.id, { reason: 'x' }));
  assert.throws(() => dismissInquiryConfirmation(userB.id, row.id, { reason: 'x' }));
});

