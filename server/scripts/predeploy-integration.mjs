/**
 * 배포 전 통합 테스트 (로컬 서버 + 실제 Gemini).
 * 사용: node scripts/predeploy-integration.mjs
 * 환경: BASE_URL (기본 http://127.0.0.1:8787), server/.env 의 GEMINI_API_KEY
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = String(process.env.BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const OUT_DIR = path.join(__dirname, 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });

const STYLE = [
  '당신은 네이버 스마트스토어 판매자 답글을 작성합니다.',
  '[말투·표현] - 인사말: 안녕하세요 고객님,',
  '[말투·표현] - 존댓말·문체: 정중한 존댓말',
  '[말투·표현] - 문장 길이: 2~3문장',
  '[말투·표현] - 이모지 사용: 사용하지 않음',
  '[말투·표현] - 공감 방식: 짧게 호응',
  '[말투·표현] - 자주 사용하는 표현: "감사합니다"',
  '[말투·표현] - 마무리 방식: 감사합니다.',
].join('\n');

const report = {
  startedAt: new Date().toISOString(),
  base: BASE,
  cases: [],
  security: [],
  regression: [],
  flow: [],
  errors: [],
};

async function api(pathname, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
}

function pushCase(name, ok, detail) {
  report.cases.push({ name, ok, ...detail });
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${name}`);
  if (!ok) console.log('  ', detail.error || detail.note || '');
}

async function register(email) {
  const password = 'TestPass123!';
  let res = await api('/api/auth/register', {
    method: 'POST',
    body: { email, password },
  });
  if (res.status >= 400) {
    res = await api('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    });
  }
  if (!res.data?.token && !res.data?.session?.token) {
    // login response shapes vary
    const login = await api('/api/auth/login', { method: 'POST', body: { email, password } });
    return {
      email,
      token: login.data?.token || login.data?.session?.token,
      user: login.data?.user || login.data?.session?.user,
      raw: login,
    };
  }
  return {
    email,
    token: res.data.token || res.data.session?.token,
    user: res.data.user || res.data.session?.user,
    raw: res,
  };
}

async function generateInquiry(token, row, systemPrompt = STYLE) {
  return api('/api/generate-reply', {
    method: 'POST',
    token,
    body: {
      channel: 'inquiry',
      systemPrompt,
      row,
      references: [],
      model: process.env.GEMINI_MODEL || undefined,
    },
  });
}

async function analyzeTone(token, samples, previousToneProfile = null) {
  return api('/api/analyze-tone', {
    method: 'POST',
    token,
    body: {
      context: 'review',
      samples,
      previousToneProfile,
    },
  });
}

async function waitHealth(maxMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await api('/health');
      if (res.status === 200) return true;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  console.log('Waiting for', BASE);
  if (!(await waitHealth())) {
    throw new Error('서버 health 실패. 로컬 서버를 먼저 실행하세요.');
  }

  const stamp = Date.now();
  const sellerA = await register(`predeploy-a-${stamp}@example.com`);
  const sellerB = await register(`predeploy-b-${stamp}@example.com`);
  if (!sellerA.token || !sellerB.token) {
    throw new Error('계정 생성/로그인 실패: ' + JSON.stringify({ a: sellerA.raw, b: sellerB.raw }));
  }
  console.log('Users ready', sellerA.email, sellerB.email);

  const productNo = '8800123456789';

  // --- Security: A registers KB ---
  const kbA = await api('/api/product-knowledge', {
    method: 'POST',
    token: sellerA.token,
    body: {
      productNo,
      productName: '프리미엄 오메가3',
      specs: 'EPA 500mg, DHA 200mg, 1일 1캡슐',
      usage: '식사 후 1캡슐',
      cautions: '임산부는 상담 후 섭취',
      detailDescription: '건강기능식품 오메가3 연질캡슐',
      source: 'manual',
    },
  });
  pushCase('A 상품정보 등록', kbA.status === 200 && kbA.data?.item?.productNo === productNo, {
    status: kbA.status,
    item: kbA.data?.item,
  });

  const polA = await api('/api/store-policies', {
    method: 'PUT',
    token: sellerA.token,
    body: {
      shipping: '영업일 기준 2~3일 내 출고 (일반 정책)',
      exchangeReturn: '수령 7일 이내 단순변심 반품 가능',
      refund: '검수 후 환불',
      customerService: '스토어 문의로 남겨 주세요',
    },
  });
  pushCase('A 스토어 정책 저장', polA.status === 200, { status: polA.status });

  // B must not read A's KB
  const leakGet = await api(`/api/product-knowledge/${productNo}`, { token: sellerB.token });
  pushCase('보안: B가 A의 productNo 조회 불가', leakGet.status === 404, {
    status: leakGet.status,
    data: leakGet.data,
  });
  report.security.push(report.cases.at(-1));

  // B registers different content same productNo
  const kbB = await api('/api/product-knowledge', {
    method: 'POST',
    token: sellerB.token,
    body: {
      productNo,
      productName: 'B몰 전용 오메가3',
      specs: 'B몰 전용 스펙 XYZ-ONLY-FOR-B',
      usage: 'B몰 전용 용법',
      source: 'manual',
    },
  });
  pushCase('B 동일 productNo 별도 등록', kbB.status === 200, { status: kbB.status });

  const aGet = await api(`/api/product-knowledge/${productNo}`, { token: sellerA.token });
  const bGet = await api(`/api/product-knowledge/${productNo}`, { token: sellerB.token });
  const isolationOk =
    aGet.data?.item?.specs?.includes('EPA') &&
    bGet.data?.item?.specs?.includes('XYZ-ONLY-FOR-B') &&
    !String(aGet.data?.item?.specs || '').includes('XYZ-ONLY-FOR-B');
  pushCase('보안: 동일 productNo 내용 격리', isolationOk, {
    aSpecs: aGet.data?.item?.specs,
    bSpecs: bGet.data?.item?.specs,
  });
  report.security.push(report.cases.at(-1));

  // --- Gemini scenarios for seller A ---
  const scenarios = [
    {
      name: 'KB 전체 등록 문의(사용법)',
      row: {
        product: '프리미엄 오메가3',
        productNo,
        content: '사용법이 어떻게 되나요?',
      },
      expect: (res) => {
        const text = String(res.data?.text || '');
        const facts = (res.data?.evidence?.verifiedFacts || []).join('\n');
        return {
          ok: res.status === 200 && /캡슐|식사/.test(text + facts) && !res.data?.needsConfirm,
          note: { text, evidence: res.data?.evidence, needsConfirm: res.data?.needsConfirm },
        };
      },
    },
    {
      name: 'KB 부분 등록(성분만 있고 호환 질문 → confirm 가능)',
      setup: async () => {
        await api('/api/product-knowledge', {
          method: 'POST',
          token: sellerA.token,
          body: {
            productNo: '8800999000001',
            productName: '부분KB상품',
            specs: '비타민C 500mg',
            usage: '',
            optionsCompat: '',
            source: 'manual',
          },
        });
      },
      row: {
        product: '부분KB상품',
        productNo: '8800999000001',
        content: '아이폰15와 호환되나요?',
      },
      expect: (res) => {
        const text = String(res.data?.text || '');
        return {
          ok: res.status === 200 && (res.data?.needsConfirm === true || /확인/.test(text)),
          note: { text, evidence: res.data?.evidence, needsConfirm: res.data?.needsConfirm },
        };
      },
    },
    {
      name: 'KB 미등록 문의',
      row: {
        product: '미등록상품',
        productNo: '8800000000999',
        content: '성분이 어떻게 되나요?',
      },
      expect: (res) => {
        const text = String(res.data?.text || '');
        const leaked = /EPA 500mg|XYZ-ONLY-FOR-B/.test(text);
        return {
          ok: res.status === 200 && !leaked && (res.data?.needsConfirm || /확인/.test(text)),
          note: { text, evidence: res.data?.evidence, needsConfirm: res.data?.needsConfirm, leaked },
        };
      },
    },
    {
      name: '주문 출고/송장 문의 → 실시간 confirm',
      row: {
        product: '프리미엄 오메가3',
        productNo,
        content: '제 주문 송장번호 알려주세요. 언제 출고됐나요?',
      },
      expect: (res) => {
        const text = String(res.data?.text || '');
        const slots = res.data?.evidence?.slots || [];
        const orderConfirm = slots.some((s) => s.key === 'order_realtime' && s.status === 'seller_confirm');
        const inventedTracking = /송장\s*\d{8,}|CJ대한통운\s*\d+/.test(text);
        return {
          ok: res.status === 200 && res.data?.needsConfirm === true && orderConfirm && !inventedTracking,
          note: { text, evidence: res.data?.evidence, inventedTracking },
        };
      },
    },
    {
      name: '배송 정책 문의(일반 정책 vs 주문상태 분리)',
      row: {
        product: '프리미엄 오메가3',
        productNo,
        content: '배송비랑 평균 배송 정책이 어떻게 되나요?',
      },
      expect: (res) => {
        const text = String(res.data?.text || '');
        const facts = (res.data?.evidence?.verifiedFacts || []).join('\n');
        const usesPolicy = /출고|영업일|정책/.test(text + facts);
        const pretendsOrder = /고객님 주문은 오늘 출고/.test(text);
        return {
          ok: res.status === 200 && usesPolicy && !pretendsOrder,
          note: { text, evidence: res.data?.evidence, needsConfirm: res.data?.needsConfirm },
        };
      },
    },
    {
      name: '판매자 확인 필요 + 승인 후 KB 반영',
      row: {
        product: '프리미엄 오메가3',
        productNo,
        content: '이 제품에 콜라겐도 들어있나요?',
      },
      expect: async (res) => {
        const text = String(res.data?.text || '');
        const needs = !!res.data?.needsConfirm;
        const confId = res.data?.confirmation?.id;
        let approveOk = false;
        let regenOk = false;
        let regenText = '';
        if (confId) {
          const approved = await api(`/api/inquiry-confirmations/${confId}/approve-fact`, {
            method: 'POST',
            token: sellerA.token,
            body: {
              productNo,
              field: 'extra',
              value: '콜라겐 미포함 (판매자 확인)',
              productName: '프리미엄 오메가3',
            },
          });
          approveOk = approved.status === 200 && /콜라겐 미포함/.test(approved.data?.item?.extra || '');

          // B must not approve A's confirmation
          const cross = await api(`/api/inquiry-confirmations/${confId}/approve-fact`, {
            method: 'POST',
            token: sellerB.token,
            body: {
              productNo,
              field: 'extra',
              value: 'HACKED-BY-B',
              productName: 'hack',
            },
          });
          const crossBlocked = cross.status >= 400 || !/HACKED-BY-B/.test(JSON.stringify(cross.data || {}));

          const again = await generateInquiry(sellerA.token, {
            product: '프리미엄 오메가3',
            productNo,
            content: '이 제품에 콜라겐도 들어있나요?',
          });
          regenText = String(again.data?.text || '');
          const facts = (again.data?.evidence?.verifiedFacts || []).join('\n');
          regenOk = again.status === 200 && /콜라겐 미포함|미포함/.test(regenText + facts);
          report.security.push({
            name: '보안: B가 A confirmation 승인 불가',
            ok: crossBlocked,
            status: cross.status,
            data: cross.data,
          });
          pushCase('보안: B가 A confirmation 승인 불가', crossBlocked, {
            status: cross.status,
            data: cross.data,
          });
        }
        return {
          ok: needs && approveOk && regenOk,
          note: {
            text,
            needsConfirm: needs,
            confirmationId: confId,
            approveOk,
            regenOk,
            regenText,
            evidence: res.data?.evidence,
          },
        };
      },
    },
  ];

  for (const sc of scenarios) {
    try {
      if (sc.setup) await sc.setup();
      const res = await generateInquiry(sellerA.token, sc.row);
      const judged = await sc.expect(res);
      pushCase(sc.name, !!judged.ok, {
        status: res.status,
        ...(judged.note || {}),
        error: judged.ok ? undefined : '기대 조건 불충족',
      });
      report.flow.push(report.cases.at(-1));
    } catch (err) {
      pushCase(sc.name, false, { error: err.message || String(err) });
      report.errors.push({ name: sc.name, error: err.message || String(err) });
    }
  }

  // Conflict scenario: KB says one thing; we cannot easily force Google Search conflict reliably.
  // Soft check: when KB hit exists, verifiedFacts should prefer KB prefix.
  try {
    const res = await generateInquiry(sellerA.token, {
      product: '프리미엄 오메가3',
      productNo,
      content: 'EPA 함량이 얼마인가요?',
    });
    const facts = (res.data?.evidence?.verifiedFacts || []).join('\n');
    const sources = res.data?.evidence?.sources || [];
    const kbPreferred =
      sources.some((s) => s.type === 'kb') &&
      (/\[KB:/.test(facts) || /EPA\s*500/.test(String(res.data?.text || '')));
    pushCase('KB vs 공식자료: KB 등록 시 KB 근거 우선(가능 범위)', kbPreferred && res.status === 200, {
      status: res.status,
      text: res.data?.text,
      evidence: res.data?.evidence,
      note: '실제 웹 검색 충돌을 강제하지 않고, KB hit + EPA 답변/ [KB:] 근거 사용 여부를 검증',
    });
  } catch (err) {
    pushCase('KB vs 공식자료: KB 등록 시 KB 근거 우선(가능 범위)', false, {
      error: err.message || String(err),
    });
  }

  // B generate must not leak A's EPA/KB when B has own KB
  {
    const res = await generateInquiry(sellerB.token, {
      product: 'B몰 전용 오메가3',
      productNo,
      content: '스펙이 어떻게 되나요?',
    });
    const blob = `${res.data?.text || ''}\n${(res.data?.evidence?.verifiedFacts || []).join('\n')}`;
    const ok =
      res.status === 200 &&
      /XYZ-ONLY-FOR-B/.test(blob) &&
      !/EPA 500mg/.test(blob);
    pushCase('보안: B 생성에 A KB 미포함', ok, {
      status: res.status,
      text: res.data?.text,
      evidence: res.data?.evidence,
    });
    report.security.push(report.cases.at(-1));
  }

  // Regression: review generate + usage + tone_v2
  {
    const before = await api('/api/auth/me', { token: sellerA.token });
    const usedBefore = before.data?.usage?.replyUsed ?? before.data?.user?.usage?.replyUsed;
    const review = await api('/api/generate-reply', {
      method: 'POST',
      token: sellerA.token,
      body: {
        channel: 'review',
        systemPrompt: STYLE,
        row: { product: '프리미엄 오메가3', content: '배송 빨라요 좋아요', rating: '5' },
      },
    });
    const after = await api('/api/auth/me', { token: sellerA.token });
    const usedAfter = after.data?.usage?.replyUsed ?? after.data?.user?.usage?.replyUsed;
    const ok =
      review.status === 200 &&
      String(review.data?.text || '').length > 10 &&
      !/EPA 500mg|환불해/.test(review.data?.text || '');
    pushCase('회귀: 리뷰 답글 생성', ok, {
      status: review.status,
      text: review.data?.text,
      usageBefore: usedBefore,
      usageAfter: usedAfter,
    });
    report.regression.push(report.cases.at(-1));
  }

  {
    const tone = await analyzeTone(sellerA.token, [
      '안녕하세요 고객님, 소중한 후기 감사합니다. 만족해 주셔서 기쁩니다.',
      '안녕하세요 고객님, 구매해 주셔서 감사합니다. 앞으로도 좋은 제품으로 보답하겠습니다.',
      '안녕하세요 고객님, 빠른 배송에 만족하셨다니 기쁩니다. 감사합니다.',
    ]);
    const ok =
      tone.status === 200 &&
      tone.data?.toneProfile?.version === 'tone_v2' &&
      !tone.data?.usedFallback &&
      /말투·표현/.test(tone.data?.prompt || '');
    pushCase('회귀: tone_v2 분석 생성', ok, {
      status: tone.status,
      usedFallback: tone.data?.usedFallback,
      fallbackReason: tone.data?.fallbackReason,
      toneProfile: tone.data?.toneProfile,
      promptPreview: String(tone.data?.prompt || '').slice(0, 240),
    });
    report.regression.push(report.cases.at(-1));

    // parse fail path: cannot force Gemini fail easily; unit tests cover fallback.
  }

  {
    // KB 없는 신규 사용자로 문의 생성 가능
    const sellerC = await register(`predeploy-c-${stamp}@example.com`);
    const res = await generateInquiry(sellerC.token, {
      product: '아무상품',
      content: '배송은 얼마나 걸리나요?',
    });
    pushCase('회귀: KB 미등록 사용자도 문의 생성 가능', res.status === 200 && !!res.data?.text, {
      status: res.status,
      text: res.data?.text,
      needsConfirm: res.data?.needsConfirm,
    });
    report.regression.push(report.cases.at(-1));
  }

  // UI API roundtrip: update + delete
  {
    const upd = await api(`/api/product-knowledge/${productNo}`, {
      method: 'PUT',
      token: sellerA.token,
      body: { productName: '프리미엄 오메가3 수정', specs: 'EPA 500mg, DHA 200mg (수정)' },
    });
    const got = await api(`/api/product-knowledge/${productNo}`, { token: sellerA.token });
    const delOther = await api(`/api/product-knowledge/${productNo}`, {
      method: 'DELETE',
      token: sellerB.token,
    });
    // B delete should delete B's row only; A's remains
    const aStill = await api(`/api/product-knowledge/${productNo}`, { token: sellerA.token });
    const ok =
      upd.status === 200 &&
      /수정/.test(got.data?.item?.specs || got.data?.item?.productName || '') &&
      aStill.status === 200;
    pushCase('회귀: KB 수정/재조회 + 타사용자 삭제 격리', ok, {
      upd: upd.status,
      got: got.data?.item,
      bDeleteStatus: delOther.status,
      aStill: aStill.data?.item?.productName,
    });
    report.regression.push(report.cases.at(-1));
    report.security.push({
      name: '보안: B 삭제가 A KB를 지우지 않음',
      ok: aStill.status === 200 && !!aStill.data?.item,
      aStill: aStill.data?.item?.productName,
    });
  }

  report.finishedAt = new Date().toISOString();
  report.summary = {
    total: report.cases.length,
    pass: report.cases.filter((c) => c.ok).length,
    fail: report.cases.filter((c) => !c.ok).length,
  };

  const outPath = path.join(OUT_DIR, `predeploy-integration-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log('\nSummary', report.summary);
  console.log('Wrote', outPath);
  if (report.summary.fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  report.errors.push({ fatal: err.message || String(err) });
  fs.writeFileSync(
    path.join(OUT_DIR, `predeploy-integration-error-${Date.now()}.json`),
    JSON.stringify(report, null, 2)
  );
  process.exit(1);
});
