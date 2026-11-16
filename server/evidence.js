/**
 * 문의 Evidence Resolver — 질문 슬롯별 kb / official / seller_confirm.
 * 과거 Q&A는 참고일 뿐 정책·효능 확정에 쓰지 않는다.
 * 확정 근거는 approved+effective 필드만 (knowledge-meta / knowledge-judge).
 */

import {
  finalizeInquiryJudgment,
  pickVerifiedKbSnippets,
  pickVerifiedPolicySnippets,
} from './knowledge-judge.js';

/** 주문별 실시간(출고·송장·재고·개별 취소/교환/환불 진행) */
const ORDER_REALTIME_SLOT = {
  key: 'order_realtime',
  label: '주문·출고·송장·재고(실시간)',
  orderRealtime: true,
  re: /(?:내|제|우리)\s*주문|출고\s*됐|송장|추적|언제\s*(와|오|도착|발송)|재고\s*있|품절|지금\s*발송|환불\s*(?:은\s*)?언제|언제\s*(?:환불|입금|취소)|(?:교환|환불|취소)\s*진행|진행\s*상태|처리\s*됐|취소\s*(?:처리|됐|되었|하면)|그냥\s*취소|주문\s*취소|결제\s*취소|취소하고\s*싶|취소\s*해주세요|취소\s*가능한가/i,
};

/** 모호한 교환·환불·취소 요청 — 상품 KB로 답하지 않고 판매자 확인 */
const COMMERCE_ACTION_CONFIRM_SLOT = {
  key: 'commerce_action_confirm',
  label: '교환·환불·취소 요청',
  sellerConfirmOnly: true,
};

const EXCHANGE_RETURN_POLICY_SLOT = {
  key: 'exchange_return_policy',
  label: '교환·반품 정책',
  policyFields: ['exchange_return'],
  re: /교환\s*정책|반품\s*정책|교환\s*가능|반품\s*가능|단순\s*변심|바꿀\s*수\s*있|교환\s*되|반품\s*하|포장\s*(?:을\s*)?뜯|다른\s*걸로\s*(?:바꾸|교환)|색상만\s*바꾸|사이즈\s*(?:변경|바꾸)|옵션\s*(?:변경|바꾸)/i,
};

const REFUND_POLICY_SLOT = {
  key: 'refund_policy',
  label: '환불 정책',
  policyFields: ['refund'],
  re: /환불\s*정책|환불\s*기준|환불\s*기간/i,
};

/** 일반 정책 가능 여부 질문 (개별 주문 진행 단정 금지) */
const POLICY_POSSIBILITY_RE =
  /가능|되나요|될까요|수\s*있|정책|기준|기간|단순\s*변심|포장\s*(?:을\s*)?뜯|이미\s*받았/i;

const EXCHANGE_INTENT_RE =
  /바꾸|교환|반품|색상만|사이즈\s*(?:변경|바꾸)|다른\s*걸로|잘못\s*주문|마음에\s*안\s*들/i;

const REFUND_INTENT_RE =
  /환불|돈\s*돌려|결제\s*취소|취소하고\s*싶|주문\s*취소|취소\s*해주세요|취소\s*가능|취소\s*하면|그냥\s*취소/i;

const SLOT_DEFS = [
  {
    key: 'ingredients_specs',
    label: '성분·재질·사양',
    kbFields: ['specs', 'detail_description', 'extra'],
    // 「사이즈 변경」은 교환 의도 — 치수·스펙 문의의 사이즈만 매칭
    re: /성분|균주|함량|원료|원산지|제조|원단|재질|소재|(?:사이즈|치수)(?!\s*(?:변경|바꾸))|스펙|사양|용량|구성|들어있|포함|단백질|칼로리|카페인/i,
  },
  {
    key: 'usage',
    label: '사용 방법',
    kbFields: ['usage', 'detail_description'],
    re: /사용법|용법|먹는\s*법|섭취|급여량|어떻게\s*쓰|복용/i,
  },
  {
    key: 'options_compat',
    label: '옵션·호환',
    kbFields: ['options_compat', 'detail_description'],
    re: /호환|옵션|기종|모델|사이즈\s*맞|되는지/i,
  },
  {
    key: 'cautions',
    label: '주의사항',
    kbFields: ['cautions', 'detail_description'],
    re: /주의|부작용|알레르기|임산부|아이|반려동물|먹어도|사용해도|괜찮/i,
  },
  {
    key: 'shipping_policy',
    label: '배송 정책',
    policyFields: ['shipping'],
    re: /배송\s*비|택배\s*사|평균\s*배송|영업일|출고\s*기준|무료\s*배송\s*정책/i,
  },
  EXCHANGE_RETURN_POLICY_SLOT,
  REFUND_POLICY_SLOT,
  {
    key: 'customer_service',
    label: '고객센터 안내',
    policyFields: ['customer_service'],
    re: /고객센터|상담\s*시간|문의\s*전화|연락처/i,
  },
  ORDER_REALTIME_SLOT,
];

function nonEmpty(text) {
  return String(text || '').trim().length > 0;
}

function pickKbSnippets(product, fields) {
  if (!product) return [];
  const out = [];
  for (const field of fields || []) {
    const value = String(product[field] || '').trim();
    if (value) out.push({ field, text: value.slice(0, 1200) });
  }
  return out;
}

/** "콜라겐도 들어있나요"처럼 특정 대상 포함 여부 질문에서 대상어 추출 */
export function extractInclusionTargets(question) {
  const text = String(question || '');
  const targets = [];
  // "X도/은/는 들어있|포함|함유" — 조사는 캡처에서 제외
  const re = /([가-힣A-Za-z][가-힣A-Za-z0-9]{1,20}?)(?:도|은|는|이|가)?\s*(?:들어\s*있|포함(?:되|돼|되어)?|함유)/g;
  let m;
  while ((m = re.exec(text))) {
    const t = String(m[1] || '').trim();
    if (t && !/^(이것|저것|제품|상품|성분|함량|여부)$/.test(t)) targets.push(t);
  }
  return [...new Set(targets)];
}

function kbCoversInclusionTargets(snippets, question) {
  const targets = extractInclusionTargets(question);
  if (!targets.length) return { ok: true, missing: [] };
  const blob = snippets.map((s) => s.text).join('\n').toLowerCase();
  const missing = targets.filter((t) => !blob.includes(String(t).toLowerCase()));
  return { ok: missing.length === 0, missing };
}

function pickPolicySnippets(policies, fields) {
  if (!policies) return [];
  const out = [];
  for (const field of fields || []) {
    const value = String(policies[field] || '').trim();
    if (value) out.push({ field, text: value.slice(0, 800) });
  }
  return out;
}

/**
 * 슬롯 우선순위:
 * 1) 주문·실시간(개별 진행/취소/환불 시점)
 * 2) 교환·환불 정책 가능 여부 → 정책 슬롯
 * 3) 교환·환불·취소 요청·모호 표현 → 판매자 확인(상품 KB 금지)
 * 4) 일반 상품/정책 슬롯
 * 5) general_product fallback
 */
export function detectInquirySlots(row) {
  const text = String(row?.content || '');

  if (ORDER_REALTIME_SLOT.re.test(text)) {
    return [ORDER_REALTIME_SLOT];
  }

  const exchangeIntent = EXCHANGE_INTENT_RE.test(text);
  const refundIntent = REFUND_INTENT_RE.test(text);
  if (exchangeIntent || refundIntent) {
    const policyPossibility = POLICY_POSSIBILITY_RE.test(text);
    if (policyPossibility && EXCHANGE_RETURN_POLICY_SLOT.re.test(text)) {
      return [EXCHANGE_RETURN_POLICY_SLOT];
    }
    if (policyPossibility && REFUND_POLICY_SLOT.re.test(text)) {
      return [REFUND_POLICY_SLOT];
    }
    // 개별 요청·모호한 불만/오주문 — 상품 스펙으로 답하지 않음
    return [COMMERCE_ACTION_CONFIRM_SLOT];
  }

  const hit = SLOT_DEFS.filter((slot) => slot.re && slot.re.test(text));
  if (hit.length) return hit;
  return [
    {
      key: 'general_product',
      label: '상품 일반 정보',
      kbFields: ['detail_description', 'specs', 'usage', 'extra'],
      re: /.*/,
    },
  ];
}

/**
 * productNo 없으면 상품명 유사도만으로 KB를 확정하지 않는다.
 */
export function resolveProductKnowledgeMatch({ userId, productNo, productName, listByUser, getByProductNo }) {
  const normalizedNo = String(productNo || '').replace(/[^\d]/g, '');
  if (normalizedNo && typeof getByProductNo === 'function') {
    const row = getByProductNo(userId, normalizedNo);
    if (row) {
      return { status: 'exact', product: row, reason: '' };
    }
    return {
      status: 'seller_confirm',
      product: null,
      reason: '상품번호에 해당하는 등록 상품정보가 없습니다.',
    };
  }

  // productNo 없음: 자동 유사도 매칭 금지
  const name = String(productName || '').trim();
  if (!name) {
    return {
      status: 'seller_confirm',
      product: null,
      reason: '상품번호·상품명이 없어 상품정보를 확정할 수 없습니다.',
    };
  }

  if (typeof listByUser === 'function') {
    const list = listByUser(userId) || [];
    const exactName = list.filter(
      (item) => String(item.product_name || '').trim().toLowerCase() === name.toLowerCase()
    );
    if (exactName.length === 1 && nonEmpty(exactName[0].product_no)) {
      // 이름이 정확히 하나이고 product_no가 있어도, 문의에 productNo가 없으면 확정하지 않음
      return {
        status: 'seller_confirm',
        product: null,
        reason: '문의에 상품번호가 없어 상품명만으로 상품정보를 확정하지 않습니다. 상품번호를 확인하거나 판매자가 지정해 주세요.',
        candidates: exactName.map((p) => ({ productNo: p.product_no, productName: p.product_name })),
      };
    }
  }

  return {
    status: 'seller_confirm',
    product: null,
    reason: '문의에 상품번호가 없어 상품정보를 자동 확정할 수 없습니다.',
  };
}

export function resolveInquiryEvidence({
  row,
  userId = null,
  productKnowledge = null,
  storePolicies = null,
  productMatchStatus = 'none',
  productMatchReason = '',
  officialFacts = [],
  officialMissing = [],
  officialSources = [],
  approvedFaqs = [],
  now = new Date(),
} = {}) {
  const slots = detectInquirySlots(row);
  const resolvedSlots = [];
  const verifiedFacts = [];
  const missingFields = [];
  const sources = [];

  for (const slot of slots) {
    if (slot.orderRealtime) {
      resolvedSlots.push({
        key: slot.key,
        label: slot.label,
        status: 'seller_confirm',
        reason: '실시간 주문·출고·송장·재고는 공식 조회 근거 없이 임의 답변할 수 없습니다.',
      });
      missingFields.push(slot.label);
      continue;
    }

    if (slot.sellerConfirmOnly) {
      resolvedSlots.push({
        key: slot.key,
        label: slot.label,
        status: 'seller_confirm',
        reason:
          '교환·환불·취소 요청은 주문·정책 확인이 필요합니다. 상품 정보만으로 처리 결과를 단정하지 않습니다.',
      });
      missingFields.push(slot.label);
      continue;
    }

    if (productMatchStatus === 'seller_confirm' && (slot.kbFields || []).length) {
      resolvedSlots.push({
        key: slot.key,
        label: slot.label,
        status: 'seller_confirm',
        reason: productMatchReason || '상품정보가 확정되지 않았습니다.',
      });
      missingFields.push(slot.label);
      continue;
    }

    // 승인·유효 필드만 (unverified/HISTORICAL 제외). 상품 예외(KB)가 있으면 정책보다 우선.
    const kbSnippets = pickVerifiedKbSnippets(productKnowledge, slot.kbFields, now);
    const policySnippets = kbSnippets.length
      ? []
      : pickVerifiedPolicySnippets(storePolicies, slot.policyFields, now);
    const cover = kbCoversInclusionTargets([...kbSnippets, ...policySnippets], row?.content);

    if ((kbSnippets.length || policySnippets.length) && cover.ok) {
      for (const snip of kbSnippets) {
        verifiedFacts.push(`[KB:${snip.field}] ${snip.text}`);
        sources.push({
          type: 'kb',
          field: snip.field,
          productNo: productKnowledge?.product_no || productKnowledge?.productNo || null,
          verifiedAt: productKnowledge?.verified_at || productKnowledge?.verifiedAt || null,
          source: snip.source || productKnowledge?.source || 'manual',
        });
      }
      for (const snip of policySnippets) {
        verifiedFacts.push(`[정책:${snip.field}] ${snip.text}`);
        sources.push({
          type: 'kb',
          field: snip.field,
          policyField: true,
          productNo: null,
          verifiedAt: storePolicies?.verified_at || storePolicies?.verifiedAt || null,
          source: snip.source || storePolicies?.source || 'manual',
        });
      }
      resolvedSlots.push({
        key: slot.key,
        label: slot.label,
        status: 'kb_hit',
        reason: '',
      });
      continue;
    }

    if ((kbSnippets.length || policySnippets.length) && !cover.ok) {
      resolvedSlots.push({
        key: slot.key,
        label: slot.label,
        status: 'seller_confirm',
        reason: `등록 상품정보에 "${cover.missing.join(', ')}" 관련 근거가 없어 확인이 필요합니다.`,
      });
      missingFields.push(`${slot.label}(${cover.missing.join(',')})`);
      continue;
    }

    // 본문은 있으나 미승인·만료라 스니펫이 비면 confirm
    const rawKb = pickKbSnippets(productKnowledge, slot.kbFields);
    const rawPolicy = pickPolicySnippets(storePolicies, slot.policyFields);
    if ((rawKb.length || rawPolicy.length) && !kbSnippets.length && !policySnippets.length) {
      resolvedSlots.push({
        key: slot.key,
        label: slot.label,
        status: 'seller_confirm',
        reason: '등록 정보는 있으나 승인·유효기간 기준으로 확정 근거로 쓸 수 없습니다.',
      });
      missingFields.push(slot.label);
      continue;
    }

    resolvedSlots.push({
      key: slot.key,
      label: slot.label,
      status: 'pending_official',
      reason: '',
    });
  }

  const pending = resolvedSlots.filter((s) => s.status === 'pending_official');
  const relatedOfficial = (officialFacts || []).filter(Boolean);
  const hasOfficialSources = (officialSources || []).length > 0;

  if (pending.length && relatedOfficial.length && hasOfficialSources) {
    for (let i = 0; i < relatedOfficial.length; i++) {
      const fact = relatedOfficial[i];
      const src = officialSources[i] || officialSources[0] || null;
      verifiedFacts.push(src ? `[공식:${src}] ${fact}` : `[공식] ${fact}`);
      if (src) sources.push({ type: 'official', urlOrLabel: src });
    }
    for (const slot of pending) {
      slot.status = 'official_hit';
      slot.reason = '';
    }
  } else if (pending.length) {
    const reason = relatedOfficial.length && !hasOfficialSources
      ? '공식 자료 출처를 확인할 수 없어 판매자 확인이 필요합니다.'
      : (officialMissing || []).join('; ') ||
        productMatchReason ||
        '질문에 필요한 등록 상품정보·공식 근거가 없습니다.';
    for (const slot of pending) {
      slot.status = 'seller_confirm';
      slot.reason = reason;
      missingFields.push(slot.label);
    }
  }

  const needsSellerConfirm = resolvedSlots.some((s) => s.status === 'seller_confirm');
  const confirmReasons = resolvedSlots
    .filter((s) => s.status === 'seller_confirm')
    .map((s) => `${s.label}: ${s.reason}`)
    .filter(Boolean);

  const base = {
    slots: resolvedSlots,
    verifiedFacts: uniqueStrings(verifiedFacts).slice(0, 16),
    missingFields: uniqueStrings(missingFields),
    sources,
    needsSellerConfirm,
    confirmReason: confirmReasons.join(' / ').slice(0, 500),
    productMatchStatus,
    userId,
  };

  const judged = finalizeInquiryJudgment({
    evidence: base,
    productKnowledge,
    approvedFaqs,
    productNo: row?.productNo || productKnowledge?.product_no || '',
    question: row?.content || '',
    now,
  });

  return {
    ...base,
    needsSellerConfirm: judged.needsSellerConfirm,
    confirmReason: judged.confirmReason || base.confirmReason,
    verifiedFacts: judged.verifiedFacts.length ? judged.verifiedFacts : base.verifiedFacts,
    sources: judged.sources.length ? judged.sources : base.sources,
    judgment: judged.judgment,
    usedKnowledge: judged.usedKnowledge,
    realtimeRequired: judged.realtimeRequired,
    faqConflict: judged.faqConflict,
  };
}

function uniqueStrings(list) {
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

export function buildSellerConfirmDraft(row, evidence) {
  const missing = (evidence?.missingFields || []).join(', ') || '요청하신 정보';
  const product = String(row?.product || '상품').trim();
  return [
    '안녕하세요 고객님,',
    `${product} 관련 문의해 주셔서 감사합니다.`,
    `${missing}에 대해 확인 후 정확히 안내드리겠습니다.`,
    '확인되는 대로 다시 답변드리겠습니다. 감사합니다.',
  ].join(' ');
}

export function formatVerifiedFactsForPrompt(evidence) {
  return Array.isArray(evidence?.verifiedFacts) ? evidence.verifiedFacts : [];
}
