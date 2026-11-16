/**
 * 3-7 사용자·스토어 격리 (임시 SQLite · 운영 DB 미사용).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-rel-37-'));
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
  approveInquiryFact,
  listInquiryConfirmations,
  getInquiryConfirmation,
} = await import('../db.js');

const {
  listKnowledgeEntries,
  getKnowledgeEntry,
  patchKnowledgeEntry,
  deleteKnowledgeEntry,
} = await import('../knowledge-entries.js');

let userA;
let userB;

before(() => {
  userA = createUser(`rel37-a-${Date.now()}@example.com`, 'hash');
  userB = createUser(`rel37-b-${Date.now()}@example.com`, 'hash');
});

after(() => {
  closeDbForTests();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('3-7 격리: 동일 productNo라도 사용자 A/B KB 내용 분리', () => {
  upsertProductKnowledge(userA.id, {
    productNo: '77001',
    productName: 'A상품',
    specs: 'A-only-specs',
    source: 'manual',
  });
  upsertProductKnowledge(userB.id, {
    productNo: '77001',
    productName: 'B상품',
    specs: 'B-only-specs',
    source: 'manual',
  });

  assert.equal(getProductKnowledge(userA.id, '77001').specs, 'A-only-specs');
  assert.equal(getProductKnowledge(userB.id, '77001').specs, 'B-only-specs');
  assert.ok(listProductKnowledge(userA.id).every((r) => r.specs !== 'B-only-specs'));
  assert.ok(listProductKnowledge(userB.id).every((r) => r.specs !== 'A-only-specs'));
});

test('3-7 격리: 스토어 정책 user 스코프', () => {
  upsertStorePolicies(userA.id, {
    shipping: 'A배송정책',
    source: 'manual',
  });
  upsertStorePolicies(userB.id, {
    shipping: 'B배송정책',
    source: 'manual',
  });
  assert.equal(getStorePolicies(userA.id).shipping, 'A배송정책');
  assert.equal(getStorePolicies(userB.id).shipping, 'B배송정책');
});

test('3-7 격리: FAQ/목록·상세·수정·삭제 IDOR 차단', () => {
  const conf = createInquiryConfirmation(userA.id, {
    productNo: '77001',
    question: 'A비밀질문',
  });
  const approved = approveInquiryFact(userA.id, conf.id, {
    value: 'A승인답',
    field: 'extra',
    productNo: '77001',
  });

  const faqEntryId = `faq:${approved.confirmation.id}`;
  const aList = listKnowledgeEntries(userA.id, { type: 'faq' });
  assert.ok(
    aList.items.some(
      (e) => e.entryId === faqEntryId || String(e.confirmationId) === String(approved.confirmation.id)
    )
  );

  const bList = listKnowledgeEntries(userB.id, { type: 'faq' });
  assert.ok(
    !bList.items.some(
      (e) => e.entryId === faqEntryId || String(e.confirmationId) === String(approved.confirmation.id)
    )
  );

  assert.throws(() => getKnowledgeEntry(userB.id, faqEntryId), /찾을 수 없습니다/);
  assert.throws(() => patchKnowledgeEntry(userB.id, faqEntryId, { content: '해킹' }), /./);
  assert.throws(() => deleteKnowledgeEntry(userB.id, faqEntryId), /./);

  assert.equal(getInquiryConfirmation(userB.id, approved.confirmation.id), null);
  const bFaqs = listInquiryConfirmations(userB.id, { status: 'approved' }) || [];
  assert.ok(!bFaqs.some((f) => f.id === approved.confirmation.id));
});

test('3-7 격리: 존재하지 않는 entryId 안전 거부', () => {
  assert.throws(() => getKnowledgeEntry(userA.id, 'product:00000:specs'), /찾을 수 없습니다|내용/);
  assert.throws(() => getKnowledgeEntry(userA.id, 'faq:99999999'), /찾을 수 없습니다/);
});
