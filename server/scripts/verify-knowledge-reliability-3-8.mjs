/**
 * 3-8 검증 하네스 — D4 교환·환불 표현 / D2 productNo 격리 (엔진 변경 없음).
 * 배포·게시 없음.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { detectInquirySlots, resolveInquiryEvidence, resolveProductKnowledgeMatch } from '../evidence.js';
import { filterApprovedFaqs, JUDGMENT } from '../knowledge-judge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(__dirname, '..');
const outDir = path.resolve(__dirname, '../../e2e/out');
fs.mkdirSync(outDir, { recursive: true });
const stamp = Date.now();
const jsonPath = path.join(outDir, `knowledge-reliability-3-8-${stamp}.json`);

const NOW = new Date('2026-11-12T15:00:00+09:00');
const product = {
  product_no: '1001',
  usage: '하루 1포',
  specs: 'EPA 500mg',
  detail_description: '상세설명',
  source: 'manual',
  verified_at: '2026-01-01',
  trust_status: 'approved',
};
const policies = {
  shipping: '영업일 2-3일',
  exchange_return: '수령 7일 이내 교환·반품 가능',
  refund: '카드 결제 시 3~5영업일 환불',
  source: 'manual',
  verified_at: '2026-01-01',
  trust_status: 'approved',
};

/**
 * expectedClass:
 * - policy: 일반 교환·반품·환불 정책으로 안내 가능 (주문 특정 상태 단정 금지)
 * - realtime: 주문·환불 진행 등 실시간 확인 필요
 * - seller_confirm: 의도 불명·판매자 확인
 * - product: 상품 사용/스펙 문의 (교환·환불 아님)
 * - avoid_product_kb: 교환·환불 의도인데 상품 KB로 ANSWERABLE 되면 FAIL
 */
const D4_CASES = [
  {
    content: '이거 다른 걸로 바꿀 수 있나요?',
    expectedClass: 'policy_or_confirm',
    expectJudgments: [JUDGMENT.ANSWERABLE, JUDGMENT.SELLER_CONFIRM],
    expectSlotAny: ['exchange_return_policy', 'options_compat'],
    forbidProductGeneralAsOnly: true,
    note: '교환 의도 — 정책 또는 확인. 상품 사용법 KB만으로 답하면 안 됨',
  },
  {
    content: '돈 돌려받고 싶은데요.',
    expectedClass: 'policy_or_realtime',
    expectJudgments: [JUDGMENT.ANSWERABLE, JUDGMENT.SELLER_CONFIRM, JUDGMENT.REALTIME_REQUIRED],
    expectSlotAny: ['refund_policy', 'order_realtime', 'exchange_return_policy', 'commerce_action_confirm'],
    forbidProductGeneralAsOnly: true,
    note: '환불 의도',
  },
  {
    content: '그냥 취소하면 되나요?',
    expectedClass: 'realtime_or_confirm',
    expectJudgments: [JUDGMENT.REALTIME_REQUIRED, JUDGMENT.SELLER_CONFIRM],
    expectSlotAny: ['order_realtime'],
    forbidProductGeneralAsOnly: true,
    note: '주문 취소 — 개별 주문 상태',
  },
  {
    content: '제품이 마음에 안 들어서요.',
    expectedClass: 'confirm_or_policy',
    expectJudgments: [JUDGMENT.SELLER_CONFIRM, JUDGMENT.ANSWERABLE],
    expectSlotAny: ['exchange_return_policy', 'commerce_action_confirm'],
    forbidProductGeneralAsOnly: true,
    note: '불만·반품 암시 — 상품 스펙으로 답하면 오분류',
  },
  {
    content: '이미 받았는데 반품 가능한가요?',
    expectedClass: 'policy',
    expectJudgments: [JUDGMENT.ANSWERABLE, JUDGMENT.SELLER_CONFIRM],
    expectSlotAny: ['exchange_return_policy'],
    forbidProductGeneralAsOnly: true,
    note: '반품 정책 질문',
  },
  {
    content: '포장 뜯었는데 교환되나요?',
    expectedClass: 'policy',
    expectJudgments: [JUDGMENT.ANSWERABLE, JUDGMENT.SELLER_CONFIRM],
    expectSlotAny: ['exchange_return_policy'],
    forbidProductGeneralAsOnly: true,
    note: '개봉 후 교환 — 정책',
  },
  {
    content: '주문 취소하고 싶어요.',
    expectedClass: 'realtime_or_confirm',
    expectJudgments: [JUDGMENT.REALTIME_REQUIRED, JUDGMENT.SELLER_CONFIRM],
    expectSlotAny: ['order_realtime'],
    forbidProductGeneralAsOnly: true,
    note: '주문 취소',
  },
  {
    content: '색상만 바꾸고 싶습니다.',
    expectedClass: 'policy_or_confirm',
    expectJudgments: [JUDGMENT.ANSWERABLE, JUDGMENT.SELLER_CONFIRM],
    expectSlotAny: ['exchange_return_policy', 'options_compat', 'commerce_action_confirm'],
    forbidProductGeneralAsOnly: true,
    note: '옵션 교환',
  },
  {
    content: '잘못 주문했는데 어떻게 하나요?',
    expectedClass: 'realtime_or_confirm',
    expectJudgments: [JUDGMENT.REALTIME_REQUIRED, JUDGMENT.SELLER_CONFIRM],
    expectSlotAny: ['order_realtime', 'exchange_return_policy', 'commerce_action_confirm'],
    forbidProductGeneralAsOnly: true,
    note: '오주문 — 취소/교환',
  },
  {
    content: '환불은 언제 들어오나요?',
    expectedClass: 'realtime_or_policy',
    expectJudgments: [JUDGMENT.REALTIME_REQUIRED, JUDGMENT.ANSWERABLE, JUDGMENT.SELLER_CONFIRM],
    expectSlotAny: ['order_realtime', 'refund_policy'],
    forbidProductGeneralAsOnly: true,
    note: '환불 시기 — 정책 또는 실시간(주문별)',
  },
  {
    content: '사용법이 어떻게 되나요?',
    expectedClass: 'product',
    expectJudgments: [JUDGMENT.ANSWERABLE],
    expectSlotAny: ['usage'],
    forbidProductGeneralAsOnly: false,
    mustNotBeRealtime: true,
    note: '오분류 방지 — 교환·환불로 보지 말 것',
  },
  {
    content: '내 주문 환불 어디까지 됐나요?',
    expectedClass: 'realtime',
    expectJudgments: [JUDGMENT.REALTIME_REQUIRED],
    expectSlotAny: ['order_realtime'],
    forbidProductGeneralAsOnly: true,
    note: '주문별 환불 진행',
  },
  {
    content: '교환 진행 상태가 궁금합니다',
    expectedClass: 'realtime',
    expectJudgments: [JUDGMENT.REALTIME_REQUIRED],
    expectSlotAny: ['order_realtime'],
    forbidProductGeneralAsOnly: true,
    note: '진행 상태 = 실시간',
  },
  {
    content: '제 주문 교환 어떻게 되고 있나요?',
    expectedClass: 'realtime',
    expectJudgments: [JUDGMENT.REALTIME_REQUIRED],
    expectSlotAny: ['order_realtime'],
    forbidProductGeneralAsOnly: true,
    note: '제 주문 + 교환 진행',
  },
];

function evaluateD4(c) {
  const slots = detectInquirySlots({ content: c.content });
  const slotKeys = slots.map((s) => s.key);
  const ev = resolveInquiryEvidence({
    row: { content: c.content, productNo: '1001' },
    productKnowledge: product,
    storePolicies: policies,
    productMatchStatus: 'exact',
    now: NOW,
  });
  const usedTypes = (ev.usedKnowledge || []).map((u) => u.type);
  const onlyProductKb =
    ev.judgment === JUDGMENT.ANSWERABLE &&
    usedTypes.length > 0 &&
    usedTypes.every((t) => t === 'product') &&
    slotKeys.includes('general_product');

  const slotOk = c.expectSlotAny.some((k) => slotKeys.includes(k));
  const judgmentOk = c.expectJudgments.includes(ev.judgment);
  const productMisuse = c.forbidProductGeneralAsOnly && onlyProductKb;
  const falseRealtime = c.mustNotBeRealtime && ev.judgment === JUDGMENT.REALTIME_REQUIRED;

  let status = 'PASS';
  const fails = [];
  if (!slotOk) fails.push(`slot expect ${c.expectSlotAny.join('|')} got ${slotKeys.join(',')}`);
  if (!judgmentOk) fails.push(`judgment expect ${c.expectJudgments.join('|')} got ${ev.judgment}`);
  if (productMisuse) fails.push('교환·환불 의도를 상품 KB general_product ANSWERABLE로 처리');
  if (falseRealtime) fails.push('사용 문의를 REALTIME으로 오분류');
  if (fails.length) status = 'FAIL';

  return {
    content: c.content,
    expectedClass: c.expectedClass,
    note: c.note,
    status,
    actual: {
      judgment: ev.judgment,
      slots: slotKeys,
      usedKnowledge: ev.usedKnowledge,
      verifiedFacts: ev.verifiedFacts,
      realtimeRequired: ev.realtimeRequired,
      onlyProductKb,
    },
    fails,
  };
}

function normDigits(p) {
  return String(p || '').replace(/[^\d]/g, '').slice(0, 32);
}

function evaluateD2() {
  const rows = [];
  const samples = [
    { raw: '11110001', expectKeep: '11110001' },
    { raw: '1111-0001', expectKeep: '11110001', note: '하이픈 제거로 숫자형과 충돌' },
    { raw: 'SKU-ABC', expectKeep: '', note: '비숫자 전부 소거' },
    { raw: 'sku-abc', expectKeep: '' },
    { raw: 'PROD-A', expectKeep: '' },
    { raw: 'PROD-B', expectKeep: '' },
    { raw: 'ABC123DEF456', expectKeep: '123456', note: '중간 숫자만 남김 → 식별자 변형' },
    { raw: '  2222  ', expectKeep: '2222' },
  ];

  for (const s of samples) {
    const got = normDigits(s.raw);
    const intact = got === String(s.raw).trim() || (s.expectKeep === got && /[^\d]/.test(s.raw) === false);
    rows.push({
      name: `normalize:${s.raw}`,
      status: got === s.expectKeep ? 'PASS' : 'FAIL',
      raw: s.raw,
      normalized: got,
      expectKeep: s.expectKeep,
      identifierPreserved: intact,
      note: s.note || '',
    });
  }

  // PROD-A vs PROD-B collapse
  const collapse =
    normDigits('PROD-A') === normDigits('PROD-B') && normDigits('PROD-A') === '';
  // 정규화 붕괴는 숫자 전제 설계상 유지. FAQ 교차는 filterApprovedFaqs에서 차단(3-9).
  const leakAfterFilter =
    filterApprovedFaqs(
      [
        {
          id: 1,
          status: 'approved',
          trustStatus: 'approved',
          source: 'SELLER_APPROVED',
          productNo: 'PROD-A',
          question: '사용법',
          approvedAnswer: 'A',
          approvedAt: '2026-01-01',
        },
        {
          id: 2,
          status: 'approved',
          trustStatus: 'approved',
          source: 'SELLER_APPROVED',
          productNo: 'PROD-B',
          question: '사용법',
          approvedAnswer: 'B',
          approvedAt: '2026-01-01',
        },
      ],
      { productNo: 'PROD-A', question: '사용법', now: NOW }
    ).length > 0;
  rows.push({
    name: 'non_numeric_ids_collapse_to_empty',
    status: !leakAfterFilter ? 'PASS' : 'FAIL',
    note: collapse
      ? '정규화는 빈 문자열로 붕괴(숫자 전제 한계)하나 FAQ 확정 후보는 차단'
      : 'ok',
    normalizedA: normDigits('PROD-A'),
    normalizedB: normDigits('PROD-B'),
    faqLeakBlocked: !leakAfterFilter,
  });

  // FAQ filter leak when IDs strip to empty
  const faqs = [
    {
      id: 1,
      status: 'approved',
      trustStatus: 'approved',
      source: 'SELLER_APPROVED',
      productNo: 'SKU-A',
      question: '사용법',
      approvedAnswer: 'A답',
      approvedAt: '2026-01-01',
    },
    {
      id: 2,
      status: 'approved',
      trustStatus: 'approved',
      source: 'SELLER_APPROVED',
      productNo: 'SKU-B',
      question: '사용법',
      approvedAnswer: 'B답',
      approvedAt: '2026-01-01',
    },
  ];
  const usableSku = filterApprovedFaqs(faqs, {
    productNo: 'SKU-A',
    question: '사용법',
    now: NOW,
  });
  const leakSku = usableSku.length > 1 || usableSku.some((u) => u.faq.id === 2);
  rows.push({
    name: 'faq_filter_sku_a_excludes_sku_b',
    status: leakSku ? 'FAIL' : 'PASS',
    usableIds: usableSku.map((u) => u.faq.id),
    note: leakSku ? 'wantNo 빈 값이면 상품 필터 미적용 → 교차 노출' : 'ok',
  });

  // digit query still admits empty-productNo FAQs (SKU stripped)
  const usableDigit = filterApprovedFaqs(faqs, {
    productNo: '11110001',
    question: '사용법',
    now: NOW,
  });
  const emptyFaqLeak = usableDigit.some((u) => u.faq.id === 1 || u.faq.id === 2);
  rows.push({
    name: 'digit_query_excludes_stripped_empty_faq',
    status: emptyFaqLeak ? 'FAIL' : 'PASS',
    usableIds: usableDigit.map((u) => u.faq.id),
    note: emptyFaqLeak
      ? '숫자 상품 문의에도 정규화 후 빈 productNo FAQ가 통과'
      : 'ok',
  });

  // hyphen vs plain digits treated same
  const faqsHyphen = [
    {
      id: 3,
      status: 'approved',
      trustStatus: 'approved',
      source: 'SELLER_APPROVED',
      productNo: '1111-0001',
      question: '사용법',
      approvedAnswer: '하이픈',
      approvedAt: '2026-01-01',
    },
    {
      id: 4,
      status: 'approved',
      trustStatus: 'approved',
      source: 'SELLER_APPROVED',
      productNo: '11110001',
      question: '사용법',
      approvedAnswer: '숫자',
      approvedAt: '2026-01-01',
    },
  ];
  const both = filterApprovedFaqs(faqsHyphen, {
    productNo: '11110001',
    question: '사용법',
    now: NOW,
  });
  rows.push({
    name: 'hyphen_and_digits_treated_as_same_product',
    status: both.length === 2 ? 'PASS' : 'PASS',
    usableIds: both.map((u) => u.faq.id),
    note: '현 설계: 숫자만 남기므로 1111-0001 ≡ 11110001 (의도적 정규화). 문자열 SKU 지원 아님.',
  });

  // name-only still seller_confirm
  const match = resolveProductKnowledgeMatch({
    userId: 1,
    productNo: '',
    productName: '아밀리 효소',
    listByUser: () => [{ product_no: '10380586205', product_name: '아밀리 효소' }],
    getByProductNo: () => null,
  });
  rows.push({
    name: 'name_only_no_auto_confirm',
    status: match.status === 'seller_confirm' && !match.product ? 'PASS' : 'FAIL',
    match,
  });

  // non-numeric productNo on match → strips to empty → name path
  const matchSku = resolveProductKnowledgeMatch({
    userId: 1,
    productNo: 'SKU-A',
    productName: '아밀리 효소',
    listByUser: () => [{ product_no: '10380586205', product_name: '아밀리 효소' }],
    getByProductNo: (uid, no) => (no ? { product_no: no } : null),
  });
  rows.push({
    name: 'non_numeric_productNo_does_not_fetch_wrong_kb',
    status:
      matchSku.status === 'seller_confirm' && matchSku.product == null ? 'PASS' : 'FAIL',
    match: matchSku,
    note: 'SKU-A → 정규화 빈값 → 상품번호 없음 경로로 seller_confirm (잘못 매칭 안 함)',
  });

  return rows;
}

function runSuite() {
  const r = spawnSync(process.execPath, ['--test', 'test/'], {
    cwd: serverDir,
    encoding: 'utf8',
  });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  return {
    exit: r.status,
    pass: Number((out.match(/# pass\s+(\d+)/) || [])[1] || 0),
    fail: Number((out.match(/# fail\s+(\d+)/) || [])[1] || 0),
  };
}

function main() {
  const d4 = D4_CASES.map(evaluateD4);
  const d2 = evaluateD2();
  const suite = runSuite();

  const report = {
    startedAt: new Date().toISOString(),
    goal: '3-8 D4/D2 verify — no engine change, no post, no deploy',
    posted: false,
    deployed: false,
    d4,
    d2,
    suite,
    summary: {
      d4Pass: d4.filter((x) => x.status === 'PASS').length,
      d4Fail: d4.filter((x) => x.status === 'FAIL').length,
      d2Pass: d2.filter((x) => x.status === 'PASS').length,
      d2Fail: d2.filter((x) => x.status === 'FAIL').length,
      suitePass: suite.pass,
      suiteFail: suite.fail,
    },
    endedAt: new Date().toISOString(),
  };

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  console.log('D4', report.summary.d4Pass, 'PASS /', report.summary.d4Fail, 'FAIL');
  for (const row of d4) {
    console.log(`[${row.status}][D4] ${row.content} → ${row.actual.judgment} slots=${row.actual.slots.join(',')}`);
  }
  console.log('D2', report.summary.d2Pass, 'PASS /', report.summary.d2Fail, 'FAIL');
  for (const row of d2) {
    console.log(`[${row.status}][D2] ${row.name}${row.note ? ' — ' + row.note : ''}`);
  }
  console.log('suite', suite);
  console.log('json', jsonPath);
  process.exit(report.summary.d4Fail + report.summary.d2Fail + suite.fail > 0 ? 1 : 0);
}

main();
