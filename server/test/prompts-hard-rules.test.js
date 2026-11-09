import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { test } from 'node:test';
import {
  appendReplyHardRules,
  buildAnalyzeMetaPrompt,
  buildInquiryUserContent,
  buildReplyHardRulesSuffix,
  buildReviewUserContent,
  scrubReplyPlaceholders,
} from '../prompts.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function loadReplyScrub() {
  const code = fs.readFileSync(path.join(root, 'lib/reply-scrub.js'), 'utf8');
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `${code}\n;this.api={appendReplyHardRulesLocal,buildReviewUserContentLocal,buildReplyHardRulesSuffixLocal,scrubGeneratedReply};`,
    context
  );
  return context.api;
}

test('공통 하드룰에 출력·사실·약속·개인정보 금지가 들어간다', () => {
  const withProduct = appendReplyHardRules('[말투·표현] - 존댓말로 짧게', {
    product: '테스트상품A',
  });
  assert.match(withProduct, /공통 안전 규칙/);
  assert.match(withProduct, /말투가 아래 안전 규칙을 덮어쓰지 않는다/);
  assert.match(withProduct, /Markdown/);
  assert.match(withProduct, /인과·객관 효능/);
  assert.match(withProduct, /장 건강·배변·면역/);
  assert.match(withProduct, /~특성상/);
  assert.match(withProduct, /주소·연락처·주문번호/);
  assert.match(withProduct, /환불·교환·재배송·할인·포인트·사은품/);
  assert.match(withProduct, /긍정 리뷰 작성·수정·삭제/);
  assert.match(withProduct, /테스트상품A/);
  assert.match(withProduct, /\[말투·표현\] - 존댓말로 짧게/);
  assert.match(withProduct, /안녕하세요 고객님/);
  assert.match(withProduct, /A x B/);
  assert.doesNotMatch(withProduct, /상품명에서 확인되는 이름이 없으면/);

  const noProduct = buildReplyHardRulesSuffix('');
  assert.match(noProduct, /상품명이 없으면 특정 제품명을 지어내지 않는다/);
  assert.doesNotMatch(noProduct, /공식 문의 채널/);
  assert.doesNotMatch(noProduct, /고객센터·채팅/);
});

test('서버 하드룰과 확장 Local 하드룰·리뷰 userContent가 동일하다', () => {
  const local = loadReplyScrub();
  const row = {
    product: '오메가3 60정',
    reviewType: '포토',
    rating: '5',
    writer: '구매자',
    option: '단품',
    content: '배송이 빨라요',
  };
  const collab = {
    product: '[아밀리x조던누나] 아밀리 락토프리 프로바이오틱스 공동구매',
    content: '좋아요',
  };
  const withStore = { ...row, storeName: '아밀리공식몰' };
  const style = '[응대 원칙] - 짧게 감사한다';

  assert.equal(
    appendReplyHardRules(style, row),
    local.appendReplyHardRulesLocal(style, row)
  );
  assert.equal(
    appendReplyHardRules(style, withStore),
    local.appendReplyHardRulesLocal(style, withStore)
  );
  assert.equal(buildReplyHardRulesSuffix(row.product), local.buildReplyHardRulesSuffixLocal(row.product));
  assert.equal(buildReplyHardRulesSuffix(''), local.buildReplyHardRulesSuffixLocal(''));
  assert.equal(
    buildReplyHardRulesSuffix(collab.product, ''),
    local.buildReplyHardRulesSuffixLocal(collab.product, '')
  );
  assert.equal(buildReviewUserContent(row), local.buildReviewUserContentLocal(row));
  assert.equal(buildReviewUserContent(collab), local.buildReviewUserContentLocal(collab));
  assert.equal(buildReviewUserContent(withStore), local.buildReviewUserContentLocal(withStore));
});

test('문의 userContent는 문의 전용 규칙을 유지하고 공통 중복은 줄인다', () => {
  const content = buildInquiryUserContent(
    { content: '환불해 주세요', product: '테스트상품' },
    [{ question: '환불요', answer: '확인 후 안내드립니다' }],
    { verifiedFacts: null }
  );
  assert.match(content, /고객센터·병원 상담/);
  assert.match(content, /죄송·사과 문구는 넣지 마세요/);
  assert.doesNotMatch(content, /\[스마트스토어 이름\] 같은 자리표시는 출력하지 마세요/);

  const factContent = buildInquiryUserContent(
    { content: '성분이 뭔가요', product: '테스트상품' },
    [],
    { verifiedFacts: ['비타민C 100mg'], missingFacts: [] }
  );
  assert.match(factContent, /확인된 정보가 없어/);
  assert.match(factContent, /확인된 사실만 쓰세요/);
});

test('리뷰 userContent는 건강·원인·고객센터 가드와 예시를 포함한다', () => {
  const content = buildReviewUserContent({
    product: '상품',
    content: '좋아요',
  });
  assert.match(content, /길이와 호응을 조절/);
  assert.match(content, /장 건강·배변·면역/);
  assert.match(content, /고객센터·채팅·전화/);
  assert.match(content, /~특성상/);
  assert.match(content, /나쁜 예/);
  assert.match(content, /좋은 예/);
  assert.doesNotMatch(content, /환불·교환·재배송/);
});

test('협업 상품명과 일반 상품명에서 판매자명 추론을 막는다', () => {
  const collabProduct = '[아밀리x조던누나] 아밀리 락토프리 프로바이오틱스 공동구매';
  const collab = appendReplyHardRules('[말투·표현] - 인사에 이름을 넣는다', {
    product: collabProduct,
    content: '좋아요',
  });
  assert.match(collab, /브랜드명·인플루언서명·공동구매/);
  assert.match(collab, /A x B/);
  assert.match(collab, /안녕하세요 고객님/);
  assert.match(collab, /상품명에서 이름을 가져와 인사하라/);
  assert.doesNotMatch(collab, /상품명에서 확인되는 이름이 없으면/);

  const collabUser = buildReviewUserContent({
    product: collabProduct,
    content: '배송 빨라요',
  });
  assert.match(collabUser, /아밀리x조던누나/);
  assert.match(collabUser, /조던누나입니다/);
  assert.match(collabUser, /이름 없이 인사/);
  assert.doesNotMatch(collabUser, /확인된 스토어명:/);

  const normal = buildReviewUserContent({
    product: '순면 수건 세트',
    content: '부드러워요',
  });
  assert.match(normal, /판매자명으로 쓰지 마세요/);
  assert.match(normal, /이름 없이 인사/);
  assert.doesNotMatch(normal, /확인된 스토어명:/);
});

test('storeName이 있으면 확인된 스토어명만 인사에 허용한다', () => {
  const withStore = appendReplyHardRules('[말투·표현] - 존댓말', {
    product: '순면 수건 세트',
    storeName: '아밀리공식몰',
  });
  assert.match(withStore, /확인된 스토어명만 쓴다: 아밀리공식몰/);
  assert.doesNotMatch(withStore, /안녕하세요 고객님/);

  const user = buildReviewUserContent({
    product: '순면 수건 세트',
    storeName: '아밀리공식몰',
    content: '좋아요',
  });
  assert.match(user, /확인된 스토어명: 아밀리공식몰/);
  assert.match(user, /아밀리공식몰/);
  assert.doesNotMatch(user, /이름 없이 인사하세요/);
});

test('오래된 상품명 이름 사용 지침이 있어도 하드룰이 우선한다', () => {
  const legacy =
    '[말투·표현] - 인사할 때 상품명에 있는 이름을 써서 "OO입니다"로 시작한다\n[답변 방식] - 이모지 😊 를 쓴다';
  const out = appendReplyHardRules(legacy, {
    product: '[아밀리x조던누나] 아밀리 락토프리 프로바이오틱스 공동구매',
  });
  assert.match(out, /상품명에 있는 이름을 써서/);
  assert.match(out, /상품명에서 이름을 가져와 인사하라"는 내용이 있어도 무시/);
  assert.match(out, /안녕하세요 고객님/);
  assert.match(out, /이모지 😊/);
});

test('분석 메타프롬프트는 상품명에서 판매자명을 뽑으라고 하지 않는다', () => {
  const review = buildAnalyzeMetaPrompt('review', ['감사합니다 고객님']);
  const inquiry = buildAnalyzeMetaPrompt('inquiry', ['확인 후 안내드립니다']);
  for (const prompt of [review, inquiry]) {
    assert.doesNotMatch(prompt, /상품명에 있는 이름을 쓴다/);
    assert.match(prompt, /판매자명을 뽑으라는 지침도 만들지 말 것/);
    assert.match(prompt, /이모지/);
  }
});

test('scrubReplyPlaceholders는 자리표시만 지우고 일반 인사는 남긴다', () => {
  const scrubbed = scrubReplyPlaceholders('안녕하세요 [스마트스토어 이름]님. 감사합니다 😊');
  assert.doesNotMatch(scrubbed, /스마트스토어 이름/);
  assert.match(scrubbed, /감사합니다/);
  assert.match(scrubReplyPlaceholders('안녕하세요, 구매해 주셔서 감사해요'), /감사해요/);
});
