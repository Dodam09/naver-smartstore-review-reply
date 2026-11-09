import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { test } from 'node:test';
import {
  appendReplyHardRules,
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
  const style = '[응대 원칙] - 짧게 감사한다';

  assert.equal(
    appendReplyHardRules(style, row),
    local.appendReplyHardRulesLocal(style, row)
  );
  assert.equal(buildReplyHardRulesSuffix(row.product), local.buildReplyHardRulesSuffixLocal(row.product));
  assert.equal(buildReplyHardRulesSuffix(''), local.buildReplyHardRulesSuffixLocal(''));
  assert.equal(buildReviewUserContent(row), local.buildReviewUserContentLocal(row));
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

test('scrubReplyPlaceholders는 자리표시만 지우고 일반 인사는 남긴다', () => {
  const scrubbed = scrubReplyPlaceholders('안녕하세요 [스마트스토어 이름]님. 감사합니다 😊');
  assert.doesNotMatch(scrubbed, /스마트스토어 이름/);
  assert.match(scrubbed, /감사합니다/);
  assert.match(scrubReplyPlaceholders('안녕하세요, 구매해 주셔서 감사해요'), /감사해요/);
});
