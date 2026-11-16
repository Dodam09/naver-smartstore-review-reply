import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  resolveInquiryEvidence,
  resolveProductKnowledgeMatch,
  buildSellerConfirmDraft,
} from '../evidence.js';
import { parseProductFactLookup } from '../prompts.js';

test('productNo 없으면 상품명만으로 KB를 확정하지 않는다', () => {
  const match = resolveProductKnowledgeMatch({
    userId: 1,
    productNo: '',
    productName: '오메가3',
    listByUser: () => [{ product_no: '111', product_name: '오메가3' }],
    getByProductNo: () => null,
  });
  assert.equal(match.status, 'seller_confirm');
  assert.match(match.reason, /상품번호/);
});

test('타 판매자 동일 productNo는 getByProductNo user 스코프에 의존한다', () => {
  const match = resolveProductKnowledgeMatch({
    userId: 2,
    productNo: '999',
    productName: '상품',
    getByProductNo: (uid, no) => (uid === 2 && no === '999' ? { product_no: '999', specs: 'A' } : null),
  });
  assert.equal(match.status, 'exact');
  assert.equal(match.product.specs, 'A');
});

test('부분 KB: 사용법만 있으면 성분 질문은 confirm, 사용법 질문은 kb_hit', () => {
  const product = {
    product_no: '1',
    usage: '하루 1포',
    specs: '',
    source: 'manual',
    verified_at: '2026-01-01',
  };
  const usageEv = resolveInquiryEvidence({
    row: { content: '사용법이 어떻게 되나요?', productNo: '1' },
    productKnowledge: product,
    productMatchStatus: 'exact',
  });
  assert.equal(usageEv.slots.some((s) => s.key === 'usage' && s.status === 'kb_hit'), true);
  assert.equal(usageEv.needsSellerConfirm, false);

  const specsEv = resolveInquiryEvidence({
    row: { content: '성분이 뭔가요?', productNo: '1' },
    productKnowledge: product,
    productMatchStatus: 'exact',
    officialFacts: [],
    officialSources: [],
  });
  assert.equal(specsEv.needsSellerConfirm, true);
  assert.ok(specsEv.missingFields.includes('성분·재질·사양'));
});

test('주문 실시간 슬롯은 항상 seller_confirm이고 배송 정책과 분리된다', () => {
  const ev = resolveInquiryEvidence({
    row: { content: '제 주문 송장번호 알려주세요' },
    storePolicies: { shipping: '영업일 2~3일 출고', source: 'manual', verified_at: '2026-01-01' },
    productMatchStatus: 'exact',
    productKnowledge: { product_no: '1' },
  });
  const orderSlot = ev.slots.find((s) => s.key === 'order_realtime');
  assert.equal(orderSlot.status, 'seller_confirm');
  assert.match(buildSellerConfirmDraft({ product: '테스트' }, ev), /확인 후/);
});

test('공식 사실은 출처가 있을 때만 확정한다', () => {
  const noSrc = parseProductFactLookup(
    JSON.stringify({ matchedProduct: true, facts: ['비타민C 100mg'], sources: [], missing: [] })
  );
  assert.deepEqual(noSrc.facts, []);
  assert.match(noSrc.missing.join(' '), /출처/);

  const withSrc = parseProductFactLookup(
    JSON.stringify({
      matchedProduct: true,
      facts: ['비타민C 100mg'],
      sources: ['https://brand.example/product'],
      missing: [],
    })
  );
  assert.equal(withSrc.facts[0], '비타민C 100mg');

  const ev = resolveInquiryEvidence({
    row: { content: '성분이 뭔가요?' },
    productMatchStatus: 'exact',
    productKnowledge: { product_no: '1', specs: '' },
    officialFacts: withSrc.facts,
    officialSources: withSrc.sources,
  });
  assert.equal(ev.slots.some((s) => s.status === 'official_hit'), true);
  assert.match(ev.verifiedFacts.join('\n'), /공식:/);
});

test('KB 미등록이면 confirm으로 떨어지고 앱 사용은 가능(초안 생성)', () => {
  const ev = resolveInquiryEvidence({
    row: { content: '호환되나요?', product: '케이블' },
    productMatchStatus: 'seller_confirm',
    productMatchReason: '상품번호에 해당하는 등록 상품정보가 없습니다.',
    officialFacts: [],
    officialSources: [],
  });
  assert.equal(ev.needsSellerConfirm, true);
  assert.ok(ev.missingFields.length > 0);
});

test('KB에 없는 특정 성분 포함 여부는 단정하지 않고 confirm한다', () => {
  const ev = resolveInquiryEvidence({
    row: { content: '이 제품에 콜라겐도 들어있나요?', productNo: '1' },
    productMatchStatus: 'exact',
    productKnowledge: {
      product_no: '1',
      specs: 'EPA 500mg, DHA 200mg',
      detail_description: '오메가3 연질캡슐',
      source: 'manual',
      verified_at: '2026-01-01',
    },
  });
  assert.equal(ev.needsSellerConfirm, true);
  assert.match(ev.confirmReason, /콜라겐/);
  assert.doesNotMatch(ev.confirmReason, /나요/);
});

test('승인으로 extra에 적힌 성분은 이후 kb_hit가 된다', () => {
  const ev = resolveInquiryEvidence({
    row: { content: '이 제품에 콜라겐도 들어있나요?', productNo: '1' },
    productMatchStatus: 'exact',
    productKnowledge: {
      product_no: '1',
      specs: 'EPA 500mg',
      extra: '콜라겐 미포함 (판매자 확인)',
      source: 'seller_approved',
      verified_at: '2026-01-01',
    },
  });
  assert.equal(ev.needsSellerConfirm, false);
  assert.equal(ev.slots.some((s) => s.status === 'kb_hit'), true);
});
