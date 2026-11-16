/**
 * AI 자동답글 품질 종합 검증 (분석·테스트 전용)
 * - 실제 문의 경로: resolveInquiryEvidence → judgment / usedKnowledge / verifiedFacts
 *   (= /api/generate-reply 의 Gemini 호출 직전 단계)
 * - Gemini API 호출 없음 · 엔진/프롬프트/DB 스키마 수정 없음 · 실고객 게시 없음
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  detectInquirySlots,
  resolveInquiryEvidence,
  resolveProductKnowledgeMatch,
  buildSellerConfirmDraft,
} from '../server/evidence.js';
import { JUDGMENT, filterApprovedFaqs } from '../server/knowledge-judge.js';
import { assessInquiryReplyGrounding } from '../server/prompts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });
const stamp = Date.now();
const NOW = new Date('2026-11-13T14:00:00+09:00');

const PRODUCT_A = {
  product_no: '1001',
  product_name: '오메가3 프리미엄',
  usage: '하루 1포, 식후 섭취',
  specs: 'EPA 500mg / DHA 200mg',
  detail_description: '어유 오메가3 소프트캡슐',
  cautions: '임산부는 상담 후 섭취',
  source: 'SELLER_APPROVED',
  verified_at: '2026-01-01',
  trust_status: 'approved',
  fieldMeta: {
    usage: { source: 'SELLER_APPROVED', trustStatus: 'approved', verifiedAt: '2026-01-01' },
    specs: { source: 'SELLER_APPROVED', trustStatus: 'approved', verifiedAt: '2026-01-01' },
    detail_description: { source: 'SELLER_APPROVED', trustStatus: 'approved', verifiedAt: '2026-01-01' },
    cautions: { source: 'SELLER_APPROVED', trustStatus: 'approved', verifiedAt: '2026-01-01' },
  },
};

const PRODUCT_B_SAME_NAME = {
  product_no: '2002',
  product_name: '오메가3 프리미엄',
  usage: '하루 2포 (타 SKU)',
  specs: 'EPA 100mg (타 SKU)',
  source: 'SELLER_APPROVED',
  verified_at: '2026-01-01',
  trust_status: 'approved',
  fieldMeta: {
    usage: { source: 'SELLER_APPROVED', trustStatus: 'approved', verifiedAt: '2026-01-01' },
    specs: { source: 'SELLER_APPROVED', trustStatus: 'approved', verifiedAt: '2026-01-01' },
  },
};

const PRODUCT_UNVERIFIED = {
  product_no: '3003',
  product_name: '미승인상품',
  usage: '하루 3포 (미승인)',
  specs: '미검증스펙XYZ',
  source: 'NAVER_PRODUCT',
  verified_at: null,
  trust_status: 'unverified',
};

const POLICIES_STORE_A = {
  shipping: '영업일 기준 2~3일 출고',
  exchange_return: '수령 후 7일 이내 단순변심 교환·반품 가능(개봉 시 제한 있을 수 있음)',
  refund: '카드 결제 시 3~5영업일 환불 처리',
  customer_service: '평일 10-17시 고객센터',
  source: 'SELLER_APPROVED',
  verified_at: '2026-01-01',
  trust_status: 'approved',
  fieldMeta: {
    shipping: { source: 'SELLER_APPROVED', trustStatus: 'approved', verifiedAt: '2026-01-01' },
    exchange_return: { source: 'SELLER_APPROVED', trustStatus: 'approved', verifiedAt: '2026-01-01' },
    refund: { source: 'SELLER_APPROVED', trustStatus: 'approved', verifiedAt: '2026-01-01' },
    customer_service: { source: 'SELLER_APPROVED', trustStatus: 'approved', verifiedAt: '2026-01-01' },
  },
};

const POLICIES_STORE_B = {
  shipping: '당일출고(B스토어 전용)',
  exchange_return: '수령 14일 이내 교환(B)',
  source: 'SELLER_APPROVED',
  verified_at: '2026-01-01',
  trust_status: 'approved',
  fieldMeta: {
    shipping: { source: 'SELLER_APPROVED', trustStatus: 'approved', verifiedAt: '2026-01-01' },
    exchange_return: { source: 'SELLER_APPROVED', trustStatus: 'approved', verifiedAt: '2026-01-01' },
  },
};

const FAQ_APPROVED = {
  id: 'faq-ok-1',
  status: 'approved',
  trustStatus: 'approved',
  source: 'SELLER_APPROVED',
  productNo: '1001',
  question: '사용법이 어떻게 되나요?',
  approvedAnswer: '하루 1포, 식후 섭취하세요.',
  approvedAt: '2026-06-01',
  validFrom: null,
  validTo: null,
};

const FAQ_PENDING = {
  id: 'faq-pend-1',
  status: 'pending',
  trustStatus: 'unverified',
  source: 'AI_DERIVED',
  productNo: '1001',
  question: '사용법이 어떻게 되나요?',
  approvedAnswer: '하루 5포 드세요(미승인 허위).',
  approvedAt: null,
};

const FAQ_HISTORICAL = {
  id: 'faq-hist-1',
  status: 'approved',
  trustStatus: 'approved',
  source: 'HISTORICAL_QA',
  productNo: '1001',
  question: '배송은 며칠 걸리나요?',
  approvedAnswer: '무조건 내일 도착합니다.',
  approvedAt: '2025-01-01',
};

const FAQ_CONFLICT_A = {
  id: 'faq-c1',
  status: 'approved',
  trustStatus: 'approved',
  source: 'SELLER_APPROVED',
  productNo: '1001',
  question: '하루 몇 포 먹나요?',
  approvedAnswer: '하루 1포입니다.',
  approvedAt: '2026-06-01',
};

const FAQ_CONFLICT_B = {
  id: 'faq-c2',
  status: 'approved',
  trustStatus: 'approved',
  source: 'SELLER_APPROVED',
  productNo: '1001',
  question: '하루 섭취량이 궁금해요',
  approvedAnswer: '하루 3포입니다.',
  approvedAt: '2026-06-02',
};

const FAQ_OTHER_PRODUCT = {
  id: 'faq-other',
  status: 'approved',
  trustStatus: 'approved',
  source: 'SELLER_APPROVED',
  productNo: '2002',
  question: '사용법이 어떻게 되나요?',
  approvedAnswer: '하루 2포 (상품 2002 전용).',
  approvedAt: '2026-06-01',
};

function runCase(c) {
  const slots = detectInquirySlots(c.row);
  const slotKeys = slots.map((s) => s.key);
  const ev = resolveInquiryEvidence({
    row: c.row,
    productKnowledge: c.productKnowledge,
    storePolicies: c.storePolicies,
    productMatchStatus: c.productMatchStatus ?? (c.productKnowledge ? 'exact' : 'seller_confirm'),
    productMatchReason: c.productMatchReason || '',
    approvedFaqs: c.approvedFaqs || [],
    officialFacts: c.officialFacts || [],
    officialMissing: c.officialMissing || [],
    officialSources: c.officialSources || [],
    now: NOW,
  });

  const draft =
    ev.needsSellerConfirm || ev.judgment !== JUDGMENT.ANSWERABLE
      ? buildSellerConfirmDraft(c.row, ev)
      : `(ANSWERABLE — Gemini 미호출) 근거: ${(ev.verifiedFacts || []).join(' | ')}`;

  // 환각 초안 그라운딩 샘플 (엔진 수정 없이 기존 assess 경로만 검증)
  const groundingChecks = (c.hallucinationSamples || []).map((sample) => {
    const g = assessInquiryReplyGrounding(
      c.row,
      sample.text,
      sample.references || [],
      ev.verifiedFacts || [],
      ''
    );
    const expectGrounded = !!sample.expectGrounded;
    return {
      sample: sample.text.slice(0, 80),
      grounded: g.grounded,
      unsupported: g.unsupported,
      expectGrounded,
      ok: g.grounded === expectGrounded,
    };
  });

  const fails = [];
  if (c.expectJudgments && !c.expectJudgments.includes(ev.judgment)) {
    fails.push(`judgment expect ${c.expectJudgments.join('|')} got ${ev.judgment}`);
  }
  if (c.expectSlotAny) {
    const ok = c.expectSlotAny.some((k) => slotKeys.includes(k));
    if (!ok) fails.push(`slot expect ${c.expectSlotAny.join('|')} got ${slotKeys.join(',')}`);
  }
  if (c.forbidJudgment && c.forbidJudgment.includes(ev.judgment)) {
    fails.push(`judgment ${ev.judgment} must not occur`);
  }
  if (c.requireUsedType) {
    for (const t of c.requireUsedType) {
      if (!(ev.usedKnowledge || []).some((u) => u.type === t)) {
        fails.push(`usedKnowledge missing type=${t}`);
      }
    }
  }
  if (c.forbidUsedType) {
    for (const t of c.forbidUsedType) {
      if ((ev.usedKnowledge || []).some((u) => u.type === t)) {
        fails.push(`usedKnowledge must not include type=${t}`);
      }
    }
  }
  if (c.forbidUsedIdIncludes) {
    for (const frag of c.forbidUsedIdIncludes) {
      if ((ev.usedKnowledge || []).some((u) => String(u.id).includes(frag))) {
        fails.push(`usedKnowledge id must not include ${frag}`);
      }
    }
  }
  if (c.requireVerifiedIncludes) {
    for (const frag of c.requireVerifiedIncludes) {
      if (!(ev.verifiedFacts || []).some((f) => String(f).includes(frag))) {
        fails.push(`verifiedFacts missing "${frag}"`);
      }
    }
  }
  if (c.forbidVerifiedIncludes) {
    for (const frag of c.forbidVerifiedIncludes) {
      if ((ev.verifiedFacts || []).some((f) => String(f).includes(frag))) {
        fails.push(`verifiedFacts must not include "${frag}"`);
      }
    }
  }
  if (c.expectNeedsConfirm != null && !!ev.needsSellerConfirm !== !!c.expectNeedsConfirm) {
    fails.push(`needsSellerConfirm expect ${c.expectNeedsConfirm} got ${ev.needsSellerConfirm}`);
  }
  if (c.expectFaqConflict != null && !!ev.faqConflict !== !!c.expectFaqConflict) {
    fails.push(`faqConflict expect ${c.expectFaqConflict} got ${ev.faqConflict}`);
  }
  for (const g of groundingChecks) {
    if (!g.ok) fails.push(`grounding sample expectGrounded=${g.expectGrounded} got ${g.grounded}`);
  }
  if (typeof c.extraCheck === 'function') {
    const extra = c.extraCheck({ ev, slotKeys, draft });
    if (extra) fails.push(...(Array.isArray(extra) ? extra : [extra]));
  }

  return {
    id: c.id,
    title: c.title,
    input: c.row,
    searchedSlots: slotKeys,
    searchedKnowledge: {
      product: c.productKnowledge
        ? { productNo: c.productKnowledge.product_no, trust: c.productKnowledge.trust_status }
        : null,
      policies: c.storePolicies ? Object.keys(c.storePolicies.fieldMeta || {}) : [],
      faqs: (c.approvedFaqs || []).map((f) => ({
        id: f.id,
        status: f.status,
        source: f.source,
        productNo: f.productNo,
      })),
    },
    usedKnowledge: ev.usedKnowledge,
    verifiedFacts: ev.verifiedFacts,
    generatedReplyOrDraft: draft,
    judgment: ev.judgment,
    needsSellerConfirm: ev.needsSellerConfirm,
    confirmReason: ev.confirmReason,
    faqConflict: ev.faqConflict,
    realtimeRequired: ev.realtimeRequired,
    expected: c.expectedNote,
    groundingChecks,
    status: fails.length ? 'FAIL' : 'PASS',
    fails,
  };
}

const scenarios = [
  {
    id: 1,
    title: '승인된 정책이 있는 일반 문의',
    row: { content: '반품 가능한가요? 이미 받았는데 단순 변심입니다.', productNo: '1001', product: '오메가3 프리미엄' },
    productKnowledge: PRODUCT_A,
    storePolicies: POLICIES_STORE_A,
    approvedFaqs: [],
    expectJudgments: [JUDGMENT.ANSWERABLE],
    expectSlotAny: ['exchange_return_policy'],
    requireUsedType: ['policy'],
    requireVerifiedIncludes: ['exchange_return'],
    expectedNote: '승인 교환·반품 정책으로 ANSWERABLE, usedKnowledge에 policy',
    hallucinationSamples: [
      {
        text: '내일 무조건 환불 입금됩니다.',
        expectGrounded: false,
      },
      {
        text: '수령 후 7일 이내 단순변심 교환·반품 가능 안내드립니다.',
        expectGrounded: true,
      },
    ],
  },
  {
    id: 2,
    title: '승인된 상품 지식이 있는 상품 문의',
    row: { content: '사용법이 어떻게 되나요?', productNo: '1001', product: '오메가3 프리미엄' },
    productKnowledge: PRODUCT_A,
    storePolicies: POLICIES_STORE_A,
    approvedFaqs: [FAQ_APPROVED],
    expectJudgments: [JUDGMENT.ANSWERABLE],
    expectSlotAny: ['usage'],
    requireVerifiedIncludes: ['하루 1포'],
    forbidVerifiedIncludes: ['하루 5포'],
    expectedNote: '승인 usage/FAQ로 ANSWERABLE, 미승인 허위 미포함',
  },
  {
    id: 3,
    title: '관련 지식이 전혀 없는 문의',
    row: { content: '성분이 뭐예요?', productNo: '99999', product: '없는상품' },
    productKnowledge: null,
    storePolicies: null,
    productMatchStatus: 'seller_confirm',
    productMatchReason: '상품번호에 해당하는 등록 상품정보가 없습니다.',
    approvedFaqs: [],
    expectJudgments: [JUDGMENT.SELLER_CONFIRM],
    forbidJudgment: [JUDGMENT.ANSWERABLE],
    expectNeedsConfirm: true,
    expectedNote: 'KB/정책 없음 → SELLER_CONFIRM, ANSWERABLE 금지',
  },
  {
    id: 4,
    title: '미승인 지식만 존재하는 문의',
    row: { content: '사용법이 어떻게 되나요?', productNo: '3003', product: '미승인상품' },
    productKnowledge: PRODUCT_UNVERIFIED,
    storePolicies: null,
    approvedFaqs: [FAQ_PENDING],
    expectJudgments: [JUDGMENT.SELLER_CONFIRM],
    forbidJudgment: [JUDGMENT.ANSWERABLE],
    forbidVerifiedIncludes: ['하루 3포', '하루 5포'],
    expectedNote: 'unverified/pending은 확정 근거 금지 → SELLER_CONFIRM',
  },
  {
    id: 5,
    title: '승인 지식과 미승인 지식이 충돌하는 문의',
    row: { content: '하루 몇 포 먹나요? 사용법 알려주세요', productNo: '1001', product: '오메가3 프리미엄' },
    productKnowledge: PRODUCT_A,
    storePolicies: POLICIES_STORE_A,
    approvedFaqs: [FAQ_CONFLICT_A, FAQ_CONFLICT_B, FAQ_PENDING],
    expectJudgments: [JUDGMENT.SELLER_CONFIRM],
    expectFaqConflict: true,
    forbidVerifiedIncludes: ['하루 5포'],
    expectedNote: '승인 FAQ 답변 충돌 → faqConflict + SELLER_CONFIRM, pending 미사용',
  },
  {
    id: 6,
    title: '서로 다른 스토어의 유사 상품 문의',
    row: { content: '평균 배송은 영업일 기준으로 얼마나 걸리나요?', productNo: '1001', product: '오메가3 프리미엄' },
    productKnowledge: PRODUCT_A,
    storePolicies: POLICIES_STORE_A,
    approvedFaqs: [],
    expectJudgments: [JUDGMENT.ANSWERABLE],
    expectSlotAny: ['shipping_policy'],
    requireVerifiedIncludes: ['영업일 기준 2~3일'],
    forbidVerifiedIncludes: ['당일출고(B스토어'],
    extraCheck: ({ ev }) => {
      // Store B 정책이 주입되지 않았는지 확인 (격리: 시나리오에 A만 주입)
      const leak = (ev.verifiedFacts || []).some((f) => String(f).includes('당일출고'));
      return leak ? ['store-B 정책 혼입'] : [];
    },
    expectedNote: 'store-A 정책만 사용, store-B 문구 미혼입',
  },
  {
    id: 7,
    title: '과거 Q&A에만 답변 근거가 존재하는 문의',
    row: { content: '배송비·영업일 출고 기준이 어떻게 되나요?', productNo: '1001', product: '오메가3 프리미엄' },
    productKnowledge: null,
    storePolicies: null,
    productMatchStatus: 'exact',
    approvedFaqs: [FAQ_HISTORICAL],
    expectJudgments: [JUDGMENT.SELLER_CONFIRM],
    forbidJudgment: [JUDGMENT.ANSWERABLE],
    forbidVerifiedIncludes: ['무조건 내일'],
    forbidUsedIdIncludes: ['faq-hist'],
    expectedNote: 'HISTORICAL_QA만으로는 정책 확정 금지',
    extraCheck: () => {
      const usable = filterApprovedFaqs([FAQ_HISTORICAL], {
        productNo: '1001',
        question: '배송비·영업일 출고 기준이 어떻게 되나요?',
        now: NOW,
      });
      return usable.length ? ['HISTORICAL_QA가 filterApprovedFaqs에 통과함'] : [];
    },
  },
  {
    id: 8,
    title: '배송 예정일을 묻는 문의',
    row: { content: '제 주문 언제 오나요? 송장 나왔나요?', productNo: '1001', product: '오메가3 프리미엄' },
    productKnowledge: PRODUCT_A,
    storePolicies: POLICIES_STORE_A,
    approvedFaqs: [FAQ_HISTORICAL],
    expectJudgments: [JUDGMENT.REALTIME_REQUIRED],
    expectSlotAny: ['order_realtime'],
    forbidVerifiedIncludes: ['무조건 내일'],
    expectedNote: '개별 배송·송장 → REALTIME_REQUIRED, 과거 QA로 확정 금지',
    hallucinationSamples: [
      { text: '내일 오전 도착 확정입니다.', expectGrounded: false },
    ],
  },
  {
    id: 9,
    title: '교환·반품 가능 여부를 묻는 문의',
    row: { content: '포장 뜯었는데 교환되나요?', productNo: '1001', product: '오메가3 프리미엄' },
    productKnowledge: PRODUCT_A,
    storePolicies: POLICIES_STORE_A,
    approvedFaqs: [],
    expectJudgments: [JUDGMENT.ANSWERABLE, JUDGMENT.SELLER_CONFIRM],
    expectSlotAny: ['exchange_return_policy'],
    forbidUsedType: [], // product-only ANSWERABLE 방지: 아래 extra
    extraCheck: ({ ev, slotKeys }) => {
      const onlyProduct =
        ev.judgment === JUDGMENT.ANSWERABLE &&
        (ev.usedKnowledge || []).length > 0 &&
        (ev.usedKnowledge || []).every((u) => u.type === 'product');
      if (onlyProduct && slotKeys.includes('exchange_return_policy')) {
        return ['교환 문의를 상품 KB만으로 ANSWERABLE 처리'];
      }
      return [];
    },
    expectedNote: '교환 정책 슬롯, 상품 KB만으로 확정하지 않음',
  },
  {
    id: 10,
    title: '상품 효능을 묻는 문의',
    row: { content: '이거 먹으면 혈압이 좋아지나요? 효능이 궁금해요', productNo: '1001', product: '오메가3 프리미엄' },
    productKnowledge: PRODUCT_A,
    storePolicies: POLICIES_STORE_A,
    approvedFaqs: [],
    // 효능 전용 슬롯 없음 → general_product로 떨어질 수 있음. ANSWERABLE이어도
    // 승인된 효능 필드가 없으면 verified에 치료·효능 단정 문구가 없어야 함.
    expectJudgments: [JUDGMENT.ANSWERABLE, JUDGMENT.SELLER_CONFIRM],
    forbidVerifiedIncludes: ['혈압', '치료', '완치', '효능 보장'],
    expectedNote: '등록 지식에 효능 클레임 없음 → verifiedFacts에 효능 단정 금지 (LLM 프롬프트 금지는 별도)',
    hallucinationSamples: [
      {
        text: '이 제품은 혈압을 정상으로 만들고 심혈관 질환을 예방합니다.',
        expectGrounded: false,
      },
    ],
    extraCheck: ({ ev }) => {
      // 위험: general_product가 detail/specs로 ANSWERABLE이 되면 LLM이 효능을 지어낼 여지
      const risks = [];
      if (ev.judgment === JUDGMENT.ANSWERABLE) {
        risks.push(
          'WARN: 효능 문의가 ANSWERABLE — Gemini 단계에서 과장 방지 프롬프트에만 의존 (판정 단계 효능 슬롯 없음)'
        );
      }
      // WARN은 FAIL로 치지 않음 — 별도 warn 필드로 보고. 여기선 PASS 유지하되 note만.
      return [];
    },
  },
  {
    id: 11,
    title: '재고 및 실시간 주문 상태를 묻는 문의',
    row: { content: '지금 재고 있나요? 제 주문 출고 됐나요?', productNo: '1001', product: '오메가3 프리미엄' },
    productKnowledge: PRODUCT_A,
    storePolicies: POLICIES_STORE_A,
    approvedFaqs: [],
    expectJudgments: [JUDGMENT.REALTIME_REQUIRED],
    expectSlotAny: ['order_realtime'],
    expectedNote: '재고·출고 실시간 → REALTIME_REQUIRED',
  },
  {
    id: 12,
    title: '상품명은 같지만 상품 식별번호가 다른 문의',
    row: { content: '사용법이 어떻게 되나요?', productNo: '1001', product: '오메가3 프리미엄' },
    productKnowledge: PRODUCT_A,
    storePolicies: POLICIES_STORE_A,
    approvedFaqs: [FAQ_OTHER_PRODUCT, FAQ_APPROVED],
    expectJudgments: [JUDGMENT.ANSWERABLE],
    forbidVerifiedIncludes: ['하루 2포 (상품 2002'],
    requireVerifiedIncludes: ['하루 1포'],
    extraCheck: ({ ev }) => {
      const leak = (ev.usedKnowledge || []).some(
        (u) => String(u.productNo || '') === '2002' || String(u.id).includes('faq-other')
      );
      return leak ? ['타 productNo FAQ 혼입'] : [];
    },
    expectedNote: '동일 상품명·다른 productNo FAQ 교차 금지',
  },
  {
    id: 13,
    title: '질문에 여러 조건이 섞여 있는 복합 문의',
    row: {
      content: '사용법도 알려주시고 교환 가능한지도 궁금하고 제 주문 송장도 확인해주세요',
      productNo: '1001',
      product: '오메가3 프리미엄',
    },
    productKnowledge: PRODUCT_A,
    storePolicies: POLICIES_STORE_A,
    approvedFaqs: [FAQ_APPROVED],
    // order_realtime이 우선이면 REALTIME만 반환 (복합 슬롯 미분해)
    expectJudgments: [JUDGMENT.REALTIME_REQUIRED, JUDGMENT.SELLER_CONFIRM],
    expectSlotAny: ['order_realtime', 'usage', 'exchange_return_policy', 'commerce_action_confirm'],
    expectedNote: '실시간 포함 복합 → 최소 REALTIME/CONFIRM (단정 ANSWERABLE 금지)',
    forbidJudgment: [JUDGMENT.ANSWERABLE],
  },
  {
    id: 14,
    title: '질문 자체가 모호하거나 정보가 부족한 문의',
    row: { content: '이거 괜찮은가요?', productNo: '', product: '오메가3 프리미엄' },
    productKnowledge: null,
    storePolicies: POLICIES_STORE_A,
    productMatchStatus: 'seller_confirm',
    productMatchReason: '문의에 상품번호가 없어 상품정보를 자동 확정할 수 없습니다.',
    approvedFaqs: [],
    expectJudgments: [JUDGMENT.SELLER_CONFIRM],
    forbidJudgment: [JUDGMENT.ANSWERABLE],
    expectedNote: '모호·상품번호 없음 → SELLER_CONFIRM',
    extraCheck: () => {
      const match = resolveProductKnowledgeMatch({
        userId: 1,
        productNo: '',
        productName: '오메가3 프리미엄',
        listByUser: () => [PRODUCT_A, PRODUCT_B_SAME_NAME],
        getByProductNo: () => null,
      });
      if (match.status === 'exact') return ['상품명만으로 exact 매칭되면 안 됨'];
      return [];
    },
  },
];

// 추가 관찰: 「배송 예정일이 언제인가요?」(실시간 정규식 미일치 가능)
const edgeDeliveryEta = runCase({
  id: '8b',
  title: '[관찰] 배송 예정일 표현 (송장/제주문 없이)',
  row: { content: '배송 예정일이 언제인가요?', productNo: '1001', product: '오메가3 프리미엄' },
  productKnowledge: PRODUCT_A,
  storePolicies: POLICIES_STORE_A,
  approvedFaqs: [],
  // 기대: 확정 일자를 단정하지 않아야 함. 현재 슬롯이 shipping/general이면 위험 신호.
  expectJudgments: [JUDGMENT.REALTIME_REQUIRED, JUDGMENT.SELLER_CONFIRM, JUDGMENT.ANSWERABLE],
  expectedNote: '관찰용 — PASS/FAIL은 위험 목록에서 별도 평가',
  extraCheck: ({ ev, slotKeys }) => {
    // 기록만: ANSWERABLE + shipping만으로 날짜 단정 여지
    if (ev.judgment === JUDGMENT.ANSWERABLE && !slotKeys.includes('order_realtime')) {
      return [];
    }
    return [];
  },
});

const results = scenarios.map(runCase);
results.push(edgeDeliveryEta);

const core = results.filter((r) => typeof r.id === 'number');
const pass = core.filter((r) => r.status === 'PASS').length;
const fail = core.filter((r) => r.status === 'FAIL').length;

const risks = [];
for (const r of results) {
  if (r.status === 'FAIL') {
    risks.push({ id: r.id, title: r.title, severity: 'FAIL', detail: r.fails });
  }
}
// 효능 ANSWERABLE 위험
const s10 = results.find((r) => r.id === 10);
if (s10?.judgment === JUDGMENT.ANSWERABLE) {
  risks.push({
    id: 10,
    title: s10.title,
    severity: 'HIGH',
    detail: [
      '효능 문의가 전용 슬롯 없이 general_product 등으로 ANSWERABLE 가능. 과장 방지는 Gemini 하드룰/그라운딩에만 의존.',
    ],
  });
}
const s8b = results.find((r) => r.id === '8b');
if (s8b && s8b.judgment === JUDGMENT.ANSWERABLE && !(s8b.searchedSlots || []).includes('order_realtime')) {
  risks.push({
    id: '8b',
    title: s8b.title,
    severity: 'HIGH',
    detail: [
      `「배송 예정일이 언제인가요?」가 order_realtime이 아닌 slots=[${(s8b.searchedSlots || []).join(',')}] + judgment=${s8b.judgment}. 정책 문구로 개별 예정일 단정 여지.`,
    ],
  });
}
const s13 = results.find((r) => r.id === 13);
if (s13 && (s13.searchedSlots || []).length === 1 && s13.searchedSlots[0] === 'order_realtime') {
  risks.push({
    id: 13,
    title: s13.title,
    severity: 'MED',
    detail: [
      '복합 문의에서 order_realtime이 다른 슬롯(사용법·교환)을 가림 — 실시간 우선은 안전하나 부분 답변 누락 가능.',
    ],
  });
}

const report = {
  title: 'AI 자동답글 품질 종합 검증',
  stamp,
  path: 'resolveInquiryEvidence + assessInquiryReplyGrounding (generate-reply 직전 경로)',
  gemini: { called: false, calls: 0, costUsd: 0, note: '판정·근거 검증은 mock/로컬. Gemini 미호출.' },
  summary: { coreScenarios: core.length, pass, fail, observations: results.length - core.length },
  risks,
  results,
};

const jsonPath = path.join(outDir, `reply-quality-${stamp}.json`);
const mdPath = path.join(outDir, `reply-quality-report.md`);
fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');

const mdLines = [
  '# AI 자동답글 품질 종합 검증 보고',
  '',
  `일시 스탬프: ${stamp}`,
  `핵심 시나리오: ${pass} PASS / ${fail} FAIL (총 ${core.length})`,
  `Gemini 호출: 0회 (비용 $0)`,
  '',
  '## 시나리오별 결과',
  '',
];
for (const r of results) {
  mdLines.push(`### ${r.id}. ${r.title} — **${r.status}**`);
  mdLines.push(`- 입력: ${r.input.content}`);
  mdLines.push(`- slots: ${(r.searchedSlots || []).join(', ')}`);
  mdLines.push(`- judgment: ${r.judgment}`);
  mdLines.push(`- usedKnowledge: ${JSON.stringify(r.usedKnowledge)}`);
  mdLines.push(`- verifiedFacts: ${(r.verifiedFacts || []).slice(0, 3).join(' · ')}`);
  mdLines.push(`- 기대: ${r.expected}`);
  if (r.fails?.length) mdLines.push(`- 실패: ${r.fails.join('; ')}`);
  mdLines.push('');
}
mdLines.push('## 위험');
for (const risk of risks) {
  mdLines.push(`- [${risk.severity}] #${risk.id} ${risk.title}: ${risk.detail.join(' ')}`);
}
fs.writeFileSync(mdPath, mdLines.join('\n'), 'utf8');

console.log(JSON.stringify({ summary: report.summary, risks: risks.length, jsonPath, mdPath }, null, 2));
for (const r of results) {
  console.log(`[${r.status}] #${r.id} ${r.title} → ${r.judgment} slots=${(r.searchedSlots || []).join(',')}`);
  if (r.fails?.length) console.log('  FAIL:', r.fails.join('; '));
}
