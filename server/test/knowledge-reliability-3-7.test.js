/**
 * 3-7 지식 신뢰성 검증 (판정 엔진 변경 없음 · 검증 전용).
 * 만료·충돌·상품격리·미승인·실시간·usedKnowledge.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveInquiryEvidence, resolveProductKnowledgeMatch } from '../evidence.js';
import {
  JUDGMENT,
  filterApprovedFaqs,
  finalizeInquiryJudgment,
  pickVerifiedKbSnippets,
  pickVerifiedPolicySnippets,
  resolveFaqGroup,
} from '../knowledge-judge.js';
import {
  canUseAsVerifiedFact,
  isKnowledgeEffective,
} from '../knowledge-meta.js';
import { buildInquiryUserContent } from '../prompts.js';

const NOW = new Date('2026-11-12T15:00:00+09:00'); // KST 2026-11-12
const TODAY = '2026-11-12';

function approvedFaq(overrides = {}) {
  return {
    id: 1,
    status: 'approved',
    trustStatus: 'approved',
    source: 'SELLER_APPROVED',
    productNo: '1001',
    question: '사용법 알려주세요',
    approvedAnswer: '하루 1포',
    approvedAt: '2026-01-01',
    ...overrides,
  };
}

function approvedProduct(overrides = {}) {
  return {
    product_no: '1001',
    productNo: '1001',
    usage: '하루 1포',
    specs: 'EPA 500mg',
    source: 'manual',
    verified_at: '2026-01-01',
    trust_status: 'approved',
    ...overrides,
  };
}

// ——— 1. 만료 / 유효기간 ———

test('3-7 만료: validTo 과거 승인 지식은 근거 제외', () => {
  const now = NOW;
  assert.equal(
    canUseAsVerifiedFact({
      source: 'manual',
      trustStatus: 'approved',
      verifiedAt: 'x',
      validTo: '2026-11-01',
      now,
    }),
    false
  );
  const product = approvedProduct({
    fieldMeta: {
      usage: { source: 'MANUAL', trustStatus: 'approved', validTo: '2026-11-01' },
    },
  });
  assert.equal(pickVerifiedKbSnippets(product, ['usage'], now).length, 0);
  const usable = filterApprovedFaqs(
    [approvedFaq({ id: 11, validTo: '2026-11-01', approvedAnswer: '만료답' })],
    { productNo: '1001', question: '사용법', now }
  );
  assert.equal(usable.length, 0);
});

test('3-7 만료: validFrom 미래(not_yet) 지식은 근거 제외', () => {
  const now = NOW;
  const eff = isKnowledgeEffective({ validFrom: '2026-12-01' }, now);
  assert.equal(eff.effective, false);
  assert.equal(eff.effectiveStatus, 'not_yet');
  assert.equal(
    canUseAsVerifiedFact({
      source: 'manual',
      trustStatus: 'approved',
      verifiedAt: 'x',
      validFrom: '2026-12-01',
      now,
    }),
    false
  );
  const usable = filterApprovedFaqs(
    [approvedFaq({ id: 12, validFrom: '2026-12-01', approvedAnswer: '미래답' })],
    { productNo: '1001', question: '사용법', now }
  );
  assert.equal(usable.length, 0);
  const product = approvedProduct({
    fieldMeta: {
      usage: { source: 'MANUAL', trustStatus: 'approved', validFrom: '2026-12-01' },
    },
  });
  assert.equal(pickVerifiedKbSnippets(product, ['usage'], now).length, 0);
});

test('3-7 만료: validTo가 오늘(KST)이면 경계상 유효(포함)', () => {
  const now = NOW;
  const eff = isKnowledgeEffective({ validTo: TODAY }, now);
  assert.equal(eff.effective, true);
  assert.equal(eff.effectiveStatus, 'active');
  assert.equal(
    canUseAsVerifiedFact({
      source: 'manual',
      trustStatus: 'approved',
      verifiedAt: 'x',
      validTo: TODAY,
      now,
    }),
    true
  );
  const usable = filterApprovedFaqs(
    [approvedFaq({ id: 13, validTo: TODAY, approvedAnswer: '오늘까지유효' })],
    { productNo: '1001', question: '사용법', now }
  );
  assert.equal(usable.length, 1);
});

test('3-7 만료: validFrom/validTo null 무기한은 사용 가능', () => {
  const now = NOW;
  const eff = isKnowledgeEffective({}, now);
  assert.equal(eff.effective, true);
  assert.equal(eff.effectiveStatus, 'indefinite');
  assert.equal(
    canUseAsVerifiedFact({
      source: 'manual',
      trustStatus: 'approved',
      verifiedAt: 'x',
      validFrom: null,
      validTo: null,
      now,
    }),
    true
  );
  const usable = filterApprovedFaqs(
    [approvedFaq({ id: 14, validFrom: null, validTo: null })],
    { productNo: '1001', question: '사용법', now }
  );
  assert.equal(usable.length, 1);
});

test('3-7 만료: usedKnowledge에 만료·미도래 FAQ가 들어가지 않는다', () => {
  const judged = finalizeInquiryJudgment({
    evidence: {
      needsSellerConfirm: false,
      verifiedFacts: [],
      sources: [],
      slots: [{ key: 'usage', status: 'seller_confirm' }],
    },
    approvedFaqs: [
      approvedFaq({ id: 21, validTo: '2026-01-01', approvedAnswer: '만료' }),
      approvedFaq({ id: 22, validFrom: '2027-01-01', approvedAnswer: '미래' }),
      approvedFaq({ id: 23, approvedAnswer: '하루 1포 물과' }),
    ],
    productNo: '1001',
    question: '사용법 알려주세요',
    now: NOW,
  });
  assert.equal(judged.judgment, JUDGMENT.ANSWERABLE);
  assert.ok(judged.usedKnowledge.every((u) => u.id === '23' || u.type !== 'faq'));
  assert.ok(judged.usedKnowledge.some((u) => u.type === 'faq' && u.id === '23'));
  assert.ok(!judged.usedKnowledge.some((u) => u.id === '21' || u.id === '22'));
});

// ——— 2. 충돌 ———

test('3-7 충돌: 동일 상품 승인 FAQ 답 다르면 SELLER_CONFIRM·근거 미사용', () => {
  const ev = resolveInquiryEvidence({
    row: { content: '사용법이 어떻게 되나요?', productNo: '1001' },
    productKnowledge: approvedProduct({ usage: '' }),
    productMatchStatus: 'exact',
    approvedFaqs: [
      approvedFaq({ id: 31, approvedAnswer: '하루 1포' }),
      approvedFaq({ id: 32, question: '사용 방법', approvedAnswer: '하루 2포', approvedAt: '2026-02-01' }),
    ],
    now: NOW,
  });
  assert.equal(ev.judgment, JUDGMENT.SELLER_CONFIRM);
  assert.equal(ev.faqConflict, true);
  assert.ok(!ev.usedKnowledge.some((u) => u.type === 'faq'));
});

test('3-7 충돌: FAQ↔KB mirror 불일치 시 SELLER_CONFIRM', () => {
  const product = approvedProduct({ usage: '하루 1포' });
  const ev = resolveInquiryEvidence({
    row: { content: '사용법이 어떻게 되나요?', productNo: '1001' },
    productKnowledge: product,
    productMatchStatus: 'exact',
    approvedFaqs: [
      approvedFaq({
        id: 33,
        approvedAnswer: '하루 9포',
        kbLink: { mode: 'mirror', field: 'usage', contentHash: 'deadbeef' },
      }),
    ],
    now: NOW,
  });
  assert.equal(ev.judgment, JUDGMENT.SELLER_CONFIRM);
  assert.ok(!ev.usedKnowledge.some((u) => u.type === 'faq' && u.id === '33'));
});

test('3-7 충돌: 기간 겹치지 않는(만료) 다른 답 FAQ는 충돌로 보지 않음', () => {
  const usable = filterApprovedFaqs(
    [
      approvedFaq({ id: 41, approvedAnswer: '하루 1포', validTo: null }),
      approvedFaq({
        id: 42,
        question: '사용법',
        approvedAnswer: '하루 2포',
        validTo: '2026-01-01',
        approvedAt: '2025-01-01',
      }),
    ],
    { productNo: '1001', question: '사용법 알려주세요', now: NOW }
  );
  assert.equal(usable.length, 1);
  const group = resolveFaqGroup(usable);
  assert.equal(group.conflict, false);
  assert.equal(group.representative?.id, 41);
});

test('3-7 충돌: 점수 낮은(비관련) 다른 답 FAQ만으로 무조건 충돌하지 않음', () => {
  const group = resolveFaqGroup([
    { score: 0.9, answerNorm: '하루 1포', faq: { id: 1 } },
    { score: 0.1, answerNorm: '완전 다른 답', faq: { id: 2 } },
  ]);
  assert.equal(group.conflict, false);
  assert.equal(group.representative?.id, 1);
});

test('3-7 충돌: 상품 KB가 있으면 공통 스토어 정책보다 우선', () => {
  const ev = resolveInquiryEvidence({
    row: { content: '배송비 정책이 어떻게 되나요? 영업일 기준인가요?', productNo: '1001' },
    productKnowledge: approvedProduct({
      extra: '이 상품만 무료배송 예외 적용',
      usage: '',
      specs: '',
    }),
    storePolicies: {
      shipping: '기본 3000원',
      source: 'manual',
      verified_at: '2026-01-01',
      trust_status: 'approved',
    },
    productMatchStatus: 'exact',
    now: NOW,
  });
  // shipping_policy 슬롯: KB extra가 정책 필드가 아니면 policy 사용 가능.
  // 상품 예외는 usage/specs 등 kbFields 우선 — 배송 슬롯은 policyFields만.
  // 설계: kbSnippets 있으면 policy 스킵은 kbFields 슬롯에 한함.
  const usageEv = resolveInquiryEvidence({
    row: { content: '사용법이 어떻게 되나요?', productNo: '1001' },
    productKnowledge: approvedProduct({ usage: '상품별 하루 2포 예외' }),
    storePolicies: {
      customer_service: '하루 1포 권장(공통)',
      source: 'manual',
      verified_at: '2026-01-01',
    },
    productMatchStatus: 'exact',
    now: NOW,
  });
  assert.equal(usageEv.judgment, JUDGMENT.ANSWERABLE);
  assert.ok(usageEv.verifiedFacts.some((f) => /상품별 하루 2포/.test(f)));
  assert.ok(usageEv.usedKnowledge.some((u) => u.type === 'product' && u.field === 'usage'));
});

// ——— 3. 상품번호 격리 ———

test('3-7 상품격리: A문의에 B FAQ/KB 미사용', () => {
  const usable = filterApprovedFaqs(
    [
      approvedFaq({ id: 51, productNo: '11110001', approvedAnswer: 'A답' }),
      approvedFaq({ id: 52, productNo: '22220002', approvedAnswer: 'B답' }),
    ],
    { productNo: '11110001', question: '사용법', now: NOW }
  );
  assert.equal(usable.length, 1);
  assert.equal(usable[0].faq.id, 51);

  const kbA = pickVerifiedKbSnippets(
    approvedProduct({ product_no: '11110001', usage: 'A사용' }),
    ['usage'],
    NOW
  );
  const kbB = pickVerifiedKbSnippets(
    approvedProduct({ product_no: '22220002', usage: 'B사용' }),
    ['usage'],
    NOW
  );
  assert.ok(kbA.every((s) => String(s.id).includes('11110001')));
  assert.ok(kbB.every((s) => String(s.id).includes('22220002')));
});

test('3-7 상품격리: 비숫자 productNo는 FAQ 확정 후보에서 제외 (3-9 교정)', () => {
  const usable = filterApprovedFaqs(
    [
      approvedFaq({ id: 53, productNo: 'PROD-A', approvedAnswer: 'A답' }),
      approvedFaq({ id: 54, productNo: 'PROD-B', approvedAnswer: 'B답' }),
    ],
    { productNo: 'PROD-A', question: '사용법', now: NOW }
  );
  assert.equal(usable.length, 0);
});

test('3-7 상품격리: productNo 없으면 상품명만으로 KB 확정 금지', () => {
  const match = resolveProductKnowledgeMatch({
    userId: 1,
    productNo: '',
    productName: '아밀리 효소 펫치약',
    listByUser: () => [
      { product_no: '10380586205', product_name: '아밀리 효소 펫치약' },
    ],
    getByProductNo: () => null,
  });
  assert.equal(match.status, 'seller_confirm');
  assert.equal(match.product, null);
  assert.match(match.reason, /상품번호/);
});

test('3-7 상품격리: 잘못된 productNo는 seller_confirm', () => {
  const match = resolveProductKnowledgeMatch({
    userId: 1,
    productNo: '999999',
    productName: '아무거나',
    getByProductNo: () => null,
  });
  assert.equal(match.status, 'seller_confirm');
  assert.match(match.reason, /상품번호에 해당하는/);
});

test('3-7 상품격리: usedKnowledge에 타 상품 FAQ 미포함', () => {
  const judged = finalizeInquiryJudgment({
    evidence: {
      needsSellerConfirm: false,
      verifiedFacts: [],
      sources: [],
      slots: [{ key: 'usage', status: 'seller_confirm' }],
    },
    approvedFaqs: [
      approvedFaq({ id: 61, productNo: '1001', approvedAnswer: '하루 1포 물과' }),
      approvedFaq({ id: 62, productNo: '2002', question: '사용법', approvedAnswer: '타상품 답' }),
    ],
    productNo: '1001',
    question: '사용법 알려주세요',
    now: NOW,
  });
  assert.ok(judged.usedKnowledge.every((u) => !u.productNo || String(u.productNo) === '1001'));
  assert.ok(!judged.usedKnowledge.some((u) => u.id === '62'));
});

// ——— 4. 미승인 / 출처 ———

test('3-7 미승인: NAVER_PRODUCT unverified·HISTORICAL·AI_DERIVED·dismissed·conflict 차단', () => {
  assert.equal(
    canUseAsVerifiedFact({ source: 'NAVER_PRODUCT', trustStatus: 'unverified' }),
    false
  );
  assert.equal(
    canUseAsVerifiedFact({ source: 'HISTORICAL_QA', trustStatus: 'approved', verifiedAt: 'x' }),
    false
  );
  assert.equal(
    canUseAsVerifiedFact({ source: 'HISTORICAL_REPLY', trustStatus: 'approved', verifiedAt: 'x' }),
    false
  );
  assert.equal(
    canUseAsVerifiedFact({ source: 'AI_DERIVED', trustStatus: 'approved', verifiedAt: 'x' }),
    false
  );
  assert.equal(
    canUseAsVerifiedFact({ source: 'manual', trustStatus: 'dismissed', verifiedAt: 'x' }),
    false
  );
  assert.equal(
    canUseAsVerifiedFact({ source: 'manual', trustStatus: 'conflict', verifiedAt: 'x' }),
    false
  );

  assert.equal(
    pickVerifiedKbSnippets(
      {
        product_no: '1001',
        usage: '자동수집',
        source: 'NAVER_PRODUCT',
        trust_status: 'unverified',
      },
      ['usage'],
      NOW
    ).length,
    0
  );

  const usable = filterApprovedFaqs(
    [
      {
        id: 71,
        status: 'approved',
        trustStatus: 'dismissed',
        source: 'SELLER_APPROVED',
        productNo: '1001',
        question: '사용법',
        approvedAnswer: '무시됨',
        approvedAt: '2026-01-01',
      },
      {
        id: 72,
        status: 'approved',
        trustStatus: 'conflict',
        source: 'SELLER_APPROVED',
        productNo: '1001',
        question: '사용법',
        approvedAnswer: '충돌',
        approvedAt: '2026-01-01',
      },
      {
        id: 73,
        status: 'approved',
        trustStatus: 'approved',
        source: 'AI_DERIVED',
        productNo: '1001',
        question: '사용법',
        approvedAnswer: 'AI추정',
        approvedAt: '2026-01-01',
      },
      {
        id: 74,
        status: 'approved',
        trustStatus: 'unverified',
        source: 'NAVER_PRODUCT',
        productNo: '1001',
        question: '사용법',
        approvedAnswer: '네이버수집',
        approvedAt: '2026-01-01',
      },
    ],
    { productNo: '1001', question: '사용법', now: NOW }
  );
  assert.equal(usable.length, 0);
});

test('3-7 미승인: KB field trustStatus conflict/dismissed는 스니펫 제외', () => {
  const product = approvedProduct({
    usage: '하루 1포',
    fieldMeta: {
      usage: { source: 'MANUAL', trustStatus: 'conflict' },
    },
  });
  assert.equal(pickVerifiedKbSnippets(product, ['usage'], NOW).length, 0);

  const dismissed = approvedProduct({
    usage: '하루 1포',
    fieldMeta: {
      usage: { source: 'MANUAL', trustStatus: 'dismissed' },
    },
  });
  assert.equal(pickVerifiedKbSnippets(dismissed, ['usage'], NOW).length, 0);
});

test('3-7 미승인: 승인+유효+비금지출처만 사용', () => {
  assert.equal(
    canUseAsVerifiedFact({
      source: 'SELLER_APPROVED',
      trustStatus: 'approved',
      verifiedAt: 'x',
      now: NOW,
    }),
    true
  );
  const usable = filterApprovedFaqs(
    [approvedFaq({ id: 80, source: 'SELLER_APPROVED' })],
    { productNo: '1001', question: '사용법', now: NOW }
  );
  assert.equal(usable.length, 1);
});

// ——— 5. 실시간 ———

test('3-7 실시간: 송장·출고·재고·품절은 REALTIME_REQUIRED', () => {
  const cases = [
    '제 주문 송장번호 알려주세요',
    '출고 됐나요?',
    '지금 재고 있나요?',
    '샴푸 품절인데 언제 들어오나요?',
    '내 주문 언제 발송되나요?',
  ];
  for (const content of cases) {
    const ev = resolveInquiryEvidence({
      row: { content, productNo: '1001' },
      productKnowledge: approvedProduct(),
      storePolicies: {
        shipping: '영업일 2~3일',
        source: 'manual',
        verified_at: '2026-01-01',
      },
      productMatchStatus: 'exact',
      now: NOW,
    });
    assert.equal(ev.judgment, JUDGMENT.REALTIME_REQUIRED, content);
    assert.equal(ev.realtimeRequired, true, content);
  }
});

test('3-7 실시간: 일반 배송 정책 질문과 주문 실시간 구분', () => {
  const policyQ = resolveInquiryEvidence({
    row: { content: '무료 배송 정책이 어떻게 되나요? 영업일 기준인가요?', productNo: '1001' },
    productKnowledge: approvedProduct({ usage: '', specs: '' }),
    storePolicies: {
      shipping: '3만원 이상 무료',
      source: 'manual',
      verified_at: '2026-01-01',
      trust_status: 'approved',
    },
    productMatchStatus: 'exact',
    now: NOW,
  });
  assert.notEqual(policyQ.judgment, JUDGMENT.REALTIME_REQUIRED);

  const orderQ = resolveInquiryEvidence({
    row: { content: '내 주문 출고 됐는지 확인해주세요', productNo: '1001' },
    productKnowledge: approvedProduct(),
    storePolicies: {
      shipping: '3만원 이상 무료',
      source: 'manual',
      verified_at: '2026-01-01',
    },
    productMatchStatus: 'exact',
    now: NOW,
  });
  assert.equal(orderQ.judgment, JUDGMENT.REALTIME_REQUIRED);
});

test('3-7 실시간: HISTORICAL_QA만으로 주문 상태 확정 불가', () => {
  const usable = filterApprovedFaqs(
    [
      {
        id: 90,
        status: 'approved',
        trustStatus: 'approved',
        source: 'HISTORICAL_QA',
        productNo: '1001',
        question: '송장번호',
        approvedAnswer: '송장 123456',
        approvedAt: '2026-01-01',
      },
    ],
    { productNo: '1001', question: '제 주문 송장번호 알려주세요', now: NOW }
  );
  assert.equal(usable.length, 0);

  const ev = resolveInquiryEvidence({
    row: { content: '제 주문 송장번호 알려주세요', productNo: '1001' },
    productKnowledge: approvedProduct(),
    productMatchStatus: 'exact',
    approvedFaqs: [
      {
        id: 90,
        status: 'approved',
        trustStatus: 'approved',
        source: 'HISTORICAL_QA',
        productNo: '1001',
        question: '송장번호',
        approvedAnswer: '송장 123456',
        approvedAt: '2026-01-01',
      },
    ],
    now: NOW,
  });
  assert.equal(ev.judgment, JUDGMENT.REALTIME_REQUIRED);
  assert.ok(!ev.usedKnowledge.some((u) => u.id === '90'));
});

test('3-7 실시간: 프롬프트에 서버 판정 변경 불가 고정', () => {
  const text = buildInquiryUserContent(
    { content: '송장', productNo: '1' },
    [],
    { verifiedFacts: [], missingFacts: ['송장'], judgment: 'REALTIME_REQUIRED' }
  );
  assert.match(text, /REALTIME_REQUIRED — 변경 불가/);
});

test('3-7 실시간: 공식 주문 API 미연동 시 official 없이 realtime 유지', () => {
  const ev = resolveInquiryEvidence({
    row: { content: '내 주문 송장 알려주세요', productNo: '1001' },
    productKnowledge: approvedProduct(),
    productMatchStatus: 'exact',
    officialFacts: [],
    officialMissing: ['송장'],
    now: NOW,
  });
  assert.equal(ev.judgment, JUDGMENT.REALTIME_REQUIRED);
  assert.equal(ev.realtimeRequired, true);
});
