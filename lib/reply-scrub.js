const STORE_PLACEHOLDER_RE =
  /[\[［【「『{(]\s*(?:스마트\s*)?(?:스토어|쇼핑몰|샵|숍|shop|store)\s*(?:이름|명)?\s*[\]］】」』})]|[\[［【「『{(]\s*(?:브랜드|상호|가게|판매자)(?:\s*(?:이름|명))?\s*[\]］】」』})]/gi;

function stripStorePlaceholders(text, replacement = '') {
  return String(text || '')
    .replace(STORE_PLACEHOLDER_RE, replacement)
    .replace(
      /[\[［【「『{(]\s*[^\]］】」』})\n]{0,24}(?:스마트\s*)?(?:스토어|쇼핑몰|브랜드|상호|샵|숍|가게|판매자|shop|store)[^\]］】」』})\n]{0,12}[\]］】」』})]/gi,
      replacement
    );
}

function sanitizeLearnedStylePrompt(prompt) {
  return stripStorePlaceholders(prompt, '이번 상품명에 있는 이름')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function scrubGeneratedReply(text) {
  let out = stripStorePlaceholders(text, '');
  out = out.replace(/안녕하세요,?\s*(입니다|예요|이에요)/g, '안녕하세요');
  return out.replace(/[ \t]{2,}/g, ' ').replace(/ ,/g, ',').replace(/\n{3,}/g, '\n\n').trim();
}

function appendReplyHardRulesLocal(systemPrompt, row = {}) {
  const product = String(row?.product || '').trim();
  return [
    sanitizeLearnedStylePrompt(systemPrompt),
    '',
    '[말투와 내용의 구분 — 위 지침보다 우선]',
    '- 위 지침은 말투·문장 길이·이모지·호응 방식만 따른다.',
    '- 지침이나 샘플에 적힌 스토어명·제품명·브랜드는 이번 답글에 복사하지 않는다.',
    '- 고유명은 이번 입력의 상품명과 리뷰/문의 본문에 실제로 있는 것만 쓴다.',
    '- [스토어 이름], [스마트스토어 이름] 같은 자리표시는 출력하지 않는다.',
    product
      ? `- 상품을 언급할 때는 이번 상품 범위에서만 말한다: ${product}`
      : '- 상품명이 없으면 특정 제품명을 지어내지 않는다.',
    '- 인사에 이름을 넣는 말투여도, 상품명에서 확인되는 이름이 없으면 이름 없이 인사한다.',
  ].join('\n');
}
