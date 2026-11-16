/**
 * 3-9 D4 교환·환불 의도 / D2 FAQ 상품 격리 회귀.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectInquirySlots, resolveInquiryEvidence } from '../evidence.js';
import { filterApprovedFaqs, JUDGMENT } from '../knowledge-judge.js';

const NOW = new Date('2026-11-12T15:00:00+09:00');
const product = {
  product_no: '1001',
  usage: '하루 1포',
  specs: 'EPA 500mg',
  detail_description: '상세설명',
  source: 'manual',
  verified_at: '2026-01-01',
  trust_status: 'approved',
};
const policies = {
  shipping: '영업일 2-3일',
  exchange_return: '수령 7일 이내 교환·반품 가능',
  refund: '카드 결제 시 3~5영업일 환불',
  source: 'manual',
  verified_at: '2026-01-01',
  trust_status: 'approved',
};

function judge(content) {
  return resolveInquiryEvidence({
    row: { content, productNo: '1001' },
    productKnowledge: product,
    storePolicies: policies,
    productMatchStatus: 'exact',
    now: NOW,
  });
}

function assertNoProductKbMisuse(ev) {
  const onlyProduct =
    ev.judgment === JUDGMENT.ANSWERABLE &&
    (ev.usedKnowledge || []).length > 0 &&
    (ev.usedKnowledge || []).every((u) => u.type === 'product');
  assert.equal(onlyProduct, false, '교환·환불 의도를 상품 KB만으로 ANSWERABLE 하면 안 됨');
}

// ——— D4: 3-8 실패 11 + 유지 3 ———

test('3-9 D4: 바꿀 수 있나요 → 교환 정책 ANSWERABLE (상품 KB 오용 금지)', () => {
  const ev = judge('이거 다른 걸로 바꿀 수 있나요?');
  assert.ok(detectInquirySlots({ content: '이거 다른 걸로 바꿀 수 있나요?' }).some((s) => s.key === 'exchange_return_policy'));
  assert.equal(ev.judgment, JUDGMENT.ANSWERABLE);
  assert.ok((ev.usedKnowledge || []).some((u) => u.type === 'policy'));
  assertNoProductKbMisuse(ev);
});

test('3-9 D4: 돈 돌려받고 → SELLER_CONFIRM (상품 KB 금지)', () => {
  const ev = judge('돈 돌려받고 싶은데요.');
  assert.equal(ev.judgment, JUDGMENT.SELLER_CONFIRM);
  assertNoProductKbMisuse(ev);
});

test('3-9 D4: 그냥 취소하면 → REALTIME_REQUIRED', () => {
  const ev = judge('그냥 취소하면 되나요?');
  assert.equal(ev.judgment, JUDGMENT.REALTIME_REQUIRED);
  assertNoProductKbMisuse(ev);
});

test('3-9 D4: 마음에 안 들어서 → SELLER_CONFIRM', () => {
  const ev = judge('제품이 마음에 안 들어서요.');
  assert.equal(ev.judgment, JUDGMENT.SELLER_CONFIRM);
});

test('3-9 D4: 반품 가능 → 정책 ANSWERABLE 유지', () => {
  const ev = judge('이미 받았는데 반품 가능한가요?');
  assert.equal(ev.judgment, JUDGMENT.ANSWERABLE);
  assert.ok((ev.usedKnowledge || []).some((u) => u.field === 'exchange_return'));
});

test('3-9 D4: 포장 뜯었는데 교환 → 정책 ANSWERABLE', () => {
  const ev = judge('포장 뜯었는데 교환되나요?');
  assert.equal(ev.judgment, JUDGMENT.ANSWERABLE);
  assert.ok((ev.usedKnowledge || []).some((u) => u.type === 'policy'));
});

test('3-9 D4: 주문 취소하고 싶어요 → REALTIME_REQUIRED', () => {
  assert.equal(judge('주문 취소하고 싶어요.').judgment, JUDGMENT.REALTIME_REQUIRED);
});

test('3-9 D4: 색상만 바꾸고 → SELLER_CONFIRM', () => {
  assert.equal(judge('색상만 바꾸고 싶습니다.').judgment, JUDGMENT.SELLER_CONFIRM);
});

test('3-9 D4: 잘못 주문 → SELLER_CONFIRM', () => {
  assert.equal(judge('잘못 주문했는데 어떻게 하나요?').judgment, JUDGMENT.SELLER_CONFIRM);
});

test('3-9 D4: 환불은 언제 → REALTIME_REQUIRED', () => {
  assert.equal(judge('환불은 언제 들어오나요?').judgment, JUDGMENT.REALTIME_REQUIRED);
});

test('3-9 D4: 사용법 오분류 방지 유지', () => {
  const ev = judge('사용법이 어떻게 되나요?');
  assert.equal(ev.judgment, JUDGMENT.ANSWERABLE);
  assert.ok(detectInquirySlots({ content: '사용법이 어떻게 되나요?' }).some((s) => s.key === 'usage'));
  assert.ok(!detectInquirySlots({ content: '사용법이 어떻게 되나요?' }).some((s) => s.orderRealtime));
});

test('3-9 D4: 내 주문 환불 REALTIME 유지', () => {
  assert.equal(judge('내 주문 환불 어디까지 됐나요?').judgment, JUDGMENT.REALTIME_REQUIRED);
});

test('3-9 D4: 교환 진행 상태 → REALTIME_REQUIRED', () => {
  assert.equal(judge('교환 진행 상태가 궁금합니다').judgment, JUDGMENT.REALTIME_REQUIRED);
});

test('3-9 D4: 제 주문 교환 → REALTIME_REQUIRED', () => {
  assert.equal(judge('제 주문 교환 어떻게 되고 있나요?').judgment, JUDGMENT.REALTIME_REQUIRED);
});

// ——— D4 신규 표현 ———

test('3-9 D4 신규: 다른 걸로 교환하고 싶어요 → SELLER_CONFIRM', () => {
  assert.equal(judge('다른 걸로 교환하고 싶어요').judgment, JUDGMENT.SELLER_CONFIRM);
});

test('3-9 D4 신규: 사이즈 변경 → SELLER_CONFIRM (성분 사이즈 오분류 금지)', () => {
  const slots = detectInquirySlots({ content: '사이즈 변경하고 싶습니다' }).map((s) => s.key);
  assert.ok(!slots.includes('ingredients_specs'));
  assert.equal(judge('사이즈 변경하고 싶습니다').judgment, JUDGMENT.SELLER_CONFIRM);
});

test('3-9 D4 신규: 방금 주문 취소 가능 → REALTIME', () => {
  assert.equal(judge('방금 주문했는데 취소 가능한가요').judgment, JUDGMENT.REALTIME_REQUIRED);
});

test('3-9 D4 신규: 결제 취소하고 싶어요 → REALTIME', () => {
  assert.equal(judge('결제 취소하고 싶어요').judgment, JUDGMENT.REALTIME_REQUIRED);
});

test('3-9 D4 신규: 환불 진행 상황 → REALTIME', () => {
  assert.equal(judge('환불 진행 상황 알려주세요').judgment, JUDGMENT.REALTIME_REQUIRED);
});

// ——— D2 FAQ 격리 ———

test('3-9 D2: 숫자 A/B FAQ 교차 금지', () => {
  const faqs = [
    {
      id: 1,
      status: 'approved',
      trustStatus: 'approved',
      source: 'SELLER_APPROVED',
      productNo: '11110001',
      question: '사용법',
      approvedAnswer: 'A',
      approvedAt: '2026-01-01',
    },
    {
      id: 2,
      status: 'approved',
      trustStatus: 'approved',
      source: 'SELLER_APPROVED',
      productNo: '22220002',
      question: '사용법',
      approvedAnswer: 'B',
      approvedAt: '2026-01-01',
    },
  ];
  assert.deepEqual(
    filterApprovedFaqs(faqs, { productNo: '11110001', question: '사용법', now: NOW }).map((u) => u.faq.id),
    [1]
  );
  assert.deepEqual(
    filterApprovedFaqs(faqs, { productNo: '22220002', question: '사용법', now: NOW }).map((u) => u.faq.id),
    [2]
  );
});

test('3-9 D2: 빈·비숫자 productNo는 상품 FAQ 확정 사용 금지', () => {
  const faqs = [
    {
      id: 1,
      status: 'approved',
      trustStatus: 'approved',
      source: 'SELLER_APPROVED',
      productNo: 'PROD-A',
      question: '사용법',
      approvedAnswer: 'A',
      approvedAt: '2026-01-01',
    },
    {
      id: 2,
      status: 'approved',
      trustStatus: 'approved',
      source: 'SELLER_APPROVED',
      productNo: 'PROD-B',
      question: '사용법',
      approvedAnswer: 'B',
      approvedAt: '2026-01-01',
    },
    {
      id: 3,
      status: 'approved',
      trustStatus: 'approved',
      source: 'SELLER_APPROVED',
      productNo: 'SKU-A',
      question: '사용법',
      approvedAnswer: 'SKU-A',
      approvedAt: '2026-01-01',
    },
    {
      id: 9,
      status: 'approved',
      trustStatus: 'approved',
      source: 'SELLER_APPROVED',
      productNo: '',
      question: '배송은 얼마나 걸리나요',
      approvedAnswer: '스토어공통 2-3일',
      approvedAt: '2026-01-01',
    },
  ];
  assert.equal(filterApprovedFaqs(faqs, { productNo: 'PROD-A', question: '사용법', now: NOW }).length, 0);
  assert.equal(filterApprovedFaqs(faqs, { productNo: 'SKU-B', question: '사용법', now: NOW }).length, 0);
  const emptyWant = filterApprovedFaqs(faqs, { productNo: '', question: '사용법', now: NOW });
  assert.ok(
    !emptyWant.some((u) => [1, 2, 3].includes(u.faq.id)),
    '상품 스코프(비숫자) FAQ는 빈 문의 productNo에 연결되지 않음'
  );
  // 스토어 공통(원문 productNo 공란) + 문의에도 상품번호 없음 + 질문 겹침
  const storeWide = filterApprovedFaqs(faqs, {
    productNo: '',
    question: '배송은 얼마나 걸리나요',
    now: NOW,
  });
  assert.equal(storeWide.length, 1);
  assert.equal(storeWide[0].faq.id, 9);
});

test('3-9 D2: 숫자 문의에 빈 정규화 FAQ 교차 금지', () => {
  const faqs = [
    {
      id: 1,
      status: 'approved',
      trustStatus: 'approved',
      source: 'SELLER_APPROVED',
      productNo: 'SKU-A',
      question: '사용법',
      approvedAnswer: '유출되면안됨',
      approvedAt: '2026-01-01',
    },
    {
      id: 2,
      status: 'approved',
      trustStatus: 'approved',
      source: 'SELLER_APPROVED',
      productNo: '11110001',
      question: '사용법',
      approvedAnswer: '정상',
      approvedAt: '2026-01-01',
    },
  ];
  const usable = filterApprovedFaqs(faqs, { productNo: '11110001', question: '사용법', now: NOW });
  assert.equal(usable.length, 1);
  assert.equal(usable[0].faq.id, 2);
});
