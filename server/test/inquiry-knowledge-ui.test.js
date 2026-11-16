import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ui = require(path.join(root, 'lib', 'inquiry-knowledge-ui.js'));

test('ANSWERABLE: 사용된 지식 출처를 표시 모델로 만든다', () => {
  const model = ui.buildKnowledgePanelModel({
    id: '1',
    reply: '하루 1포 급여해 주세요.',
    needsConfirm: false,
    judgment: 'ANSWERABLE',
    productNo: '11417353082',
    usedKnowledge: [
      {
        type: 'product',
        id: 'product:11417353082:usage',
        field: 'usage',
        trustStatus: 'approved',
        source: 'MANUAL',
        productNo: '11417353082',
      },
    ],
  });
  assert.equal(model.primary, 'answerable');
  assert.equal(model.badgeLabel, '답변 가능');
  assert.equal(model.hasUsedKnowledge, true);
  assert.ok(model.usedKnowledgeLines[0].includes('usage'));
  assert.ok(model.secondaryBadges.some((b) => b.label === '#11417353082'));
});

test('SELLER_CONFIRM과 REALTIME_REQUIRED를 구분한다', () => {
  const confirm = ui.buildKnowledgePanelModel({
    id: '2',
    reply: '확인 후 안내드리겠습니다.',
    needsConfirm: true,
    judgment: 'SELLER_CONFIRM',
    confirmReason: '성분 함량은 확인이 필요합니다.',
    usedKnowledge: [],
  });
  assert.equal(confirm.primary, 'seller_confirm');
  assert.equal(confirm.badgeClass, 'confirm');
  assert.match(confirm.confirmReason, /성분/);

  const realtime = ui.buildKnowledgePanelModel({
    id: '3',
    reply: '재고 확인 후 안내드리겠습니다.',
    needsConfirm: true,
    judgment: 'REALTIME_REQUIRED',
    confirmReason: '실시간 재고 확인 필요',
    usedKnowledge: [],
  });
  assert.equal(realtime.primary, 'realtime');
  assert.equal(realtime.badgeClass, 'realtime');
  assert.notEqual(realtime.primary, confirm.primary);
});

test('상품정보 없음과 지식 확인 필요를 구분한다', () => {
  const noProduct = ui.buildKnowledgePanelModel({
    id: '4',
    reply: '확인 후 안내드리겠습니다.',
    needsConfirm: true,
    judgment: 'SELLER_CONFIRM',
    confirmReason: '성분·재질·사양: 상품번호에 해당하는 등록 상품정보가 없습니다.',
    evidence: { productMatchStatus: 'seller_confirm' },
  });
  assert.equal(noProduct.noProductKnowledge, true);

  const review = ui.buildKnowledgePanelModel({
    id: '5',
    reply: '확인 후 안내드리겠습니다.',
    needsConfirm: true,
    judgment: 'SELLER_CONFIRM',
    confirmReason: '승인 FAQ와 상품 지식 내용이 달라 확인이 필요합니다.',
    evidence: { faqConflict: true },
    usedKnowledge: [{ type: 'faq', id: '9', trustStatus: 'pending', productNo: '1' }],
  });
  assert.equal(review.knowledgeNeedsReview, true);
  assert.ok(review.secondaryBadges.some((b) => b.label === '지식 확인 필요'));
});

test('답글 수정 시 근거를 유지한다', () => {
  const before = {
    id: '10',
    reply: '원래 초안',
    judgment: 'ANSWERABLE',
    usedKnowledge: [{ type: 'product', id: 'product:1:usage', productNo: '1', field: 'usage' }],
    evidence: { judgment: 'ANSWERABLE' },
  };
  const after = ui.applyKnowledgeOnEdit(before, '수정한 답글입니다.');
  assert.equal(after.reply, '수정한 답글입니다.');
  assert.equal(after.judgment, 'ANSWERABLE');
  assert.deepEqual(after.usedKnowledge, before.usedKnowledge);
});

test('재생성 시 새 judgment·usedKnowledge로 갱신한다', () => {
  const before = {
    id: '11',
    reply: '옛 초안',
    judgment: 'SELLER_CONFIRM',
    usedKnowledge: [],
    productNo: '13512827869',
  };
  const after = ui.applyKnowledgeOnRegenerate(before, {
    text: '재고 확인 후 안내드리겠습니다.',
    needsConfirm: true,
    reason: '실시간 재고',
    judgment: 'REALTIME_REQUIRED',
    usedKnowledge: [{ type: 'official', id: 'order', trustStatus: 'approved' }],
    evidence: { judgment: 'REALTIME_REQUIRED', missingFields: ['재고'] },
  });
  assert.equal(after.judgment, 'REALTIME_REQUIRED');
  assert.equal(after.usedKnowledge.length, 1);
  assert.equal(after.reply.includes('재고'), true);
  assert.notEqual(after.judgment, before.judgment);
});

test('다건 생성 시 문의별 근거가 섞이면 실패한다', () => {
  const ok = ui.assertKnowledgeIsolation([
    {
      id: 'a',
      productNo: '111',
      usedKnowledge: [{ type: 'product', id: 'p1', productNo: '111' }],
    },
    {
      id: 'b',
      productNo: '222',
      usedKnowledge: [{ type: 'product', id: 'p2', productNo: '222' }],
    },
  ]);
  assert.equal(ok.ok, true);

  const leak = ui.assertKnowledgeIsolation([
    {
      id: 'a',
      productNo: '111',
      usedKnowledge: [{ type: 'product', id: 'p2', productNo: '222' }],
    },
    {
      id: 'b',
      productNo: '222',
      usedKnowledge: [{ type: 'product', id: 'p2', productNo: '222' }],
    },
  ]);
  assert.equal(leak.ok, false);
  assert.equal(leak.reason, 'cross_product_leak');
});

test('usedKnowledge가 없으면 임의 생성하지 않는다', () => {
  const model = ui.buildKnowledgePanelModel({
    id: '12',
    reply: '안내드립니다.',
    judgment: 'ANSWERABLE',
    usedKnowledge: [],
  });
  assert.equal(model.hasUsedKnowledge, false);
  assert.deepEqual(model.usedKnowledgeLines, []);
});
