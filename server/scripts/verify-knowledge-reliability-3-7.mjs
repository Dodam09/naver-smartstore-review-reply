/**
 * 3-7 지식 신뢰성 검증 하네스 (배포·게시 없음).
 * 단위 테스트 결과 집계 + (선택) 로컬 API HTTP IDOR + 공식 주문 API 상태.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(__dirname, '..');
const outDir = path.resolve(__dirname, '../../e2e/out');
fs.mkdirSync(outDir, { recursive: true });
const stamp = Date.now();
const jsonPath = path.join(outDir, `knowledge-reliability-3-7-${stamp}.json`);
const BASE = process.env.API_BASE || 'http://127.0.0.1:8787';

const results = [];
function record(section, name, status, detail = {}) {
  results.push({ section, name, status, ...detail });
  console.log(`[${status}][${section}] ${name}`);
}

async function req(pathname, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
}

function runNodeTests() {
  const r = spawnSync(
    process.execPath,
    ['--test', 'test/knowledge-reliability-3-7.test.js', 'test/knowledge-reliability-3-7-db.test.js'],
    { cwd: serverDir, encoding: 'utf8', env: process.env }
  );
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  const passMatch = out.match(/# pass\s+(\d+)/);
  const failMatch = out.match(/# fail\s+(\d+)/);
  const pass = passMatch ? Number(passMatch[1]) : 0;
  const fail = failMatch ? Number(failMatch[1]) : (r.status === 0 ? 0 : 1);
  return { status: r.status, pass, fail, out: out.slice(-4000) };
}

function runFullSuite() {
  const r = spawnSync(process.execPath, ['--test', 'test/'], {
    cwd: serverDir,
    encoding: 'utf8',
    env: process.env,
  });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  const passMatch = out.match(/# pass\s+(\d+)/);
  const failMatch = out.match(/# fail\s+(\d+)/);
  return {
    status: r.status,
    pass: passMatch ? Number(passMatch[1]) : 0,
    fail: failMatch ? Number(failMatch[1]) : (r.status === 0 ? 0 : 1),
    outTail: out.slice(-2000),
  };
}

function runHarness(scriptRel) {
  const r = spawnSync(process.execPath, [scriptRel], {
    cwd: serverDir,
    encoding: 'utf8',
    env: process.env,
  });
  return {
    status: r.status,
    out: `${r.stdout || ''}\n${r.stderr || ''}`.slice(-3000),
  };
}

async function main() {
  const report = {
    startedAt: new Date().toISOString(),
    goal: '3-7 knowledge reliability verify — no post, no deploy, no engine change',
    posted: false,
    deployed: false,
    results: [],
  };

  // 3-7 dedicated unit tests
  const unit37 = runNodeTests();
  record(
    'unit_3_7',
    'knowledge-reliability-3-7 (+db) tests',
    unit37.fail === 0 && unit37.status === 0 ? 'PASS' : 'FAIL',
    { pass: unit37.pass, fail: unit37.fail, exit: unit37.status }
  );

  // Full regression suite
  const full = runFullSuite();
  record(
    'regression',
    'server test/ full suite',
    full.fail === 0 && full.status === 0 ? 'PASS' : 'FAIL',
    { pass: full.pass, fail: full.fail, exit: full.status }
  );

  // 3-6 UI harness
  const ui36 = runHarness('scripts/verify-knowledge-ui-3-6.mjs');
  record(
    'regression',
    'verify-knowledge-ui-3-6.mjs',
    ui36.status === 0 ? 'PASS' : 'FAIL',
    { exit: ui36.status, note: ui36.out.slice(0, 400) }
  );

  // Official order API status (code presence)
  const indexJs = fs.readFileSync(path.join(serverDir, 'index.js'), 'utf8');
  const evidenceJs = fs.readFileSync(path.join(serverDir, 'evidence.js'), 'utf8');
  const hasOfficialOrderIntegration =
    /officialOrder|OFFICIAL_ORDER|fetchOrder|commerce.*order/i.test(indexJs) &&
    /officialFacts/.test(evidenceJs);
  // evidence accepts officialFacts but live fetch may be absent
  const hasLiveOrderFetch = /function\s+fetch.*[Oo]rder|officialOrderLookup|getOrderDetail/.test(
    indexJs
  );
  record(
    'realtime',
    'official_order_api_integration',
    hasLiveOrderFetch ? 'PASS' : 'NOT TESTED',
    {
      note: hasLiveOrderFetch
        ? 'live order fetch helper present'
        : '공식 주문 API 연동 미구현 — REALTIME_REQUIRED 안전 판정만',
      hasOfficialFactsParam: /officialFacts/.test(evidenceJs),
      hasLiveOrderFetch,
    }
  );

  // Optional HTTP IDOR against local API (isolated test users)
  try {
    const health = await req('/health');
    if (health.status !== 200) {
      record('user_isolation_http', 'local_api_health', 'NOT TESTED', {
        note: `API status ${health.status}`,
      });
    } else {
      record('user_isolation_http', 'local_api_health', 'PASS', {
        version: health.data?.version,
      });
      const stampLocal = Date.now();
      const emailA = `rel37-http-a-${stampLocal}@example.com`;
      const emailB = `rel37-http-b-${stampLocal}@example.com`;
      const pass = 'Rel37-http-pass!!';
      await req('/api/auth/register', { method: 'POST', body: { email: emailA, password: pass } });
      await req('/api/auth/register', { method: 'POST', body: { email: emailB, password: pass } });
      const loginA = await req('/api/auth/login', {
        method: 'POST',
        body: { email: emailA, password: pass },
      });
      const loginB = await req('/api/auth/login', {
        method: 'POST',
        body: { email: emailB, password: pass },
      });
      const tokenA = loginA.data?.token;
      const tokenB = loginB.data?.token;
      if (!tokenA || !tokenB) {
        record('user_isolation_http', 'register_login_ab', 'FAIL', {
          note: 'token missing',
          a: loginA.data,
          b: loginB.data,
        });
      } else {
        record('user_isolation_http', 'register_login_ab', 'PASS', {});
        const putA = await req('/api/product-knowledge', {
          method: 'POST',
          token: tokenA,
          body: {
            productNo: '37001',
            productName: 'HTTP-A',
            specs: 'secret-A-specs',
          },
        });
        const listB = await req('/api/product-knowledge', { token: tokenB });
        const leaked = JSON.stringify(listB.data || {}).includes('secret-A-specs');
        const listA = await req('/api/product-knowledge', { token: tokenA });
        const aHas = JSON.stringify(listA.data || {}).includes('secret-A-specs');
        record(
          'user_isolation_http',
          'product_knowledge_not_leaked_to_B',
          putA.status < 400 && aHas && !leaked ? 'PASS' : 'FAIL',
          { putStatus: putA.status, listStatus: listB.status, aHas, leaked }
        );

        const entryId = 'product:37001:specs';
        const getB = await req(`/api/knowledge/entries/${encodeURIComponent(entryId)}`, {
          token: tokenB,
        });
        const getA = await req(`/api/knowledge/entries/${encodeURIComponent(entryId)}`, {
          token: tokenA,
        });
        record(
          'user_isolation_http',
          'knowledge_entry_idor_blocked',
          (getB.status === 404 || getB.status === 403 || getB.data?.ok === false) &&
            getA.status < 400 &&
            getA.data?.ok !== false
            ? 'PASS'
            : 'FAIL',
          { httpStatusB: getB.status, httpStatusA: getA.status, dataB: getB.data, dataA: getA.data }
        );
      }
    }
  } catch (err) {
    record('user_isolation_http', 'local_api_health', 'NOT TESTED', {
      note: String(err?.message || err),
    });
  }

  // Known design gaps to surface explicitly
  record(
    'conflict',
    'product_level_shipping_exception_table',
    'NOT TESTED',
    {
      note:
        '스토어 정책은 user 스코프 단일 행. 상품별 배송 예외 전용 테이블 없음. KB 필드 우선은 usage 등 kbFields 슬롯에서만 확인됨.',
    }
  );

  record(
    'realtime',
    'order_specific_exchange_refund_without_keywords',
    'NOT TESTED',
    {
      note:
        '「내 주문」·송장·품절 등은 REALTIME. 「교환 진행 상태」만 단독이면 exchange_return_policy 슬롯일 수 있음 — 단위에서 키워드 의존.',
    }
  );

  report.results = results;
  report.summary = {
    pass: results.filter((r) => r.status === 'PASS').length,
    fail: results.filter((r) => r.status === 'FAIL').length,
    notTested: results.filter((r) => r.status === 'NOT TESTED').length,
    fullSuitePass: full.pass,
    fullSuiteFail: full.fail,
    unit37Pass: unit37.pass,
    unit37Fail: unit37.fail,
  };
  report.endedAt = new Date().toISOString();
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  console.log('json', jsonPath);
  console.log('summary', report.summary);
  process.exit(report.summary.fail > 0 ? 1 : 0);
}

main();
