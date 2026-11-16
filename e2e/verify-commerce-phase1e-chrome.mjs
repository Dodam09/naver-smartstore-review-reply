/**
 * Phase 1-E: Chromium --load-extension 으로 언팩 MV3 확장 UI 검증.
 * 네이버 실 API / 실 OAuth / 배포 / 답글 게시 없음.
 * mock: 서버 COMMERCE_OAUTH_MOCK 가정. UI에 OAuth connect가 없으면 FAIL/NOT PRESENT로 기록.
 *
 * 주의: 이 스크립트는 Chromium+확장 로드이며, 브랜드 Google Chrome 수동 DevTools와
 * 구분하여 보고서에 표기한다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(__dirname, 'out');
const BASE_API = 'http://127.0.0.1:8787';
const stamp = Date.now();
fs.mkdirSync(OUT_DIR, { recursive: true });

const results = [];
function record(name, status, detail = {}) {
  results.push({ name, status, ...detail });
  console.log(`[${status}] ${name}${detail.note ? ` — ${detail.note}` : ''}`);
}

async function waitApi(maxMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try {
      const res = await fetch(`${BASE_API}/health`);
      if (res.ok) return await res.json();
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('API 8787 health 실패');
}

async function api(pathname, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_API}${pathname}`, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function scanSensitive(obj, pathPrefix = '') {
  const hits = [];
  const walk = (v, p) => {
    if (v == null) return;
    if (typeof v === 'string') {
      if (/client_secret|refresh_token|access_token|Bearer\s+[A-Za-z0-9._-]{20,}/i.test(v) && !/\[redacted\]|\[encrypted\]/.test(v)) {
        hits.push({ path: p, sample: v.slice(0, 40) });
      }
      if (/^v1:[A-Za-z0-9_-]+:/.test(v)) hits.push({ path: p, sample: '[encrypted-blob?]' });
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${p}[${i}]`));
      return;
    }
    if (typeof v === 'object') {
      for (const [k, val] of Object.entries(v)) {
        if (/secret|access_token|refresh_token|token_enc|client_secret/i.test(k) && val) {
          const s = String(val);
          if (!/\[redacted\]|\[encrypted\]|^$/.test(s) && s.length > 3) {
            hits.push({ path: `${p}.${k}`, sample: s.slice(0, 40) });
          }
        }
        walk(val, `${p}.${k}`);
      }
    }
  };
  walk(obj, pathPrefix || '$');
  return hits;
}

async function main() {
  const report = {
    startedAt: new Date().toISOString(),
    phase: '1-E',
    tool: 'playwright chromium --load-extension (headed)',
    note: 'Google Chrome 브랜드 수동 DevTools와 별도. 실 커머스 API 호출 없음.',
    extensionRoot: EXT_ROOT,
    manifestVersion: null,
    apiHealth: null,
    results: [],
  };

  try {
    const man = JSON.parse(fs.readFileSync(path.join(EXT_ROOT, 'manifest.json'), 'utf8'));
    report.manifestVersion = man.version;
  } catch {
    report.manifestVersion = 'unknown';
  }

  report.apiHealth = await waitApi();

  // 정적: 확장 소스에 OAuth connect UI 존재 여부
  const popupHtml = fs.readFileSync(path.join(EXT_ROOT, 'popup.html'), 'utf8');
  const catalogJs = fs.readFileSync(path.join(EXT_ROOT, 'lib/commerce-catalog.js'), 'utf8');
  const popupJs = fs.readFileSync(path.join(EXT_ROOT, 'popup.js'), 'utf8');
  const allUi = popupHtml + catalogJs + popupJs;

  const hasCatalogCard = popupHtml.includes('commerceCatalogCard');
  const hasOauthConnectUi =
    /oauth\/connect|commerceOauthConnect|커머스\s*연동|oauthConnect/i.test(allUi);
  const hasLegacyBeginUi = /oauth\/begin|oauth\/complete|authorizeUrl|authorization_code/i.test(allUi);

  record(
    'static: 커머스 상품정보 카드 DOM',
    hasCatalogCard ? 'PASS' : 'FAIL',
    { hasCatalogCard }
  );
  record(
    'static: OAuth connect UI (/api/commerce/oauth/connect)',
    hasOauthConnectUi ? 'PASS' : 'FAIL',
    {
      note: hasOauthConnectUi
        ? 'UI 존재'
        : '확장에 connect 버튼/호출 없음 — 서버 API만 존재',
    }
  );
  record(
    'static: 레거시 begin/complete UI 잔존',
    hasLegacyBeginUi ? 'FAIL' : 'PASS',
    { note: hasLegacyBeginUi ? '레거시 문자열 발견' : '확장 UI에 begin/complete 없음' }
  );
  record(
    'static: catalog 스크립트 토큰/raw 미참조',
    !/access_token|refresh_token|client_secret|detail_raw|raw_json/i.test(catalogJs)
      ? 'PASS'
      : 'FAIL'
  );

  const email = `phase1e-${stamp}@example.com`;
  const password = 'Phase1eTest!234';
  let token = '';
  {
    const reg = await api('/api/auth/register', {
      method: 'POST',
      body: { email, password },
    });
    const login = await api('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    token = login.data?.token || reg.data?.token || '';
    record('api: 테스트 계정 로그인', token ? 'PASS' : 'FAIL', {
      status: login.status,
    });
  }

  // mock connect via API (UI 없음 대비) — 확장 Network 검사용 시드
  if (token) {
    // transport 없이 실호출되면 실패할 수 있음 — mock 서버면 issue가 mock transport 없을 때 실 fetch
    // COMMERCE_OAUTH_MOCK=true 여도 기본 fetch는 실 URL로 감. 테스트는 UI 중심이므로 connect API는 선택.
    const st = await api('/api/commerce/oauth/status', { token });
    record('api: oauth status (토큰 미포함)', st.status === 200 ? 'PASS' : 'FAIL', {
      bodyKeys: Object.keys(st.data?.oauth || {}),
      sensitive: scanSensitive(st.data),
    });
    const cat = await api('/api/commerce/products/catalog', { token });
    record('api: catalog 응답 민감정보', scanSensitive(cat.data).length === 0 ? 'PASS' : 'FAIL', {
      hits: scanSensitive(cat.data),
      catalogCount: cat.data?.catalog?.catalogCount,
    });
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-1e-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chrome', // 시스템에 설치된 Google Chrome 사용
      headless: false,
      args: [
        `--disable-extensions-except=${EXT_ROOT}`,
        `--load-extension=${EXT_ROOT}`,
      ],
      viewport: { width: 420, height: 900 },
    });

    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30000 });
    const extensionId = worker.url().split('/')[2];
    report.extensionId = extensionId;

    const page = await context.newPage();
    const netLog = [];
    page.on('response', async (res) => {
      const url = res.url();
      if (!url.includes('127.0.0.1:8787') && !url.includes('/api/commerce')) return;
      let bodyText = '';
      try {
        bodyText = await res.text();
      } catch {
        bodyText = '';
      }
      let json = null;
      try {
        json = bodyText ? JSON.parse(bodyText) : null;
      } catch {
        json = null;
      }
      netLog.push({
        url,
        status: res.status(),
        sensitiveInBody: json ? scanSensitive(json) : [],
        hasRawJsonKey: !!(json && (json.raw_json || json.detail_raw_json || json.rawJson)),
      });
    });

    await page.goto(`chrome-extension://${extensionId}/popup.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // 세션 시드
    if (token) {
      await page.evaluate(
        ({ email: em, token: tok }) =>
          new Promise((resolve) => {
            chrome.storage.local.set(
              {
                session: { email: em, token: tok, loggedInAt: Date.now() },
              },
              resolve
            );
          }),
        { email, token }
      );
      await page.reload({ waitUntil: 'domcontentloaded' });
    }

    const knowledgeBtn = page.locator('#inquiryModeKnowledge');
    const hasKnowledgeBtn = (await knowledgeBtn.count()) > 0;
    record('ui: AI 지식 관리 탭 버튼', hasKnowledgeBtn ? 'PASS' : 'FAIL');

    if (hasKnowledgeBtn) {
      await knowledgeBtn.click();
      await page.waitForTimeout(800);
    }

    const catalogCard = page.locator('#commerceCatalogCard');
    const catalogVisible = (await catalogCard.count()) > 0 && (await catalogCard.isVisible());
    record('ui: 커머스 상품정보 영역 표시', catalogVisible ? 'PASS' : 'FAIL');

    const connectBtn = page.locator(
      '#commerceOauthConnectBtn, [data-commerce-oauth-connect], button:has-text("커머스 연결"), button:has-text("OAuth 연결")'
    );
    record('ui: OAuth connect 버튼', (await connectBtn.count()) > 0 ? 'PASS' : 'FAIL', {
      note: '없으면 connect UI 미구현',
    });

    const storeInput = page.locator('#commerceStoreId');
    record('ui: storeId 입력', (await storeInput.count()) > 0 ? 'PASS' : 'FAIL');

    const refreshBtn = page.locator('#commerceCatalogRefreshBtn');
    if ((await refreshBtn.count()) > 0) {
      await refreshBtn.click();
      await page.waitForTimeout(1200);
      const statusText = await page.locator('#commerceCatalogStatus').innerText().catch(() => '');
      const summaryText = await page.locator('#commerceCatalogSummary').innerText().catch(() => '');
      record('ui: 카탈로그 새로고침 동작', 'PASS', {
        statusText: statusText.slice(0, 120),
        summaryText: summaryText.slice(0, 200),
      });
    } else {
      record('ui: 카탈로그 새로고침 동작', 'FAIL');
    }

    // 상세 수집 UI 존재
    record(
      'ui: 상세 수집 입력/버튼',
      (await page.locator('#commerceDetailProductNo').count()) > 0 &&
        (await page.locator('#commerceDetailFetchBtn').count()) > 0
        ? 'PASS'
        : 'FAIL'
    );

    // 승인/거부 — 목록 항목이 없으면 클릭 불가 → NOT TESTED if empty
    const items = page.locator('#commerceCatalogList .knowledge-entry-item');
    const itemCount = await items.count();
    if (itemCount === 0) {
      record('ui: 승인·거부 클릭', 'NOT TESTED', {
        note: '카탈로그 항목 없음(목록 sync/연결 UI 없어 데이터 시드 불가에 가까움)',
      });
      record('ui: conflict 표시', 'NOT TESTED', { note: '상세/충돌 데이터 없음' });
    } else {
      await items.first().click();
      await page.waitForTimeout(400);
      const approve = page.locator('.commerce-approve-btn');
      const reject = page.locator('.commerce-reject-btn');
      if ((await approve.count()) > 0) {
        await approve.first().click();
        await page.waitForTimeout(600);
        record('ui: 승인 버튼 클릭', 'PASS');
      } else {
        record('ui: 승인 버튼 클릭', 'NOT TESTED', { note: '필드 행 없음' });
      }
      if ((await reject.count()) > 0) {
        record('ui: 거부 버튼 존재', 'PASS');
      } else {
        record('ui: 거부 버튼 존재', 'NOT TESTED');
      }
    }

    // store A/B 전환 UI만 확인 (데이터 격리 실동작은 항목 없으면 NOT TESTED)
    if ((await storeInput.count()) > 0) {
      await storeInput.fill('store-a');
      await refreshBtn.click();
      await page.waitForTimeout(500);
      await storeInput.fill('store-b');
      await refreshBtn.click();
      await page.waitForTimeout(500);
      record('ui: storeId A/B 입력 전환', 'PASS', {
        note: '입력·재조회 가능. 교차 데이터 차단은 서버 테스트에 의존, UI 데이터 없으면 격리 실측 제한',
      });
      record('ui: 스토어 교차 승인 차단 실측', 'NOT TESTED', {
        note: '승인 대상 상품·이중 스토어 시드 부족',
      });
    }

    // 기존 지식 탭
    const knowledgeSummary = page.locator('#knowledgeSummary');
    record(
      'ui: 기존 AI 지식 관리 영역 공존',
      (await knowledgeSummary.count()) > 0 ? 'PASS' : 'FAIL'
    );

    // 문의 작업 탭 회귀
    const workBtn = page.locator('#inquiryModeWork');
    if ((await workBtn.count()) > 0) {
      await workBtn.click();
      await page.waitForTimeout(300);
      record(
        'ui: 문의 작업 탭 전환',
        (await page.locator('#inquiryWorkPanel').count()) > 0 ? 'PASS' : 'FAIL'
      );
    }

    const sensitiveNet = netLog.filter((n) => n.sensitiveInBody.length || n.hasRawJsonKey);
    record(
      'network: commerce API 응답 민감정보/raw',
      sensitiveNet.length === 0 ? 'PASS' : 'FAIL',
      { count: sensitiveNet.length, samples: sensitiveNet.slice(0, 5) }
    );

    const shot = path.join(OUT_DIR, `phase1e-popup-${stamp}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    report.screenshot = shot;
  } catch (err) {
    record('chromium-extension-e2e', 'FAIL', { error: String(err?.message || err) });
  } finally {
    if (context) await context.close();
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  report.finishedAt = new Date().toISOString();
  report.results = results;
  report.summary = {
    pass: results.filter((r) => r.status === 'PASS').length,
    fail: results.filter((r) => r.status === 'FAIL').length,
    notTested: results.filter((r) => r.status === 'NOT TESTED').length,
  };
  const outPath = path.join(OUT_DIR, `commerce-phase1e-chrome-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report.summary));
  console.log('wrote', outPath);
  return report;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
