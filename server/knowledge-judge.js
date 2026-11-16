/**
 * AI 지식 검색·충돌·판정 (3-3).
 * HISTORICAL_QA / HISTORICAL_REPLY / AI_DERIVED / unverified 단독 확정 금지.
 */

import {
  canUseAsVerifiedFact,
  contentHash,
  fieldCanUseAsFact,
  isKnowledgeEffective,
  normalizeFactText,
  normalizeSource,
  resolveTrustStatus,
} from './knowledge-meta.js';

export const JUDGMENT = Object.freeze({
  ANSWERABLE: 'ANSWERABLE',
  SELLER_CONFIRM: 'SELLER_CONFIRM',
  REALTIME_REQUIRED: 'REALTIME_REQUIRED',
});

function tokenSet(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2)
  );
}

/** 조사·어미를 대략 줄여 한국어 부분일치에 사용 */
function stemToken(w) {
  return String(w || '')
    .replace(/(으로|로서|에서|까지|부터|인지|인가요|인가요|인가요)$/u, '')
    .replace(/(으로|를|을|가|이|은|는|도|만|와|과|의|에|로|요|다|까|죠)$/u, '');
}

function overlapScore(a, b) {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (!A.size || !B.size) return 0;
  const stemsB = new Set([...B].map(stemToken).filter((s) => s.length >= 2));
  let hit = 0;
  for (const t of A) {
    if (B.has(t)) {
      hit += 1;
      continue;
    }
    const st = stemToken(t);
    if (st.length >= 2 && (stemsB.has(st) || [...stemsB].some((u) => u.includes(st) || st.includes(u)))) {
      hit += 1;
    }
  }
  return hit / Math.min(A.size, B.size);
}

const FAQ_INTENT_HINTS = [
  '사용법',
  '용법',
  '성분',
  '스펙',
  '호환',
  '배송',
  '교환',
  '반품',
  '환불',
  '주의',
  '재고',
  '송장',
];

function intentHintScore(question, faq) {
  const q = String(question || '');
  const blob = [faq?.question, faq?.confirmPrompt, faq?.intentKey, faq?.approvedAnswer]
    .map((s) => String(s || ''))
    .join(' ');
  let best = 0;
  for (const hint of FAQ_INTENT_HINTS) {
    if (q.includes(hint) && blob.includes(hint)) best = Math.max(best, 0.75);
  }
  if (faq?.intentKey && q.includes(String(faq.intentKey))) best = Math.max(best, 0.85);
  return best;
}

/** 승인 FAQ만 · 유효·상품 일치 (숫자형 productNo 전제 · 빈 정규화 교차 금지) */
export function filterApprovedFaqs(faqs, { productNo, question, now = new Date() } = {}) {
  const wantRaw = String(productNo || '').trim();
  const wantNo = wantRaw.replace(/[^\d]/g, '');
  const q = String(question || '');
  const usable = [];
  for (const faq of faqs || []) {
    if (faq.status !== 'approved') continue;
    const trust = resolveTrustStatus({
      trustStatus: faq.trustStatus,
      source: faq.source || 'SELLER_APPROVED',
      verifiedAt: faq.approvedAt,
    });
    if (trust !== 'approved') continue;
    const src = normalizeSource(faq.source || 'SELLER_APPROVED');
    if (src === 'HISTORICAL_QA' || src === 'HISTORICAL_REPLY' || src === 'AI_DERIVED') continue;
    const { effective } = isKnowledgeEffective(
      { validFrom: faq.validFrom, validTo: faq.validTo },
      now
    );
    if (!effective) continue;
    const faqRaw = String(faq.productNo || '').trim();
    const faqNo = faqRaw.replace(/[^\d]/g, '');
    // 비숫자·혼합 식별자만 있는 문의(정규화 후 빈 값) → FAQ 확정 후보 없음 (SKU 미지원)
    if (!wantNo && wantRaw) continue;
    // 문의에 숫자형 상품번호가 있으면 동일 숫자 FAQ만 허용 (빈 정규화·타상품 교차 금지)
    if (wantNo) {
      if (!faqNo || faqNo !== wantNo) continue;
    } else {
      // 상품번호 없음 → 상품 스코프 FAQ(원문에 식별자 있음)로 확정하지 않음
      // 스토어 공통(원문 productNo 비어 있음) FAQ만 후보
      if (faqRaw) continue;
    }
    const answer = String(faq.approvedAnswer || '').trim();
    if (!answer) continue;
    const score = Math.max(
      overlapScore(q, faq.question || ''),
      overlapScore(q, faq.confirmPrompt || ''),
      overlapScore(q, answer),
      intentHintScore(q, faq)
    );
    usable.push({ faq, score, answerNorm: normalizeFactText(answer) });
  }
  usable.sort((a, b) => b.score - a.score || String(b.faq.approvedAt || '').localeCompare(String(a.faq.approvedAt || '')));
  return usable;
}

/**
 * 동일 상품 FAQ 중복/상충.
 * @returns {{ representative: object|null, conflict: boolean, reason: string }}
 */
export function resolveFaqGroup(usableFaqs) {
  const matched = (usableFaqs || []).filter((u) => u.score >= 0.25);
  if (!matched.length) return { representative: null, conflict: false, reason: '' };

  const norms = [...new Set(matched.map((m) => m.answerNorm).filter(Boolean))];
  if (norms.length > 1) {
    return {
      representative: null,
      conflict: true,
      reason: '동일 상품에 내용이 다른 승인 FAQ가 있어 확인이 필요합니다.',
    };
  }
  return { representative: matched[0].faq, conflict: false, reason: '' };
}

/** KB 필드 스니펫 — approved+effective 만 */
export function pickVerifiedKbSnippets(product, fields, now = new Date()) {
  if (!product) return [];
  const out = [];
  for (const field of fields || []) {
    const value = String(product[field] || '').trim();
    if (!value) continue;
    if (!fieldCanUseAsFact(product, field, now)) continue;
    out.push({
      field,
      text: value.slice(0, 1200),
      id: `product:${product.product_no || product.productNo}:${field}`,
      source: product.fieldMeta?.[field]?.source || product.sourceNormalized || product.source,
      trustStatus: 'approved',
    });
  }
  return out;
}

export function pickVerifiedPolicySnippets(policies, fields, now = new Date()) {
  if (!policies) return [];
  const out = [];
  for (const field of fields || []) {
    const value = String(policies[field] || '').trim();
    if (!value) continue;
    if (!fieldCanUseAsFact(policies, field, now)) continue;
    out.push({
      field,
      text: value.slice(0, 800),
      id: `policy:${field}`,
      source: policies.fieldMeta?.[field]?.source || policies.sourceNormalized || policies.source,
      trustStatus: 'approved',
    });
  }
  return out;
}

/** FAQ 본문과 KB mirror 필드 불일치 → 충돌 */
export function faqConflictsWithKb(faq, product) {
  const link = faq?.kbLink;
  if (!link || link.mode !== 'mirror' || !product || !link.field) return false;
  const map = {
    product_name: product.product_name || product.productName,
    detail_description: product.detail_description || product.detailDescription,
    specs: product.specs,
    usage: product.usage,
    options_compat: product.options_compat || product.optionsCompat,
    cautions: product.cautions,
    extra: product.extra,
  };
  const body = map[link.field];
  if (body == null) return false;
  if (link.contentHash && contentHash(body) !== link.contentHash) return true;
  const ans = normalizeFactText(faq.approvedAnswer);
  const kbNorm = normalizeFactText(body);
  if (ans && kbNorm && ans !== kbNorm && !kbNorm.includes(ans) && !ans.includes(kbNorm)) {
    return true;
  }
  return false;
}

/**
 * evidence 슬롯 + FAQ → 최종 판정·usedKnowledge
 */
export function finalizeInquiryJudgment({
  evidence,
  productKnowledge = null,
  approvedFaqs = [],
  productNo = '',
  question = '',
  now = new Date(),
} = {}) {
  const usedKnowledge = [];
  const usable = filterApprovedFaqs(approvedFaqs, { productNo, question, now });
  const faqGroup = resolveFaqGroup(usable);
  let needsSellerConfirm = !!(evidence?.needsSellerConfirm);
  let confirmReason = evidence?.confirmReason || '';
  const verifiedFacts = [...(evidence?.verifiedFacts || [])];
  const sources = [...(evidence?.sources || [])];

  let faqResolved = false;
  if (faqGroup.conflict) {
    needsSellerConfirm = true;
    confirmReason = [confirmReason, faqGroup.reason].filter(Boolean).join(' / ');
  } else if (faqGroup.representative) {
    const faq = faqGroup.representative;
    if (faqConflictsWithKb(faq, productKnowledge)) {
      needsSellerConfirm = true;
      confirmReason = [confirmReason, '승인 FAQ와 상품 지식 내용이 달라 확인이 필요합니다.']
        .filter(Boolean)
        .join(' / ');
    } else {
      const fact = `[FAQ:${faq.id}] ${faq.approvedAnswer}`;
      verifiedFacts.push(fact);
      sources.push({
        type: 'faq',
        id: faq.id,
        productNo: faq.productNo,
        source: 'SELLER_APPROVED',
        trustStatus: 'approved',
      });
      usedKnowledge.push({
        type: 'faq',
        id: String(faq.id),
        source: 'SELLER_APPROVED',
        trustStatus: 'approved',
        productNo: faq.productNo || null,
      });
      faqResolved = true;
    }
  }

  for (const src of evidence?.sources || []) {
    if (src.type === 'kb' && src.field) {
      usedKnowledge.push({
        type: src.policyField ? 'policy' : 'product',
        id: src.policyField
          ? `policy:${src.field}`
          : `product:${src.productNo || productNo}:${src.field}`,
        source: normalizeSource(src.source || 'MANUAL'),
        trustStatus: 'approved',
        productNo: src.productNo || productNo || null,
        field: src.field,
      });
    } else if (src.type === 'official') {
      usedKnowledge.push({
        type: 'official',
        id: src.urlOrLabel || 'official',
        source: 'OFFICIAL_ORDER',
        trustStatus: 'approved',
      });
    }
  }

  const slots = evidence?.slots || [];
  const hasRealtimeGap = slots.some(
    (s) => s.key === 'order_realtime' && s.status === 'seller_confirm'
  );
  const hasOtherConfirm = slots.some(
    (s) => s.key !== 'order_realtime' && s.status === 'seller_confirm'
  );
  // 승인 FAQ가 질문 근거를 채우면, 비실시간 seller_confirm 슬롯은 FAQ로 해소
  const otherConfirmOpen = hasOtherConfirm && !faqResolved;

  let judgment = JUDGMENT.ANSWERABLE;
  if (faqGroup.conflict) {
    judgment = JUDGMENT.SELLER_CONFIRM;
    needsSellerConfirm = true;
  } else if (hasRealtimeGap && !otherConfirmOpen) {
    judgment = JUDGMENT.REALTIME_REQUIRED;
    needsSellerConfirm = true;
  } else if (otherConfirmOpen || hasRealtimeGap || (needsSellerConfirm && !faqResolved)) {
    judgment = JUDGMENT.SELLER_CONFIRM;
    needsSellerConfirm = true;
  } else if (faqResolved) {
    judgment = JUDGMENT.ANSWERABLE;
    needsSellerConfirm = false;
    confirmReason = '';
  }

  // 확정 근거가 하나도 없으면 안전측 confirm
  if (judgment === JUDGMENT.ANSWERABLE && !verifiedFacts.length) {
    judgment = JUDGMENT.SELLER_CONFIRM;
    needsSellerConfirm = true;
  }

  const dedupUsed = [];
  const seen = new Set();
  for (const u of usedKnowledge) {
    const key = `${u.type}:${u.id}:${u.field || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedupUsed.push(u);
  }

  return {
    judgment,
    needsSellerConfirm,
    confirmReason: confirmReason.slice(0, 500),
    verifiedFacts: unique(verifiedFacts).slice(0, 20),
    sources,
    usedKnowledge: dedupUsed.slice(0, 40),
    faqConflict: faqGroup.conflict,
    realtimeRequired: judgment === JUDGMENT.REALTIME_REQUIRED || hasRealtimeGap,
  };
}

function unique(list) {
  const seen = new Set();
  const out = [];
  for (const item of list || []) {
    const s = String(item || '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

export { canUseAsVerifiedFact };
