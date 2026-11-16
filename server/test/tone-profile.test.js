import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildAnalyzeToneV2Prompt,
  getDefaultToneProfile,
  parseToneProfileJson,
  renderToneProfileToSystemPrompt,
  resolveToneSystemPrompt,
  sanitizeLearnedStylePrompt,
  stripPolicyPromiseLines,
} from '../tone-profile.js';

test('tone_v2 분석 프롬프트는 말투 필드만 요청하고 사실·약속을 금지한다', () => {
  const prompt = buildAnalyzeToneV2Prompt('review', ['안녕하세요 감사합니다']);
  assert.match(prompt, /tone_v2/);
  assert.match(prompt, /frequentPhrases/);
  assert.match(prompt, /제품 개선 약속/);
  assert.match(prompt, /효능·성능·성분/);
  assert.doesNotMatch(prompt, /공개된 상품 정보는 문의 질문에 맞게 검색/);
});

test('JSON 파싱과 렌더는 구조화 말투만 남긴다', () => {
  const raw = JSON.stringify({
    version: 'tone_v2',
    channel: 'review',
    greeting: '안녕하세요 고객님,',
    honorificStyle: '존댓말',
    sentenceLength: '짧게',
    emoji: '거의 사용 안 함',
    empathy: '짧게 호응',
    frequentPhrases: ['감사합니다'],
    closing: '좋은 하루 되세요',
  });
  const profile = parseToneProfileJson(raw, 'review');
  assert.equal(profile.version, 'tone_v2');
  const rendered = renderToneProfileToSystemPrompt(profile);
  assert.match(rendered, /인사말/);
  assert.match(rendered, /사실·약속·정책·효능은 이 지침에 넣지 않으며/);
});

test('파싱 실패 시 검증되지 않은 raw를 쓰지 않고 previous/default로 대체한다', () => {
  const previous = {
    ...getDefaultToneProfile('inquiry'),
    greeting: '문의 주셔서 감사합니다,',
  };
  const failed = resolveToneSystemPrompt({
    toneProfile: null,
    previousToneProfile: previous,
    channel: 'inquiry',
    parseFailed: true,
  });
  assert.equal(failed.usedFallback, true);
  assert.equal(failed.fallbackReason, 'previous_profile');
  assert.match(failed.prompt, /문의 주셔서 감사합니다/);

  const noPrevious = resolveToneSystemPrompt({
    toneProfile: null,
    previousToneProfile: null,
    channel: 'review',
    parseFailed: true,
  });
  assert.equal(noPrevious.usedFallback, true);
  assert.equal(noPrevious.fallbackReason, 'default_profile');
  assert.match(noPrevious.prompt, /안녕하세요 고객님/);
});

test('레거시 sanitize는 약속 라인만 제거하고 정상 표현은 남긴다', () => {
  const legacy = [
    '[말투·표현] - 존댓말로 짧게 답한다',
    '[응대 원칙] - 앞으로의 개선 의지 표현',
    '[말투·표현] - 개선된 포장에 감사 인사를 한다',
    '[상품·안내] - 불편 시 전액 환불해 드립니다',
    '[답변 방식] - 이모지 😊 를 가끔 쓴다',
  ].join('\n');

  const cleaned = sanitizeLearnedStylePrompt(legacy);
  assert.match(cleaned, /존댓말로 짧게/);
  assert.match(cleaned, /개선된 포장에 감사/);
  assert.match(cleaned, /이모지 😊/);
  assert.doesNotMatch(cleaned, /앞으로의 개선 의지/);
  assert.doesNotMatch(cleaned, /전액 환불해 드립니다/);

  const kept = stripPolicyPromiseLines('[말투·표현] - 더 나은 쇼핑이 되도록 정성껏 보내 드리겠습니다');
  assert.match(kept, /더 나은 쇼핑/);
});
