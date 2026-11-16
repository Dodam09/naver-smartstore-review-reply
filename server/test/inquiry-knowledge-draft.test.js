import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildInquiryKnowledgeDraftPrompt,
  parseInquiryKnowledgeDraft,
} from '../prompts.js';

test('inquiry knowledge draft prompt includes Q&A and JSON schema', () => {
  const prompt = buildInquiryKnowledgeDraftPrompt([
    {
      question: '배송비 얼마예요?',
      answer: '기본 배송비 3000원, 5만원 이상 무료배송입니다.',
      productNo: '111',
      productName: '테스트상품',
    },
    {
      question: '하루에 몇 번 급여하나요?',
      answer: '하루 1회 사료에 뿌려 급여해 주세요.',
      productNo: '111',
      productName: '테스트상품',
    },
  ]);
  assert.match(prompt, /JSON/);
  assert.match(prompt, /배송비 3000원/);
  assert.match(prompt, /상품번호: 111/);
});

test('parseInquiryKnowledgeDraft keeps explicit fields only', () => {
  const draft = parseInquiryKnowledgeDraft(`{
    "products": [{
      "productNo": "111",
      "productName": "테스트상품",
      "detailDescription": "",
      "specs": "",
      "usage": "하루 1회",
      "optionsCompat": "",
      "cautions": "",
      "extra": "",
      "confidence": "medium"
    }],
    "policies": {
      "shipping": "3000원 / 5만원 이상 무료",
      "exchangeReturn": "",
      "refund": "",
      "customerService": "",
      "confidence": "high"
    },
    "warnings": ["효능 언급 없음"]
  }`);
  assert.equal(draft.parseFailed, false);
  assert.equal(draft.products[0].usage, '하루 1회');
  assert.equal(draft.policies.shipping, '3000원 / 5만원 이상 무료');
  assert.equal(draft.warnings[0], '효능 언급 없음');
});

test('parseInquiryKnowledgeDraft handles garbage', () => {
  const draft = parseInquiryKnowledgeDraft('not json');
  assert.equal(draft.parseFailed, true);
  assert.equal(draft.products.length, 0);
});
