import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-entries-'));
process.env.DATA_DIR = tempDir;
process.env.DB_PATH = path.join(tempDir, 'app.db');

const {
  closeDbForTests,
  createUser,
  upsertProductKnowledge,
  getProductKnowledge,
  upsertStorePolicies,
  getStorePolicies,
  createInquiryConfirmation,
  approveInquiryFact,
  getInquiryConfirmation,
  checkKbLinkSync,
} = await import('../db.js');

const {
  parseKnowledgeEntryId,
  getKnowledgeSummary,
  listKnowledgeEntries,
  getKnowledgeEntry,
  patchKnowledgeEntry,
  deleteKnowledgeEntry,
} = await import('../knowledge-entries.js');

let userA;
let userB;

before(() => {
  userA = createUser(`entries-a-${Date.now()}@example.com`, 'hash');
  userB = createUser(`entries-b-${Date.now()}@example.com`, 'hash');
});

after(() => {
  closeDbForTests();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('entryId 파싱: 정상·오류', () => {
  assert.deepEqual(parseKnowledgeEntryId('product:9417:specs'), {
    entryId: 'product:9417:specs',
    type: 'product',
    productNo: '9417',
    field: 'specs',
  });
  assert.equal(parseKnowledgeEntryId('policy:shipping').type, 'policy');
  assert.equal(parseKnowledgeEntryId('faq:42').confirmationId, 42);
  assert.throws(() => parseKnowledgeEntryId('nope'), /entryId/);
  assert.throws(() => parseKnowledgeEntryId('product:1:unknown'), /필드/);
});

test('상품 필드 하나만 수정·삭제해도 다른 필드 유지', () => {
  upsertProductKnowledge(userA.id, {
    productNo: '88001',
    productName: '테스트상품',
    specs: 'EPA 500',
    usage: '하루 1포',
    cautions: '임산부 주의',
    source: 'manual',
  });

  patchKnowledgeEntry(userA.id, 'product:88001:specs', { content: 'EPA 600mg' });
  let kb = getProductKnowledge(userA.id, '88001');
  assert.equal(kb.specs, 'EPA 600mg');
  assert.equal(kb.usage, '하루 1포');
  assert.equal(kb.cautions, '임산부 주의');

  deleteKnowledgeEntry(userA.id, 'product:88001:usage');
  kb = getProductKnowledge(userA.id, '88001');
  assert.equal(kb.usage, '');
  assert.equal(kb.specs, 'EPA 600mg');
  assert.equal(kb.cautions, '임산부 주의');
  assert.equal(kb.productName, '테스트상품');
});

test('정책 필드 하나만 삭제해도 다른 정책 유지', () => {
  upsertStorePolicies(userA.id, {
    shipping: '2~3일 출고',
    refund: '7일 환불',
    exchangeReturn: '7일 교환',
    customerService: '평일 10-18시',
  });
  deleteKnowledgeEntry(userA.id, 'policy:shipping');
  const pol = getStorePolicies(userA.id);
  assert.equal(pol.shipping, '');
  assert.equal(pol.refund, '7일 환불');
  assert.equal(pol.exchangeReturn, '7일 교환');
  assert.equal(pol.customerService, '평일 10-18시');
});

test('FAQ 삭제 시 연결된 KB는 기본 유지', () => {
  upsertProductKnowledge(userA.id, {
    productNo: '88002',
    productName: 'FAQ상품',
    extra: '',
    source: 'manual',
  });
  const conf = createInquiryConfirmation(userA.id, {
    productNo: '88002',
    productName: 'FAQ상품',
    question: '콜라겐 들어있나요?',
    reason: '확인',
    draftReply: '확인 중',
  });
  const approved = approveInquiryFact(userA.id, conf.id, {
    mode: 'mirror',
    field: 'extra',
    value: '콜라겐 미포함',
    productNo: '88002',
  });
  assert.ok(approved.item.extra.includes('콜라겐'));
  assert.equal(checkKbLinkSync(userA.id, approved.confirmation).synced, true);

  deleteKnowledgeEntry(userA.id, `faq:${approved.confirmation.id}`);
  assert.equal(getInquiryConfirmation(userA.id, approved.confirmation.id), null);
  assert.match(getProductKnowledge(userA.id, '88002').extra, /콜라겐/);
});

test('KB 필드 수정 시 mirror FAQ는 conflict·동기화 불일치', () => {
  upsertProductKnowledge(userA.id, {
    productNo: '88003',
    productName: '동기화상품',
    usage: '하루 1포',
    source: 'manual',
  });
  const conf = createInquiryConfirmation(userA.id, {
    productNo: '88003',
    question: '사용법?',
    reason: '확인',
  });
  const approved = approveInquiryFact(userA.id, conf.id, {
    mode: 'mirror',
    field: 'usage',
    value: '하루 1포',
    productNo: '88003',
  });
  assert.equal(approved.confirmation.trustStatus, 'approved');

  patchKnowledgeEntry(userA.id, 'product:88003:usage', { content: '하루 2포' });
  const faq = getInquiryConfirmation(userA.id, approved.confirmation.id);
  assert.equal(faq.trustStatus, 'conflict');
  assert.equal(checkKbLinkSync(userA.id, faq).synced, false);

  const entry = getKnowledgeEntry(userA.id, `faq:${faq.id}`);
  assert.equal(entry.kbSync.synced, false);
});

test('만료·미승인 지식이 요약·목록에 표시', () => {
  upsertProductKnowledge(userA.id, {
    productNo: '88004',
    productName: '만료상품',
    specs: '구스펙',
    source: 'NAVER_PRODUCT',
    trustStatus: 'unverified',
    verifiedAt: null,
    validFrom: '2020-01-01',
    validTo: '2020-12-31',
    fieldMeta: {
      specs: {
        source: 'NAVER_PRODUCT',
        trustStatus: 'unverified',
        validFrom: '2020-01-01',
        validTo: '2020-12-31',
      },
    },
  });
  const summary = getKnowledgeSummary(userA.id);
  assert.ok(summary.expired >= 1);
  assert.ok(summary.unverified >= 1);

  const listed = listKnowledgeEntries(userA.id, {
    productNo: '88004',
    type: 'product',
  });
  assert.ok(listed.items.some((e) => e.effectiveStatus === 'expired'));
  assert.ok(listed.items.some((e) => e.trustStatus === 'unverified'));
  assert.ok(listed.items.every((e) => e.usableAsFact === false));
});

test('사용자 A/B 격리 및 IDOR 차단', () => {
  upsertProductKnowledge(userA.id, {
    productNo: '88005',
    productName: 'A전용',
    specs: 'A스펙',
  });
  upsertProductKnowledge(userB.id, {
    productNo: '88005',
    productName: 'B전용',
    specs: 'B스펙',
  });

  const aEntry = getKnowledgeEntry(userA.id, 'product:88005:specs');
  assert.equal(aEntry.content, 'A스펙');

  assert.throws(() => getKnowledgeEntry(userB.id, 'product:88005:usage'), /찾을 수 없습니다|내용/);
  assert.throws(() => patchKnowledgeEntry(userB.id, 'product:99999:specs', { content: '해킹' }), /./);

  const conf = createInquiryConfirmation(userA.id, {
    productNo: '88005',
    question: 'A질문',
  });
  assert.throws(() => getKnowledgeEntry(userB.id, `pending:${conf.id}`), /찾을 수 없습니다/);
  assert.throws(() => deleteKnowledgeEntry(userB.id, `pending:${conf.id}`), /찾을 수 없습니다/);
});

test('잘못된 entryId는 400 계열', () => {
  assert.throws(() => getKnowledgeEntry(userA.id, 'bad'), (err) => err.code === 'BAD_ENTRY_ID');
  assert.throws(() => patchKnowledgeEntry(userA.id, 'policy:unknown', { content: 'x' }), (err) =>
    ['BAD_ENTRY_ID', 'BAD_FIELD'].includes(err.code)
  );
});

test('summary·entries 페이지네이션·필터', () => {
  const summary = getKnowledgeSummary(userA.id);
  assert.ok(summary.total >= 1);
  assert.ok(typeof summary.productFields === 'number');

  const page1 = listKnowledgeEntries(userA.id, { limit: 2, page: 1 });
  assert.equal(page1.items.length <= 2, true);
  assert.ok(page1.total >= page1.items.length);

  const faqs = listKnowledgeEntries(userA.id, { type: 'faq' });
  assert.ok(faqs.items.every((e) => e.type === 'faq'));
});

test('확인 필요 pending dismiss(삭제) 동작', () => {
  const conf = createInquiryConfirmation(userA.id, {
    productNo: '88001',
    question: 'dismiss 테스트',
  });
  const result = deleteKnowledgeEntry(userA.id, `pending:${conf.id}`);
  assert.equal(result.dismissed, true);
  assert.equal(getInquiryConfirmation(userA.id, conf.id).status, 'dismissed');
});
