import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveInquiryEvidence } from '../evidence.js';
import {
  JUDGMENT,
  filterApprovedFaqs,
  finalizeInquiryJudgment,
  faqConflictsWithKb,
  pickVerifiedKbSnippets,
  resolveFaqGroup,
} from '../knowledge-judge.js';
import { buildInquiryUserContent } from '../prompts.js';

const NOW = new Date('2026-06-15T00:00:00+09:00');

function approvedProduct(overrides = {}) {
  return {
    product_no: '1001',
    usage: '하루 1포',
    specs: 'EPA 500mg',
    source: 'manual',
    verified_at: '2026-01-01',
    trust_status: 'approved',
    ...overrides,
  };
}

test('상품 격리: 다른 productNo FAQ는 검색에서 제외', () => {
  const faqs = [
    {
      id: 1,
      status: 'approved',
      trustStatus: 'approved',
      source: 'SELLER_APPROVED',
      productNo: '9999',
      question: '사용법 알려주세요',
      approvedAnswer: '하루 2포',
      approvedAt: '2026-01-01',
    },
    {
      id: 2,
      status: 'approved',
      trustStatus: 'approved',
      source: 'SELLER_APPROVED',
      productNo: '1001',
      question: '사용법 알려주세요',
      approvedAnswer: '하루 1포',
      approvedAt: '2026-01-02',
    },
  ];
  const usable = filterApprovedFaqs(faqs, {
    productNo: '1001',
    question: '사용법이 어떻게 되나요?',
    now: NOW,
  });
  assert.equal(usable.length, 1);
  assert.equal(usable[0].faq.id, 2);
});

test('승인 FAQ 검색: 승인·유효 FAQ만 근거로 쓰고 usedKnowledge에 기록', () => {
  const ev = resolveInquiryEvidence({
    row: { content: '사용법이 어떻게 되나요?', productNo: '1001' },
    productKnowledge: approvedProduct({ usage: '' }),
    productMatchStatus: 'exact',
    approvedFaqs: [
      {
        id: 10,
        status: 'approved',
        trustStatus: 'approved',
        source: 'SELLER_APPROVED',
        productNo: '1001',
        question: '사용법 문의',
        approvedAnswer: '하루 1포 물과 함께',
        approvedAt: '2026-01-01',
      },
    ],
    now: NOW,
  });
  assert.equal(ev.judgment, JUDGMENT.ANSWERABLE);
  assert.equal(ev.needsSellerConfirm, false);
  assert.match(ev.verifiedFacts.join('\n'), /하루 1포/);
  assert.ok(ev.usedKnowledge.some((u) => u.type === 'faq' && u.id === '10'));
});

test('유효기간: 만료된 KB·FAQ는 확정 근거 금지', () => {
  const expiredProduct = approvedProduct({
    usage: '하루 1포',
    valid_to: '2026-01-01',
    fieldMeta: {
      usage: { source: 'MANUAL', trustStatus: 'approved', validTo: '2026-01-01' },
    },
  });
  assert.equal(pickVerifiedKbSnippets(expiredProduct, ['usage'], NOW).length, 0);

  const usable = filterApprovedFaqs(
    [
      {
        id: 3,
        status: 'approved',
        trustStatus: 'approved',
        source: 'SELLER_APPROVED',
        productNo: '1001',
        question: '사용법',
        approvedAnswer: '만료된 답',
        approvedAt: '2025-01-01',
        validTo: '2026-01-01',
      },
    ],
    { productNo: '1001', question: '사용법', now: NOW }
  );
  assert.equal(usable.length, 0);

  const ev = resolveInquiryEvidence({
    row: { content: '사용법이 어떻게 되나요?', productNo: '1001' },
    productKnowledge: expiredProduct,
    productMatchStatus: 'exact',
    now: NOW,
  });
  assert.equal(ev.judgment, JUDGMENT.SELLER_CONFIRM);
  assert.match(ev.confirmReason, /승인·유효기간|확인/);
});

test('충돌: 동일 상품 승인 FAQ 답변이 다르면 SELLER_CONFIRM', () => {
  const group = resolveFaqGroup([
    { score: 0.9, answerNorm: '하루 1포', faq: { id: 1 } },
    { score: 0.8, answerNorm: '하루 2포', faq: { id: 2 } },
  ]);
  assert.equal(group.conflict, true);

  const ev = resolveInquiryEvidence({
    row: { content: '사용법이 어떻게 되나요?', productNo: '1001' },
    productKnowledge: approvedProduct({ usage: '' }),
    productMatchStatus: 'exact',
    approvedFaqs: [
      {
        id: 1,
        status: 'approved',
        trustStatus: 'approved',
        source: 'SELLER_APPROVED',
        productNo: '1001',
        question: '사용법',
        approvedAnswer: '하루 1포',
        approvedAt: '2026-01-01',
      },
      {
        id: 2,
        status: 'approved',
        trustStatus: 'approved',
        source: 'SELLER_APPROVED',
        productNo: '1001',
        question: '사용 방법',
        approvedAnswer: '하루 2포',
        approvedAt: '2026-01-02',
      },
    ],
    now: NOW,
  });
  assert.equal(ev.judgment, JUDGMENT.SELLER_CONFIRM);
  assert.equal(ev.faqConflict, true);
});

test('미승인·HISTORICAL·AI_DERIVED는 단독 확정 근거 금지', () => {
  const product = {
    product_no: '1001',
    usage: '하루 1포',
    source: 'HISTORICAL_QA',
    trust_status: 'unverified',
    verified_at: null,
  };
  assert.equal(pickVerifiedKbSnippets(product, ['usage'], NOW).length, 0);

  const aiDerived = {
    product_no: '1001',
    usage: '하루 1포',
    source: 'AI_DERIVED',
    trust_status: 'unverified',
  };
  assert.equal(pickVerifiedKbSnippets(aiDerived, ['usage'], NOW).length, 0);

  const usable = filterApprovedFaqs(
    [
      {
        id: 4,
        status: 'needs_confirm',
        trustStatus: 'unverified',
        source: 'AI_DERIVED',
        productNo: '1001',
        question: '사용법',
        approvedAnswer: '하루 1포',
      },
      {
        id: 5,
        status: 'approved',
        trustStatus: 'approved',
        source: 'HISTORICAL_REPLY',
        productNo: '1001',
        question: '사용법',
        approvedAnswer: '하루 1포',
        approvedAt: '2026-01-01',
      },
    ],
    { productNo: '1001', question: '사용법', now: NOW }
  );
  assert.equal(usable.length, 0);
});

test('REALTIME_REQUIRED: 주문·송장 질문은 공식 조회 없이 확정 금지', () => {
  const ev = resolveInquiryEvidence({
    row: { content: '제 주문 송장번호 알려주세요', productNo: '1001' },
    productKnowledge: approvedProduct(),
    storePolicies: { shipping: '영업일 2~3일', source: 'manual', verified_at: '2026-01-01' },
    productMatchStatus: 'exact',
    now: NOW,
  });
  assert.equal(ev.judgment, JUDGMENT.REALTIME_REQUIRED);
  assert.equal(ev.realtimeRequired, true);
  assert.equal(ev.needsSellerConfirm, true);
});

test('usedKnowledge: KB hit 시 product 필드가 기록된다', () => {
  const ev = resolveInquiryEvidence({
    row: { content: '사용법이 어떻게 되나요?', productNo: '1001' },
    productKnowledge: approvedProduct(),
    productMatchStatus: 'exact',
    now: NOW,
  });
  assert.equal(ev.judgment, JUDGMENT.ANSWERABLE);
  assert.ok(
    ev.usedKnowledge.some(
      (u) => u.type === 'product' && u.field === 'usage' && u.trustStatus === 'approved'
    )
  );
});

test('FAQ mirror와 KB 본문 불일치 시 충돌', () => {
  const product = approvedProduct({ usage: '하루 1포' });
  const faq = {
    id: 7,
    approvedAnswer: '하루 3포',
    kbLink: {
      mode: 'mirror',
      field: 'usage',
      contentHash: 'deadbeef',
    },
  };
  assert.equal(faqConflictsWithKb(faq, product), true);
});

test('Gemini 프롬프트에 서버 판정 고정 문구가 포함된다', () => {
  const confirm = buildInquiryUserContent(
    { content: '성분 문의', productNo: '1' },
    [],
    { verifiedFacts: [], missingFacts: ['성분'], judgment: 'SELLER_CONFIRM' }
  );
  assert.match(confirm, /SELLER_CONFIRM — 변경 불가/);

  const realtime = buildInquiryUserContent(
    { content: '송장 문의', productNo: '1' },
    [],
    { verifiedFacts: [], missingFacts: ['송장'], judgment: 'REALTIME_REQUIRED' }
  );
  assert.match(realtime, /REALTIME_REQUIRED — 변경 불가/);

  const ok = buildInquiryUserContent(
    { content: '사용법', productNo: '1' },
    [],
    { verifiedFacts: ['[KB:usage] 하루 1포'], missingFacts: [], judgment: 'ANSWERABLE' }
  );
  assert.match(ok, /ANSWERABLE — 변경 불가/);
});

test('finalizeInquiryJudgment: ANSWERABLE은 usedKnowledge와 함께 반환', () => {
  const judged = finalizeInquiryJudgment({
    evidence: {
      needsSellerConfirm: false,
      confirmReason: '',
      verifiedFacts: ['[KB:usage] 하루 1포'],
      sources: [{ type: 'kb', field: 'usage', productNo: '1001', source: 'manual' }],
      slots: [{ key: 'usage', status: 'kb_hit' }],
    },
    productNo: '1001',
    question: '사용법',
    now: NOW,
  });
  assert.equal(judged.judgment, JUDGMENT.ANSWERABLE);
  assert.ok(judged.usedKnowledge.length >= 1);
});
