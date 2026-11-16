/**
 * 3-8 고정 회귀 잠금 (엔진 변경 없음).
 * D4 누락 매트릭스는 scripts/verify-knowledge-reliability-3-8.mjs 가 FAIL로 기록.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectInquirySlots, resolveInquiryEvidence, resolveProductKnowledgeMatch } from '../evidence.js';
import { filterApprovedFaqs, JUDGMENT } from '../knowledge-judge.js';

const NOW = new Date('2026-11-12T15:00:00+09:00');
const product = {
  product_no: '1001',
  usage: '하루 1포',
  specs: 'EPA',
  source: 'manual',
  verified_at: '2026-01-01',
  trust_status: 'approved',
};
const policies = {
  exchange_return: '수령 7일 이내 교환반품',
  refund: '3-5영업일',
  source: 'manual',
  verified_at: '2026-01-01',
  trust_status: 'approved',
};

test('3-8 D4: 사용법 문의는 교환·환불/REALTIME으로 오분류하지 않는다', () => {
  const slots = detectInquirySlots({ content: '사용법이 어떻게 되나요?' }).map((s) => s.key);
  assert.ok(slots.includes('usage'));
  assert.ok(!slots.includes('order_realtime'));
  assert.ok(!slots.includes('exchange_return_policy'));
  const ev = resolveInquiryEvidence({
    row: { content: '사용법이 어떻게 되나요?', productNo: '1001' },
    productKnowledge: product,
    storePolicies: policies,
    productMatchStatus: 'exact',
    now: NOW,
  });
  assert.equal(ev.judgment, JUDGMENT.ANSWERABLE);
  assert.notEqual(ev.judgment, JUDGMENT.REALTIME_REQUIRED);
});

test('3-8 D4: 「반품 가능」은 교환·반품 정책 슬롯에 걸린다', () => {
  const slots = detectInquirySlots({ content: '이미 받았는데 반품 가능한가요?' }).map((s) => s.key);
  assert.ok(slots.includes('exchange_return_policy'));
});

test('3-8 D4: 「내 주문 환불」은 REALTIME_REQUIRED', () => {
  const ev = resolveInquiryEvidence({
    row: { content: '내 주문 환불 어디까지 됐나요?', productNo: '1001' },
    productKnowledge: product,
    storePolicies: policies,
    productMatchStatus: 'exact',
    now: NOW,
  });
  assert.equal(ev.judgment, JUDGMENT.REALTIME_REQUIRED);
});

test('3-8 D2: 숫자 productNo는 교차 상품 FAQ를 차단한다', () => {
  const usable = filterApprovedFaqs(
    [
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
    ],
    { productNo: '11110001', question: '사용법', now: NOW }
  );
  assert.equal(usable.length, 1);
  assert.equal(usable[0].faq.id, 1);
});

test('3-8 D2: 상품명만으로는 KB 확정하지 않는다', () => {
  const match = resolveProductKnowledgeMatch({
    userId: 1,
    productNo: '',
    productName: '아밀리',
    listByUser: () => [{ product_no: '10380586205', product_name: '아밀리' }],
    getByProductNo: () => null,
  });
  assert.equal(match.status, 'seller_confirm');
  assert.equal(match.product, null);
});

test('3-8 D2: 비숫자 식별자는 상품 FAQ 확정에 쓰지 않는다 (3-9 교정 후)', () => {
  const usable = filterApprovedFaqs(
    [
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
    ],
    { productNo: 'PROD-A', question: '사용법', now: NOW }
  );
  assert.equal(usable.length, 0, '비숫자 productNo는 FAQ 확정 후보에서 제외');
});
