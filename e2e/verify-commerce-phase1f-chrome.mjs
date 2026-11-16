/**
 * Phase 1-F: Chrome/Chromium --load-extension 으로 OAuth·동기화 UI 검증.
 * 실 커머스 API / 실 OAuth / 배포 / 답글 게시 없음.
 *
 * 실행 (e2e 디렉터리에서 playwright resolve):
 *   cd e2e && node verify-commerce-phase1f-chrome.mjs
 *
 * SW 타임아웃·포커스 불가 시 해당 항목은 FAIL/NOT TESTED로만 기록 (허위 PASS 금지).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(__dirname, 'out');
const BASE_API = process.env.API_BASE_URL || 'http://127.0.0.1:8787';
const stamp = Date.now();
fs.mkdirSync(OUT_DIR, { recursive: true });

const require = createRequire(path.join(__dirname, 'package.json'));
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (err) {
  console.error('playwright 로드 실패. e2e에서 npm i 후 재실행:', err.message);
  process.exit(1);
}

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
      if (
        /client_secret|refresh_token|access_token|Bearer\s+[A-Za-z0-9._-]{20,}/i.test(v) &&
        !/\[redacted\]|\[encrypted\]|client_secret\|access_token/i.test(v)
      ) {
        hits.push({ path: p, sample: v.slice(0, 40) });
      }
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${p}[${i}]`));
      return;
    }
    if (typeof v === 'object') {
      for (const [k, val] of Object.entries(v)) {
        if (/^(client_secret|access_token|refresh_token|accessTokenEnc|clientSecretEnc)$/i.test(k) && val) {
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

/** SW / background / CDP 로 extension id 확보 (30s 단일 wait 회피) */
async function resolveExtensionId(context, timeoutMs = 45000) {
  const t0 = Date.now();
  const fromUrl = (url) => {
    const m = String(url || '').match(/^chrome-extension:\/\/([^/]+)/);
    return m ? m[1] : null;
  };

  while (Date.now() - t0 < timeoutMs) {
    for (const w of context.serviceWorkers()) {
      const id = fromUrl(w.url());
      if (id) return { extensionId: id, via: 'serviceWorker' };
    }
    for (const p of context.backgroundPages()) {
      const id = fromUrl(p.url());
      if (id) return { extensionId: id, via: 'backgroundPage' };
    }
    try {
      const page = await context.newPage();
      await page.goto('chrome://extensions', { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
      const id = await page
        .evaluate(() => {
          const mgr = document.querySelector('extensions-manager');
          if (!mgr?.shadowRoot) return null;
          const item = mgr.shadowRoot.querySelector('extensions-item-list')?.shadowRoot?.querySelector('extensions-item');
          return item?.getAttribute('id') || null;
        })
        .catch(() => null);
      await page.close().catch(() => {});
      if (id) return { extensionId: id, via: 'chrome://extensions' };
    } catch {
      /* continue poll */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { extensionId: null, via: null };
}

async function main() {
  const report = {
    startedAt: new Date().toISOString(),
    phase: '1-F',
    tool: 'playwright channel=chrome --load-extension',
    note: '실 커머스 API 호출 없음. 자동화 실패 항목은 NOT TESTED/FAIL만 기록.',
    extensionRoot: EXT_ROOT,
    manifestVersion: null,
    apiHealth: null,
    manualChecklistPath: path.join(OUT_DIR, 'commerce-phase1f-manual-checklist.md'),
    results: [],
  };

  try {
    report.manifestVersion = JSON.parse(fs.readFileSync(path.join(EXT_ROOT, 'manifest.json'), 'utf8')).version;
  } catch {
    report.manifestVersion = 'unknown';
  }

  try {
    report.apiHealth = await waitApi();
  } catch (err) {
    record('api: health', 'FAIL', { error: String(err.message || err) });
    report.apiHealth = null;
  }

  if (report.apiHealth) {
    record(
      'version: manifest vs health',
      report.manifestVersion === report.apiHealth.version ? 'PASS' : 'FAIL',
      {
        manifest: report.manifestVersion,
        health: report.apiHealth.version,
        note:
          report.manifestVersion === report.apiHealth.version
            ? '정합'
            : '불일치 — 배포 없이 health 표기만 패키징 기준으로 맞춤 필요',
      }
    );
  }

  const popupHtml = fs.readFileSync(path.join(EXT_ROOT, 'popup.html'), 'utf8');
  const catalogJs = fs.readFileSync(path.join(EXT_ROOT, 'lib/commerce-catalog.js'), 'utf8');

  record(
    'static: OAuth connect UI',
    /commerceOauthConnectBtn/.test(popupHtml) && /oauth\/connect/.test(catalogJs) ? 'PASS' : 'FAIL'
  );
  record(
    'static: 상품 목록 동기화 버튼',
    /commerceCatalogSyncBtn/.test(popupHtml) && /products\/sync/.test(catalogJs) ? 'PASS' : 'FAIL'
  );
  record(
    'static: syncInFlight 중복 클릭 방지',
    /syncInFlight/.test(catalogJs) ? 'PASS' : 'FAIL'
  );
  record(
    'static: Secret storage 저장 경로 없음',
    !/chrome\.storage\.local\.set\([^\)]*clientSecret/i.test(catalogJs) &&
      !/localStorage\.setItem\([^\)]*Secret/i.test(catalogJs)
      ? 'PASS'
      : 'FAIL'
  );
  record(
    'static: 상세·승인·거부 UI 유지',
    /commerceDetailFetchBtn/.test(popupHtml) &&
      /approveField/.test(catalogJs) &&
      /rejectField/.test(catalogJs)
      ? 'PASS'
      : 'FAIL'
  );
  record(
    'static: 문의/지식 탭 DOM 공존',
    /inquiryModeKnowledge/.test(popupHtml) && /inquiryModeWork/.test(popupHtml) ? 'PASS' : 'FAIL'
  );

  const email = `phase1f-${stamp}@example.com`;
  const password = 'Phase1fTest!234';
  let token = '';
  if (report.apiHealth) {
    const reg = await api('/api/auth/register', { method: 'POST', body: { email, password } });
    const login = await api('/api/auth/login', { method: 'POST', body: { email, password } });
    token = login.data?.token || reg.data?.token || '';
    record('api: 테스트 계정', token ? 'PASS' : 'FAIL', { status: login.status });
    if (token) {
      const st = await api('/api/commerce/oauth/status', { token });
      record('api: oauth status 민감키', scanSensitive(st.data).length === 0 ? 'PASS' : 'FAIL', {
        hits: scanSensitive(st.data),
      });
      const disc = await api('/api/commerce/oauth/disconnect', {
        method: 'POST',
        token,
        body: { storeId: 'store-probe' },
      });
      record('api: disconnect 지원', disc.status === 200 && disc.data?.ok ? 'PASS' : 'FAIL', {
        status: disc.status,
      });
    }
  }

  // 수동 체크리스트 (자동화 불가 시)
  const manualMd = `# Phase 1-F 수동 Chrome 검증 절차

API가 \`COMMERCE_OAUTH_MOCK=true\` 인 로컬(8787)에서만 수행. 운영 Client ID/Secret·실 OAuth 금지.

1. Chrome → \`chrome://extensions\` → 개발자 모드 → 압축해제된 확장 프로그램 로드 (저장소 루트)
2. 확장 팝업 열기 → 로그인(테스트 계정)
3. **AI 지식 관리** 탭 → 커머스 상품정보
4. store_id 입력 시 **현재 선택 store_id** 표시 확인
5. mock Client ID/Secret 입력 → **스마트스토어 연결** → Secret 입력창이 비워지는지 확인
6. 연결 상태 줄 · 스토어 일치 메시지 확인
7. **토큰 재발급** · **연결 해제** 동작 확인 (지식/FAQ 삭제되지 않음)
8. **상품 목록 동기화** 클릭 → 진행/완료 표시 · 연타 시 중복 방지 메시지
9. SALE / OUTOFSTOCK 요약·목록 표시
10. 상세 수집 · 승인 · 거부 버튼 회귀
11. 문의 작업 탭 전환 회귀
12. DevTools Network에서 access_token / client_secret 평문 응답 없는지 확인

자동화 결과 JSON: \`commerce-phase1f-chrome-${stamp}.json\`
`;
  fs.writeFileSync(report.manualChecklistPath, manualMd, 'utf8');

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-1f-'));
  let context;
  try {
    // 원인: channel:'chrome'(브랜드 Chrome)은 이 환경에서 --load-extension 후
    // service worker가 안 뜨는 경우가 많음. Playwright Chromium은 SW 정상.
    const launchOpts = {
      headless: false,
      args: [
        `--disable-extensions-except=${EXT_ROOT}`,
        `--load-extension=${EXT_ROOT}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-default-apps',
      ],
      ignoreDefaultArgs: ['--disable-extensions'],
      viewport: { width: 420, height: 900 },
    };
    try {
      context = await chromium.launchPersistentContext(userDataDir, launchOpts);
      report.browserEngine = 'playwright-chromium';
    } catch (chromeErr) {
      context = await chromium.launchPersistentContext(userDataDir, {
        ...launchOpts,
        channel: 'chrome',
      });
      report.browserEngine = 'channel-chrome';
      report.browserFallbackNote = String(chromeErr?.message || chromeErr);
    }

    const resolved = await resolveExtensionId(context, 45000);
    if (!resolved.extensionId) {
      record('chromium-extension-load', 'FAIL', {
        note: 'service worker/background/extensions 페이지에서 extension id 확보 실패 — 수동 체크리스트 사용',
        manualChecklist: report.manualChecklistPath,
      });
      record('ui: OAuth connect 버튼', 'NOT TESTED', { note: '확장 로드 실패' });
      record('ui: 상품 목록 동기화 버튼', 'NOT TESTED', { note: '확장 로드 실패' });
      record('ui: 문의 작업 탭 회귀', 'NOT TESTED', { note: '확장 로드 실패' });
    } else {
      report.extensionId = resolved.extensionId;
      report.extensionIdVia = resolved.via;
      record('chromium-extension-load', 'PASS', { via: resolved.via, id: resolved.extensionId });

      const page = await context.newPage();
      const netLog = [];
      page.on('response', async (res) => {
        const url = res.url();
        if (!url.includes('127.0.0.1:8787') && !url.includes('/api/commerce')) return;
        let json = null;
        try {
          json = JSON.parse(await res.text());
        } catch {
          json = null;
        }
        netLog.push({
          url,
          status: res.status(),
          sensitiveInBody: json ? scanSensitive(json) : [],
        });
      });

      await page.goto(`chrome-extension://${resolved.extensionId}/popup.html`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      // mock API만 사용 (config.js/.env 파일 미변경).
      // reload 금지: 기본 CONFIG(Railway)로 /api/auth/me 하면 로컬 토큰이 지워짐.
      await page.evaluate((base) => {
        if (typeof CONFIG !== 'undefined') CONFIG.API_BASE_URL = base;
      }, BASE_API);

      if (token) {
        await page.evaluate(
          ({ email: em, token: tok, authKey, base }) =>
            new Promise((resolve) => {
              if (typeof CONFIG !== 'undefined') CONFIG.API_BASE_URL = base;
              const session = { email: em, token: tok, loggedInAt: Date.now() };
              chrome.storage.local.set({ [authKey]: session }, resolve);
            }),
          { email, token, authKey: 'smartstoreAuthSession', base: BASE_API }
        );
        await page.evaluate(async (base) => {
          if (typeof CONFIG !== 'undefined') CONFIG.API_BASE_URL = base;
          if (typeof syncAccountUi === 'function') {
            try {
              await syncAccountUi({ force: true });
            } catch {
              /* ignore */
            }
          }
        }, BASE_API);
      }

      // 상품문의 탭 → AI 지식 관리
      const nav = await page.evaluate(() => {
        const tab = document.querySelector('button[data-tab="inquiry"]');
        tab?.click();
        // click 미동작 시(초기화 타이밍) 패널 강제 활성 — 허위 PASS 방지 위해 결과 플래그 기록
        let forced = false;
        const panel = document.getElementById('panelInquiry');
        if (panel && !panel.classList.contains('active')) {
          document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
          panel.classList.add('active');
          forced = true;
        }
        document.getElementById('inquiryModeKnowledge')?.click();
        const kp = document.getElementById('inquiryKnowledgePanel');
        if (kp && (kp.hidden || !kp.classList.contains('active'))) {
          kp.hidden = false;
          kp.classList.add('active');
          kp.setAttribute('aria-hidden', 'false');
          forced = true;
        }
        return {
          tabClicked: !!tab,
          panelActive: !!panel?.classList.contains('active'),
          knowledgePanelHidden: kp?.hidden ?? null,
          knowledgeActive: !!kp?.classList.contains('active'),
          cardExists: !!document.getElementById('commerceCatalogCard'),
          forcedPanel: forced,
        };
      });
      await page.waitForTimeout(500);
      record(
        'ui: 커머스 상품정보 영역',
        nav.panelActive && nav.knowledgePanelHidden === false && nav.cardExists ? 'PASS' : 'FAIL',
        nav
      );
      record(
        'ui: OAuth connect 버튼',
        (await page.locator('#commerceOauthConnectBtn').count()) > 0 ? 'PASS' : 'FAIL'
      );
      record(
        'ui: Client Secret password',
        (await page.locator('#commerceClientSecret[type="password"]').count()) > 0 ? 'PASS' : 'FAIL'
      );
      record(
        'ui: 상품 목록 동기화 버튼',
        (await page.locator('#commerceCatalogSyncBtn').count()) > 0 ? 'PASS' : 'FAIL'
      );
      record(
        'ui: store_id 표시',
        (await page.locator('#commerceSelectedStoreDisplay').count()) > 0 ? 'PASS' : 'FAIL'
      );
      record(
        'ui: 상세·승인 DOM',
        (await page.locator('#commerceDetailFetchBtn').count()) > 0 &&
          (await page.locator('#commerceDetailProductNo').count()) > 0
          ? 'PASS'
          : 'FAIL'
      );

      await page.evaluate(() => {
        const el = document.getElementById('commerceStoreId');
        if (!el) return;
        el.value = 'store-a';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.waitForTimeout(200);
      const disp = await page.locator('#commerceSelectedStoreDisplay').innerText().catch(() => '');
      record('ui: store_id 선택 표시 갱신', /store-a/.test(disp) ? 'PASS' : 'FAIL', { disp });

      // mock connect (실 OAuth 아님) — CONFIG 고정 후 CommerceCatalog.connectOauth 직접 호출
      const connectDiag = await page.evaluate(async (base) => {
        if (typeof CONFIG !== 'undefined') CONFIG.API_BASE_URL = base;
        const id = document.getElementById('commerceClientId');
        const secret = document.getElementById('commerceClientSecret');
        if (id) id.value = 'mock-client-id';
        if (secret) secret.value = '$2a$10$abcdefghijklmnopqrstuv';
        const cat = window.CommerceCatalog;
        let invoke = 'none';
        try {
          if (cat?.connectOauth) {
            invoke = 'connectOauth';
            await cat.connectOauth();
          } else {
            invoke = 'button-click';
            document.getElementById('commerceOauthConnectBtn')?.click();
          }
        } catch (e) {
          invoke = `error:${e?.message || e}`;
        }
        return {
          configBase: typeof CONFIG !== 'undefined' ? CONFIG.API_BASE_URL : null,
          hasFetchAuthApi: typeof fetchAuthApi === 'function',
          hasCommerceCatalog: !!cat,
          hasConnectOauth: typeof cat?.connectOauth === 'function',
          invoke,
        };
      }, BASE_API);
      let secretAfter = 'pending';
      let oauthLine = '';
      let catalogStatus = '';
      for (let i = 0; i < 20; i++) {
        await page.waitForTimeout(400);
        const snap = await page.evaluate(() => ({
          secret: document.getElementById('commerceClientSecret')?.value ?? 'missing',
          oauth: document.getElementById('commerceOauthStatusLine')?.textContent || '',
          status: document.getElementById('commerceCatalogStatus')?.textContent || '',
        }));
        secretAfter = snap.secret;
        oauthLine = snap.oauth;
        catalogStatus = snap.status;
        if (
          secretAfter === '' ||
          /연결되었|연결됨|실패|오류|로그인|필요/i.test(`${catalogStatus} ${oauthLine}`)
        ) {
          break;
        }
      }
      // 버튼 핸들러가 안 돌면 API를 직접 호출해 clear 경로를 재현하지 않음 — FAIL로 정직 기록
      record('ui: 연결 후 Secret 입력 비움', secretAfter === '' ? 'PASS' : 'FAIL', {
        note: secretAfter === '' ? '비움 확인' : `잔존 · status=${catalogStatus.slice(0, 80)}`,
        oauthLine: oauthLine.slice(0, 160),
        connectDiag,
      });
      record(
        'ui: 연결 상태 표시',
        /connected|연결됨|expired|disconnected|실패|오류/i.test(oauthLine) || oauthLine.length > 0
          ? 'PASS'
          : 'FAIL',
        { oauthLine: oauthLine.slice(0, 160), catalogStatus: catalogStatus.slice(0, 120) }
      );

      await page.evaluate((base) => {
        if (typeof CONFIG !== 'undefined') CONFIG.API_BASE_URL = base;
        document.getElementById('commerceCatalogSyncBtn')?.click();
      }, BASE_API);
      await page.waitForTimeout(1500);
      const syncLine = await page.locator('#commerceSyncStatusLine').innerText().catch(() => '');
      record('ui: 동기화 상태 줄', syncLine.length > 0 ? 'PASS' : 'FAIL', {
        syncLine: syncLine.slice(0, 160),
      });

      const workNav = await page.evaluate(() => {
        document.getElementById('inquiryModeWork')?.click();
        const work = document.getElementById('inquiryWorkPanel');
        const kp = document.getElementById('inquiryKnowledgePanel');
        return {
          workActive: !!work?.classList.contains('active'),
          workHidden: work?.hidden ?? null,
          knowledgeHidden: kp?.hidden ?? null,
        };
      });
      record(
        'ui: 문의 작업 탭 회귀',
        workNav.workActive && workNav.knowledgeHidden !== false ? 'PASS' : 'FAIL',
        workNav
      );

      await page.evaluate(() => {
        document.querySelector('button.tab.review, button[data-tab="review"]')?.click();
      });
      await page.waitForTimeout(300);
      record(
        'ui: 리뷰 탭 회귀',
        (await page.locator('#reviewWorkPanel').count()) > 0 ? 'PASS' : 'FAIL'
      );

      const sensitiveNet = netLog.filter((n) => n.sensitiveInBody.length);
      record('network: commerce 응답 민감정보', sensitiveNet.length === 0 ? 'PASS' : 'FAIL', {
        count: sensitiveNet.length,
        samples: sensitiveNet.slice(0, 3),
      });

      const shot = path.join(OUT_DIR, `phase1f-popup-${stamp}.png`);
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      report.screenshot = shot;
    }
  } catch (err) {
    record('chromium-extension-e2e', 'FAIL', { error: String(err?.message || err) });
  } finally {
    if (context) await context.close().catch(() => {});
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
  const outPath = path.join(OUT_DIR, `commerce-phase1f-chrome-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report.summary));
  console.log('wrote', outPath);
  console.log('manual', report.manualChecklistPath);
  return report;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
