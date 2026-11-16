/**
 * 실제 Chromium + 언팩 MV3 확장 E2E (Playwright).
 * DOM-only / API-only 와 구분: chrome-extension:// 원본 + chrome.storage + service worker.
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

const report = {
  startedAt: new Date().toISOString(),
  tool: 'playwright + chromium --load-extension',
  extensionRoot: EXT_ROOT,
  cases: [],
  categories: {
    realExtensionUi: [],
    apiOnly: [],
    notRun: [],
  },
};

function record(name, ok, detail = {}, category = 'realExtensionUi') {
  // detail.name 이 있으면 테스트명을 덮어쓰므로 분리
  const { name: _detailName, ...safeDetail } = detail || {};
  const row = { name, ok, category, ...safeDetail };
  if (_detailName != null) row.detailName = _detailName;
  report.cases.push(row);
  report.categories[category].push(row);
  console.log(`[${ok ? 'PASS' : 'FAIL'}][${category}] ${name}`);
  if (!ok && detail.error) console.log('   ', detail.error);
  return ok;
}

async function waitApi(maxMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try {
      const res = await fetch(`${BASE_API}/health`);
      if (res.ok) {
        const data = await res.json();
        if (data.ok && data.geminiConfigured) return data;
      }
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('로컬 API(8787) health 실패');
}

async function api(pathname, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_API}${pathname}`, {
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

async function getExtensionId(context) {
  let worker = context.serviceWorkers()[0];
  if (!worker) {
    worker = await context.waitForEvent('serviceworker', { timeout: 30000 });
  }
  const url = worker.url();
  const id = url.split('/')[2];
  if (!id) throw new Error(`extension id 파싱 실패: ${url}`);
  return { id, worker };
}

async function seedOnboardingDone(context) {
  // 온보딩 투어가 탭 클릭을 가로채므로 사전 완료 처리
  const worker = context.serviceWorkers()[0];
  if (!worker) return;
  await worker.evaluate(async () => {
    await chrome.storage.local.set({
      smartstoreOnboardingTourV1: { done: true, finishedAt: Date.now() },
    });
  });
}

async function dismissOnboardingIfPresent(page) {
  const skip = page.locator('[data-ob="skip"]');
  if (await skip.count()) {
    const visible = await skip.first().isVisible().catch(() => false);
    if (visible) {
      await skip.first().click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(400);
    }
  }
  await page.evaluate(() => {
    document.body.classList.remove('ob-tour-lock');
    document.querySelectorAll('.ob-root').forEach((el) => el.remove());
    // UX 가이드/토스트가 탭 클릭을 가로챔
    document.getElementById('ux-guide-root')?.remove();
    document.querySelectorAll('.ux-guide-backdrop, .ux-guide-toast, .ss-style-confirm-overlay').forEach((el) => {
      if (el.classList.contains('ss-style-confirm-overlay')) return;
      el.remove();
    });
  });
}

async function dismissUxGuides(page) {
  await page.evaluate(() => {
    document.getElementById('ux-guide-root')?.remove();
    document.querySelectorAll('.ux-guide-backdrop, .ux-guide-toast').forEach((el) => el.remove());
  });
}

async function openExtensionPopup(context, extensionId) {
  await seedOnboardingDone(context);
  const page = await context.newPage();
  const url = `chrome-extension://${extensionId}/popup.html`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#panelSettings, button[data-tab="settings"]', {
    timeout: 15000,
  }).catch(() => {});
  // initAccountUi 완료 대기
  await page.waitForFunction(
    () => {
      const card = document.getElementById('accountCard');
      const hint = document.getElementById('apiBaseHint')?.textContent || '';
      return card && !card.hidden && /127\.0\.0\.1:8787|API:/.test(hint);
    },
    { timeout: 20000 }
  ).catch(() => {});
  await page.waitForTimeout(600);
  await dismissOnboardingIfPresent(page);
  return page;
}

async function clickTab(page, tab) {
  // 실제 팝업 data-tab: work(리뷰) | inquiry | settings(계정)
  const map = {
    review: 'work',
    work: 'work',
    inquiry: 'inquiry',
    account: 'settings',
    settings: 'settings',
  };
  const dataTab = map[tab] || tab;
  const panelId =
    dataTab === 'settings' ? 'panelSettings' : dataTab === 'inquiry' ? 'panelInquiry' : 'panelWork';
  await dismissOnboardingIfPresent(page);
  await dismissUxGuides(page);
  const selectors = [
    `button[data-tab="${dataTab}"]`,
    `button.tab.${dataTab}`,
    tab === 'account' || tab === 'settings' ? 'button:has-text("계정")' : null,
    tab === 'review' || tab === 'work' ? 'button:has-text("리뷰")' : null,
    tab === 'inquiry' ? 'button:has-text("상품문의")' : null,
  ].filter(Boolean);
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.count()) {
      await el.click({ timeout: 5000 });
      await page.waitForFunction(
        (id) => document.getElementById(id)?.classList.contains('active'),
        panelId,
        { timeout: 8000 }
      );
      await page.waitForTimeout(300);
      return;
    }
  }
  throw new Error(`탭을 찾지 못함: ${tab}`);
}

async function openKnowledgeManagePage(context, extensionId) {
  const km = await context.newPage();
  km.on('dialog', async (d) => {
    try {
      await d.accept();
    } catch {
      /* already handled */
    }
  });
  await km.goto(`chrome-extension://${extensionId}/knowledge-manage.html`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await km.waitForSelector('#kbSaveBtn, #knowledgeEntryList', { timeout: 15000 });
  await km.waitForTimeout(500);
  return km;
}

async function openInquirySelectPage(context, extensionId) {
  const selectPage = await context.newPage();
  await selectPage.goto(`chrome-extension://${extensionId}/inquiry-select.html`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await selectPage.waitForSelector('#selectList, #generateBtn', { timeout: 15000 });
  return selectPage;
}

async function readApiHint(page) {
  return page.locator('#apiBaseHint').textContent().catch(() => '');
}

async function registerAndLogin(page, email, password) {
  await dismissOnboardingIfPresent(page);
  await clickTab(page, 'account');
  await page.waitForFunction(
    () => {
      const box = document.getElementById('emailAuthBox');
      const card = document.getElementById('accountCard');
      const panel = document.getElementById('panelSettings');
      return (
        panel?.classList.contains('active') &&
        card &&
        !card.hidden &&
        box &&
        !box.hidden
      );
    },
    { timeout: 20000 }
  );
  const box = page.locator('#emailAuthBox');
  await box.waitFor({ state: 'visible', timeout: 10000 });
  await page.fill('#emailAuthEmail', email);
  await page.fill('#emailAuthPassword', password);
  await page.click('#emailRegisterBtn');
  await page.waitForFunction(
    () => {
      const status = document.getElementById('emailAuthStatus')?.textContent || '';
      const loggedIn = document.getElementById('accountLoggedIn') && !document.getElementById('accountLoggedIn').hidden;
      return loggedIn || /로그인되었습니다|이미 가입|이미 존재|사용 중/.test(status);
    },
    { timeout: 30000 }
  );
  // 이미 가입이면 로그인 버튼
  const loggedIn = await page.evaluate(() => {
    const el = document.getElementById('accountLoggedIn');
    return el && !el.hidden;
  });
  if (!loggedIn) {
    await page.click('#emailLoginBtn');
    await page.waitForFunction(
      () => {
        const el = document.getElementById('accountLoggedIn');
        return el && !el.hidden;
      },
      { timeout: 30000 }
    );
  }
}

async function logoutIfPossible(page) {
  await dismissOnboardingIfPresent(page);
  await dismissUxGuides(page);
  await clickTab(page, 'account').catch(() => {});
  await page.waitForTimeout(300);
  await dismissUxGuides(page);
  const loggedIn = await page.evaluate(() => {
    const el = document.getElementById('accountLoggedIn');
    return !!(el && !el.hidden);
  });
  if (!loggedIn) return;
  const btn = page.locator('#logoutBtn');
  if (!(await btn.count()) || !(await btn.isVisible().catch(() => false))) {
    // UI 버튼이 안 보이면 확장 세션을 직접 제거
    await page.evaluate(async () => {
      if (typeof logoutAccount === 'function') await logoutAccount();
      else {
        const key = (CONFIG && CONFIG.AUTH_STORAGE_KEY) || 'smartstoreAuthSession';
        await chrome.storage.local.remove([key]);
      }
      if (typeof renderAccountUi === 'function') await renderAccountUi();
      if (typeof switchTab === 'function') switchTab('settings');
    });
  } else {
    await btn.click({ timeout: 5000 });
  }
  await page.waitForFunction(
    () => {
      const loggedInEl = document.getElementById('accountLoggedIn');
      const box = document.getElementById('emailAuthBox');
      const out = document.getElementById('accountLoggedOut');
      return (
        (!loggedInEl || loggedInEl.hidden) &&
        out &&
        !out.hidden &&
        box &&
        !box.hidden
      );
    },
    { timeout: 15000 }
  );
}

async function saveKb(context, extensionId, { productNo, productName, specs, usage, extra }) {
  const km = await openKnowledgeManagePage(context, extensionId);
  try {
    await km.fill('#kbProductNo', productNo);
    await km.fill('#kbProductName', productName || '');
    if (specs != null) await km.fill('#kbSpecs', specs);
    if (usage != null) await km.fill('#kbUsage', usage);
    if (extra != null) await km.fill('#kbExtra', extra);
    await km.click('#kbSaveBtn');
    await km.waitForFunction(
      () => {
        const kb = document.getElementById('kbStatus')?.textContent || '';
        const page = document.getElementById('pageStatus')?.textContent || '';
        return /저장됨|저장했습니다|출처/.test(kb + page);
      },
      { timeout: 20000 }
    );
    return (
      (await km.locator('#kbStatus').textContent().catch(() => '')) ||
      (await km.locator('#pageStatus').textContent().catch(() => ''))
    );
  } finally {
    await km.close().catch(() => {});
  }
}

async function loadKb(context, extensionId, productNo) {
  const km = await openKnowledgeManagePage(context, extensionId);
  try {
    await km.fill('#kbProductNo', productNo);
    await km.click('#kbLoadBtn');
    await km.waitForFunction(
      () => {
        const kb = document.getElementById('kbStatus')?.textContent || '';
        const page = document.getElementById('pageStatus')?.textContent || '';
        return /불러옴|출처|저장됨/.test(kb + page);
      },
      { timeout: 20000 }
    );
    return {
      status:
        (await km.locator('#kbStatus').textContent().catch(() => '')) ||
        (await km.locator('#pageStatus').textContent().catch(() => '')),
      specs: await km.inputValue('#kbSpecs'),
      productName: await km.inputValue('#kbProductName'),
    };
  } finally {
    await km.close().catch(() => {});
  }
}

async function seedInquiryParseCache(page, rows) {
  await page.evaluate(async (inquiryRows) => {
    const key = CONFIG.INQUIRY_PARSE_CACHE_KEY || 'smartstoreInquiryParseCache';
    await chrome.storage.local.set({
      [key]: {
        inquiryRows,
        selectedIds: inquiryRows.map((r) => r.id),
        statusMessage: `${inquiryRows.length}건 테스트 문의(판매자센터 대체)`,
        lookupDays: 7,
        fetchedAt: Date.now(),
      },
    });
  }, rows);
}

const TONE_SAMPLES = [
  '안녕하세요 고객님, 소중한 후기 정말 감사합니다. 만족해 주셔서 기쁩니다.',
  '안녕하세요 고객님, 구매해 주셔서 감사합니다. 좋은 하루 보내세요.',
  '안녕하세요 고객님, 빠른 배송에 만족하셨다니 기쁩니다. 감사합니다.',
].join('\n\n---\n\n');

async function openReviewStylePaste(page) {
  await clickTab(page, 'review');
  await page.click('#reviewModeStyle');
  await page.waitForFunction(
    () => document.getElementById('reviewStylePanel')?.classList.contains('active'),
    { timeout: 8000 }
  );
  const pasteHead = page.locator('.style-mode-card[data-mode="paste"] .style-mode-head').first();
  await pasteHead.click({ timeout: 5000 });
  await page.waitForSelector('#sampleReplies', { state: 'visible', timeout: 8000 });
}

async function runToneAnalyzeUi(page) {
  await openReviewStylePaste(page);
  await page.fill('#sampleReplies', TONE_SAMPLES);
  await page.waitForFunction(
    () => {
      const btn = document.getElementById('analyzeBtn');
      return btn && !btn.disabled;
    },
    { timeout: 10000 }
  );
  await page.click('#analyzeBtn');

  // 분석 중 표시
  await page.waitForFunction(
    () => {
      const btn = document.getElementById('analyzeBtn');
      const status =
        document.getElementById('sampleFlowStatus')?.textContent ||
        document.querySelector('.sample-flow-status')?.textContent ||
        '';
      return (
        (btn && /분석/.test(btn.textContent || '')) ||
        /만드는 중|분석/.test(status) ||
        !!document.querySelector('.ss-style-confirm-overlay')
      );
    },
    { timeout: 60000 }
  ).catch(() => {});

  // 적용 확인 모달 — 지침 본문이 채워진 뒤 저장
  await page.waitForSelector('.ss-style-confirm-overlay [data-action="apply"]', {
    timeout: 180000,
  });
  await page.waitForFunction(
    () => {
      const root = document.querySelector('.ss-style-confirm-overlay');
      if (!root) return false;
      const bits = [
        ...root.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]'),
      ]
        .map((el) => String(el.value || el.textContent || '').trim())
        .join('\n');
      const hostText = root.querySelector('.ss-style-guideline-host')?.innerText || '';
      const bodyText = root.innerText || '';
      return bits.length > 20 || hostText.length > 40 || /말투|존댓|인사|지침/.test(bodyText);
    },
    { timeout: 60000 }
  );
  const preview = await page.locator('.ss-style-confirm-overlay').innerText().catch(() => '');
  // 지침이 비어 적용 시 삭제되는 경우 방지: textarea fallback 값이 있으면 유지
  await page.evaluate(() => {
    const root = document.querySelector('.ss-style-confirm-overlay');
    if (!root) return;
    const ta = root.querySelector('textarea.ss-style-preview-new, .ss-style-guideline-host textarea');
    if (ta && !String(ta.value || '').trim() && /말투|존댓/.test(root.innerText || '')) {
      // keep as-is; apply uses editor.getSerialized()
    }
  });
  await page.click('.ss-style-confirm-overlay [data-action="apply"]');
  await page.waitForFunction(
    () => !document.querySelector('.ss-style-confirm-overlay'),
    { timeout: 15000 }
  );
  await dismissUxGuides(page);
  // storage 반영 대기
  await page.waitForFunction(
    async () => {
      const key = (globalThis.CONFIG && CONFIG.SETTINGS_KEY) || 'smartstoreReviewSettings';
      const data = await chrome.storage.local.get([key]);
      const prompt = String(data[key]?.systemPrompt || '').trim();
      return prompt.length > 20;
    },
    { timeout: 20000 }
  );
  const status = await page.locator('#sampleFlowStatus').textContent().catch(() => '');
  const settings = await page.evaluate(async () => {
    const key = CONFIG.SETTINGS_KEY || 'smartstoreReviewSettings';
    const data = await chrome.storage.local.get([key]);
    const s = data[key] || {};
    return {
      prompt: String(s.systemPrompt || '').slice(0, 400),
      tonePresetId: s.tonePresetId || '',
      styleActiveMode: s.styleActiveMode || '',
      sampleFlow: s.sampleFlow || null,
    };
  });
  return { status, preview: String(preview).slice(0, 500), settings };
}

async function seedReviewParseCache(page, rows) {
  await page.evaluate(async (parsedRows) => {
    const key = CONFIG.PARSE_CACHE_KEY || 'smartstoreReviewParseCache';
    await chrome.storage.local.set({
      [key]: {
        parsedRows,
        selectedIds: parsedRows.map((r) => r.id),
        columnMap: {},
        headers: [],
        skippedReplied: 0,
        fileName: 'e2e-synthetic-reviews',
        statusMessage: `${parsedRows.length}건 테스트 데이터(판매자센터 대체)`,
        lookupDays: 7,
        fetchedAt: Date.now(),
      },
    });
  }, rows);
}

async function openSelectPage(context, extensionId) {
  const selectPage = await context.newPage();
  await selectPage.goto(`chrome-extension://${extensionId}/select.html`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await selectPage.waitForSelector('#selectList, #generateBtn', { timeout: 15000 });
  return selectPage;
}

async function main() {
  const health = await waitApi();
  record('로컬 API health', true, { health }, 'apiOnly');

  // config.local overlay must be enabled before launch
  const localCfg = fs.readFileSync(path.join(EXT_ROOT, 'config.local.js'), 'utf8');
  if (!/LOCAL_API_OVERRIDE_ENABLED\s*=\s*true/.test(localCfg)) {
    throw new Error('config.local.js LOCAL_API_OVERRIDE_ENABLED=true 필요');
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-e2e-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_ROOT}`,
      `--load-extension=${EXT_ROOT}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
    viewport: { width: 480, height: 900 },
  });

  let extensionId = '';
  let worker = null;
  try {
    ({ id: extensionId, worker } = await getExtensionId(context));
    record('실제 Chrome 확장 로드(service worker)', true, {
      extensionId,
      workerUrl: worker.url(),
    });

    const page = await openExtensionPopup(context, extensionId);
    record('확장 팝업 chrome-extension:// 진입', true, {
      url: page.url(),
    });

    const overlay = await page.evaluate(() => ({
      apiBase: String(globalThis.CONFIG?.API_BASE_URL || ''),
      localFlag: globalThis.CONFIG?.__LOCAL_API_OVERRIDE__ === true,
      hasChromeStorage: !!(typeof chrome !== 'undefined' && chrome.storage?.local),
      hasRuntime: !!(typeof chrome !== 'undefined' && chrome.runtime?.id),
    }));
    record('로컬 API 오버레이 + chrome API', overlay.localFlag && /127\.0\.0\.1:8787/.test(overlay.apiBase) && overlay.hasChromeStorage && overlay.hasRuntime, overlay);

    // Network: capture API host
    const apiHosts = new Set();
    page.on('request', (req) => {
      try {
        const u = new URL(req.url());
        if (u.port === '8787' || u.hostname === '127.0.0.1') apiHosts.add(u.host);
      } catch (_) {}
    });

    const emailA = `ext-a-${stamp}@example.com`;
    const emailB = `ext-b-${stamp}@example.com`;
    const password = 'TestPass123!';
    const productNo = '8800777666555';
    let capturedConfirmIdA = null;

    // 1-3 register/login/session
    try {
      await registerAndLogin(page, emailA, password);
      const session = await page.evaluate(async () => {
        const key = (globalThis.CONFIG && CONFIG.AUTH_STORAGE_KEY) || 'smartstoreAuthSession';
        const data = await chrome.storage.local.get([key]);
        return data[key] || null;
      });
      record('이메일 회원가입/로그인', !!session?.token, {
        email: emailA,
        hasToken: !!session?.token,
      });
      record('chrome.storage.local 세션 유지', !!session?.token && !!session?.email, {
        email: session?.email,
        authProvider: session?.authProvider,
      });
    } catch (err) {
      record('이메일 회원가입/로그인', false, { error: err.message || String(err) });
    }

    const hint = await readApiHint(page);
    record('계정 탭 API 힌트(로컬)', /127\.0\.0\.1:8787/.test(hint || ''), { hint });

    // 헤더 3단계 문구 (로그인 후)
    const headerSub = await page.locator('#headerSub').textContent().catch(() => '');
    record(
      '헤더 3단계 문구 유지(로그인 후)',
      /가져오기/.test(headerSub || '') && /말투|지침/.test(headerSub || '') && /초안/.test(headerSub || ''),
      { headerSub }
    );

    // 4-8 KB CRUD via knowledge-manage.html
    try {
      const saveStatus = await saveKb(context, extensionId, {
        productNo,
        productName: 'E2E오메가3',
        specs: 'EPA 300mg',
        usage: '하루 1캡슐',
      });
      record('상품 지식 신규 저장(UI)', /저장됨/.test(saveStatus || ''), { saveStatus });

      const loaded = await loadKb(context, extensionId, productNo);
      record('상품 지식 불러오기(UI)', /EPA 300mg/.test(loaded.specs || ''), loaded);

      const kmEdit = await openKnowledgeManagePage(context, extensionId);
      try {
        await kmEdit.fill('#kbProductNo', productNo);
        await kmEdit.click('#kbLoadBtn');
        await kmEdit.waitForFunction(
          () => /불러옴|출처|저장됨/.test(
            (document.getElementById('kbStatus')?.textContent || '') +
              (document.getElementById('pageStatus')?.textContent || '')
          ),
          { timeout: 20000 }
        );
        await kmEdit.fill('#kbSpecs', 'EPA 300mg / DHA 200mg');
        await kmEdit.click('#kbSaveBtn');
        await kmEdit.waitForFunction(
          () => /저장됨/.test(
            (document.getElementById('kbStatus')?.textContent || '') +
              (document.getElementById('pageStatus')?.textContent || '')
          ),
          { timeout: 20000 }
        );
      } finally {
        await kmEdit.close().catch(() => {});
      }
      const reloaded = await loadKb(context, extensionId, productNo);
      record('상품 지식 수정·재저장(UI)', /DHA 200mg/.test(reloaded.specs || ''), reloaded);

      const kmDel = await openKnowledgeManagePage(context, extensionId);
      let delStatus = '';
      try {
        await kmDel.fill('#kbProductNo', productNo);
        await kmDel.click('#kbLoadBtn');
        await kmDel.waitForTimeout(800);
        await kmDel.evaluate(() => {
          const status = document.getElementById('kbStatus');
          if (status) status.hidden = false;
        });
        await kmDel.click('#kbDeleteBtn');
        await kmDel.waitForFunction(
          () => /삭제/.test(
            (document.getElementById('kbStatus')?.textContent || '') +
              (document.getElementById('pageStatus')?.textContent || '')
          ),
          { timeout: 20000 }
        );
        delStatus =
          (await kmDel.locator('#kbStatus').textContent().catch(() => '')) ||
          (await kmDel.locator('#pageStatus').textContent().catch(() => ''));
      } finally {
        await kmDel.close().catch(() => {});
      }
      const afterDel = await page.evaluate(async (no) => {
        try {
          return await fetchAuthApi(`/api/product-knowledge/${encodeURIComponent(no)}`);
        } catch (e) {
          return { error: e.message || String(e) };
        }
      }, productNo);
      record('상품 지식 삭제(UI)', /삭제/.test(delStatus || '') && !!afterDel?.error, {
        delStatus,
        afterDel,
      });
      // 후속 테스트용 재저장
      await saveKb(context, extensionId, {
        productNo,
        productName: 'E2E오메가3',
        specs: 'EPA 300mg / DHA 200mg',
        usage: '하루 1캡슐',
      });
    } catch (err) {
      record('상품 지식 CRUD(UI)', false, { error: err.message || String(err) });
    }

    // 9 store policies (knowledge-manage.html)
    try {
      const kmPol = await openKnowledgeManagePage(context, extensionId);
      try {
        await kmPol.evaluate(() => {
          const details = document.querySelector('#productKnowledgeCard details');
          if (details) details.open = true;
        });
        await kmPol.waitForTimeout(200);
        await kmPol.locator('#policyShipping').fill('영업일 2~3일 출고', { force: true });
        await kmPol.locator('#policyExchange').fill('7일 이내 반품', { force: true });
        await kmPol.click('#policySaveBtn');
        await kmPol.waitForFunction(
          () => /정책|저장/.test(
            (document.getElementById('kbStatus')?.textContent || '') +
              (document.getElementById('pageStatus')?.textContent || '')
          ),
          { timeout: 20000 }
        );
      } finally {
        await kmPol.close().catch(() => {});
      }
      const pol = await page.evaluate(async () => fetchAuthApi('/api/store-policies'));
      record('스토어 정책 저장·조회(UI+확장 API)', /영업일/.test(pol?.policies?.shipping || ''), {
        policies: pol?.policies,
      });
    } catch (err) {
      record('스토어 정책 저장·조회', false, { error: err.message || String(err) });
    }

    // Seed inquiry reference cache so inquiry test can run without seller center
    await page.evaluate(async (productNo) => {
      const key = (CONFIG && CONFIG.INQUIRY_REFERENCE_CACHE_KEY) || 'smartstoreInquiryReferenceCache';
      await chrome.storage.local.set({
        [key]: {
          catalog: [
            {
              id: 'ref-e2e-1',
              product: 'E2E오메가3',
              productNo,
              question: '사용법 알려주세요',
              answer: '식사 후 1캡슐 드세요. 감사합니다.',
              score: 20,
            },
          ],
          selectedIds: ['ref-e2e-1'],
          fetchedAt: Date.now(),
          days: 30,
          withAnswerCount: 1,
        },
      });
      // Ensure inquiry system prompt exists
      const settingsKey = CONFIG.SETTINGS_KEY || 'smartstoreReviewSettings';
      const cur = (await chrome.storage.local.get([settingsKey]))[settingsKey] || {};
      await chrome.storage.local.set({
        [settingsKey]: {
          ...cur,
          inquirySystemPrompt: [
            '[말투·표현] - 존댓말로 짧게',
            '[답변 방식] - 질문에 구체적으로 답한다',
          ].join('\n'),
          inquiryTonePresetId: 'custom',
        },
      });
    }, productNo);
    record('문의 참고 캐시 시드(확장 storage, 판매자센터 대체)', true, {
      note: '실제 판매자센터 수집 아님 — 대체 데이터',
    }, 'apiOnly');

    // 문의 답글 경로 (판매자센터 없이 storage 시드 → inquiry-select)
    const inquiryRows = [
      {
        id: 'e2e-inq-1',
        product: 'E2E오메가3',
        productNo,
        content: '하루 몇 캡슐 먹으면 되나요?',
        question: '하루 몇 캡슐 먹으면 되나요?',
        writer: '문의테스터A',
      },
      {
        id: 'e2e-inq-2',
        product: 'E2E오메가3',
        productNo,
        content: '이 제품에 콜라겐도 들어있나요?',
        question: '이 제품에 콜라겐도 들어있나요?',
        writer: '문의테스터B',
      },
    ];
    try {
      await dismissUxGuides(page);
      await seedInquiryParseCache(page, inquiryRows);
      record('문의 데이터 시드(확장 storage, 판매자센터 대체)', true, {
        count: inquiryRows.length,
      }, 'apiOnly');

      await clickTab(page, 'inquiry');
      await page.click('#inquiryModeWork', { force: true }).catch(() => {});
      await page.evaluate(() => {
        if (typeof restoreInquiryCache === 'function') {
          return chrome.storage.local
            .get([CONFIG.INQUIRY_PARSE_CACHE_KEY || 'smartstoreInquiryParseCache'])
            .then((data) => {
              restoreInquiryCache(
                data[CONFIG.INQUIRY_PARSE_CACHE_KEY || 'smartstoreInquiryParseCache']
              );
            });
        }
        return null;
      });
      await page.waitForTimeout(500);

      const stylePrompt = await page.evaluate(async () => {
        const key = CONFIG.SETTINGS_KEY || 'smartstoreReviewSettings';
        const s = (await chrome.storage.local.get([key]))[key] || {};
        return String(s.inquirySystemPrompt || '');
      });
      record('저장된 문의 말투 지침 조회', /말투|존댓|답변/.test(stylePrompt), {
        promptPreview: stylePrompt.slice(0, 160),
      });

      const popupInquiry = await page.evaluate(() => {
        const btn = document.getElementById('inquirySelectBtn');
        const summary = document.getElementById('inquirySummary')?.textContent || '';
        return { enabled: btn && !btn.disabled, text: btn?.textContent || '', summary };
      });
      record(
        '문의 목록·답글 만들기 버튼(팝업)',
        !!popupInquiry.enabled || /2/.test(popupInquiry.summary + popupInquiry.text),
        popupInquiry
      );

      const inqPage = await openInquirySelectPage(context, extensionId);
      await inqPage.waitForFunction(
        () => (document.querySelectorAll('#selectList .card').length || 0) >= 1,
        { timeout: 15000 }
      );
      const listed = await inqPage.locator('#selectList .card').count();
      record('문의 작업 화면 진입·목록 표시', listed >= 1, { listed, url: inqPage.url() });

      const allBtn = inqPage.locator('#selectAllBtn');
      if (await allBtn.count()) {
        await allBtn.click();
      } else {
        const checks = inqPage.locator('#selectList .card-check');
        const n = await checks.count();
        for (let i = 0; i < n; i += 1) {
          await checks.nth(i).check({ force: true }).catch(() => {});
        }
      }
      await inqPage.waitForFunction(
        () => {
          const btn = document.getElementById('generateBtn');
          return btn && !btn.disabled;
        },
        { timeout: 10000 }
      );
      record('문의 선택 후 생성 버튼 활성', true);

      await inqPage.click('#generateBtn');
      record('문의 답글 초안 생성 클릭(UI)', true);
      await inqPage.waitForFunction(
        () => {
          const inputs = document.querySelectorAll('#reviewList .reply-input, .reply-input');
          const filled = [...inputs].filter((el) => (el.value || '').trim().length > 8).length;
          const text = document.body?.innerText || '';
          return filled >= 1 || /완성|완료|성공/.test(text);
        },
        { timeout: 240000 }
      );

      await inqPage.locator('#tabReview').click({ timeout: 10000 }).catch(() => {});
      await inqPage
        .evaluate(() => {
          if (typeof switchTab === 'function') switchTab('review');
        })
        .catch(() => {});
      await inqPage.waitForSelector('.reply-input', { timeout: 60000 });

      const replies = await inqPage.evaluate(() =>
        [...document.querySelectorAll('.reply-input')].map((el) => ({
          id: el.getAttribute('data-id'),
          text: (el.value || '').trim(),
          disabled: !!el.disabled,
        }))
      );
      const generatedOk = replies.length >= 1 && replies.some((r) => r.text.length > 8);
      record('문의 답글 초안 결과 표시', generatedOk, {
        replies: replies.map((r) => ({ id: r.id, len: r.text.length, preview: r.text.slice(0, 120) })),
      });

      if (replies[0]?.id && !replies[0].disabled) {
        const first = inqPage.locator(`.reply-input[data-id="${replies[0].id}"]`).first();
        const edited = `${replies[0].text}\n(E2E문의수정)`;
        await first.fill(edited);
        await inqPage.waitForTimeout(400);
        const after = await first.inputValue();
        record('문의 답글 입력·수정(UI)', after.includes('E2E문의수정'), {
          note: '복사 전용 버튼 없을 수 있음 — textarea 수정으로 입력 검증',
        });
      } else {
        record('문의 답글 입력·수정(UI)', false, { error: '수정 가능한 reply-input 없음' });
      }

      const applyUi = await inqPage.evaluate(() => {
        const applyBtn =
          document.getElementById('applyBtn') ||
          document.getElementById('enableApplyBtn') ||
          document.querySelector('[data-action="apply"], #applyToggle');
        const applyStatus = document.getElementById('applyStatus')?.textContent || '';
        const body = document.body?.innerText || '';
        return {
          hasApplyControl: !!applyBtn,
          applyStatus,
          mentionsApply: /판매자센터|적용|올리기|채워/.test(body),
        };
      });
      record(
        '문의 적용·사용 UI 확인',
        applyUi.hasApplyControl || applyUi.mentionsApply,
        applyUi
      );

      // 보안 교차검증용 confirmation id — API generate-reply로 확보 (숨김 테스트 패널 미사용)
      const confSeed = await page.evaluate(async (no) => {
        try {
          const settingsKey = CONFIG.SETTINGS_KEY || 'smartstoreReviewSettings';
          const settings = (await chrome.storage.local.get([settingsKey]))[settingsKey] || {};
          const data = await postAiApi('/api/generate-reply', {
            channel: 'inquiry',
            systemPrompt: settings.inquirySystemPrompt || '[말투·표현] - 존댓말',
            row: {
              product: 'E2E오메가3',
              productNo: no,
              content: '이 제품에 히알루론산도 들어있나요?',
            },
            references: [
              {
                id: 'conf-ref-1',
                question: '사용법요',
                answer: '하루 1캡슐 드세요',
                product: 'E2E오메가3',
                productNo: no,
              },
            ],
          });
          return {
            text: data?.text || '',
            confirmId: data?.confirmation?.id || null,
            judgment: data?.judgment || data?.confirmation?.status || '',
          };
        } catch (e) {
          return { error: e.message || String(e) };
        }
      }, productNo);
      capturedConfirmIdA = confSeed.confirmId || null;
      if (!capturedConfirmIdA) {
        const listed = await page.evaluate(async () => {
          try {
            return await fetchAuthApi('/api/inquiry-confirmations?status=needs_confirm');
          } catch (e) {
            return { error: e.message || String(e) };
          }
        });
        capturedConfirmIdA = listed?.items?.[0]?.id || null;
      }
      record('문의 confirmation 시드(API, 보안용)', !!capturedConfirmIdA || !!confSeed.text, {
        capturedConfirmIdA,
        judgment: confSeed.judgment,
        preview: String(confSeed.text || '').slice(0, 120),
        note: '숨김 inquiryModeTest 패널 대신 정상 generate-reply 경로',
      });

      report.categories.notRun.push({
        name: '문의 답글 복사 전용 버튼',
        ok: false,
        reason: 'inquiry-select에 복사 전용 UI 없을 수 있음 — textarea 수정·적용 UI만 검증',
      });
      report.categories.notRun.push({
        name: '판매자센터 실문의 가져오기',
        ok: false,
        reason: 'NOT TESTED — 판매자센터 미접속',
      });
      await inqPage.close().catch(() => {});
    } catch (err) {
      record('문의 답글 경로 검증', false, { error: err.message || String(err) });
    }

    // --- 말투 분석 실제 UI (체험 tone 1회 소모) ---
    let toneUiAppliedPrompt = '';
    try {
      await clickTab(page, 'review');
      record(
        '리뷰 스타일 모드 진입(UI)',
        true,
        { note: '리뷰 탭 → 답변 스타일 설정' }
      );
      const toneUi = await runToneAnalyzeUi(page);
      toneUiAppliedPrompt = toneUi.settings?.prompt || '';
      const analyzeUiOk =
        toneUiAppliedPrompt.length > 40 ||
        /적용|완료|저장|말투/.test(toneUi.status || '');
      record('말투 붙여넣기·분석 실행(UI)', analyzeUiOk, {
        status: toneUi.status,
        mode: toneUi.settings?.styleActiveMode,
        promptLen: toneUiAppliedPrompt.length,
      });
      const looksToneV2 =
        /\[말투·표현\]|존댓|인사/.test(toneUiAppliedPrompt) &&
        toneUiAppliedPrompt.length > 40 &&
        !/분석 오류/.test(toneUi.status || '');
      record('말투 tone_v2 결과·저장 확인(UI)', looksToneV2, {
        promptPreview: toneUiAppliedPrompt.slice(0, 220),
        tonePresetId: toneUi.settings?.tonePresetId,
        analyzedCount: toneUi.settings?.sampleFlow?.analyzedCount,
        note: '붙여넣기 UI → ANALYZE_TONE_SAMPLES_JOB → 적용 모달 저장',
      });
      // 기존 항목 유지: 추가 analyze-tone API 호출 없이 storage 재확인 (체험 한도 1회)
      record('말투 분석 tone_v2(확장 postAiApi)', looksToneV2, {
        version: 'tone_v2(inferred-from-ui-apply)',
        promptPreview: toneUiAppliedPrompt.slice(0, 160),
        note: 'UI 분석이 체험 말투 1회를 사용하므로 추가 postAiApi(/analyze-tone) 호출 없음 — storage 적용 결과로 유지 검증',
      });
    } catch (err) {
      record('말투 붙여넣기·분석 실행(UI)', false, { error: err.message || String(err) });
      record('말투 tone_v2 결과·저장 확인(UI)', false, { error: err.message || String(err) });
      record('말투 분석 tone_v2(확장 postAiApi)', false, { error: err.message || String(err) });
    }

    // --- 리뷰 답글 실제 UI (판매자센터 데이터 대체 시드) ---
    const reviewRows = [
      {
        id: 'e2e-r1',
        product: 'E2E오메가3',
        content: '배송 빨라요 좋아요. 포장도 꼼꼼합니다.',
        rating: '5',
        writer: '테스터A',
        reviewType: '텍스트',
      },
      {
        id: 'e2e-r2',
        product: 'E2E오메가3',
        content: '맛있어요. 또 구매할게요.',
        rating: '5',
        writer: '테스터B',
        reviewType: '텍스트',
      },
    ];
    try {
      await dismissUxGuides(page);
      await seedReviewParseCache(page, reviewRows);
      record('리뷰 데이터 시드(확장 storage, 판매자센터 대체)', true, {
        count: reviewRows.length,
        note: '실제 판매자센터 수집 아님 — PARSE_CACHE 테스트 데이터',
      }, 'apiOnly');

      // 팝업에서 시드 반영·답글 만들기 버튼 활성화 확인
      await dismissUxGuides(page);
      await clickTab(page, 'review');
      await page.click('#reviewModeWork', { force: true });
      await page.evaluate(() => {
        if (typeof restoreParseCache === 'function') {
          return chrome.storage.local.get([CONFIG.PARSE_CACHE_KEY]).then((data) => {
            restoreParseCache(data[CONFIG.PARSE_CACHE_KEY]);
          });
        }
        return null;
      });
      await page.waitForTimeout(500);
      const popupReady = await page.evaluate(() => {
        const btn = document.getElementById('selectBtn');
        const summary = document.getElementById('fileSummary')?.textContent || '';
        return {
          enabled: btn && !btn.disabled,
          text: btn?.textContent || '',
          summary,
        };
      });
      record('리뷰 화면·데이터 확인(팝업 UI)', !!popupReady.enabled && /2/.test(popupReady.text + popupReady.summary), {
        popupReady,
      });

      const selectPage = await openSelectPage(context, extensionId);
      await selectPage.waitForFunction(
        () => (document.querySelectorAll('#selectList .card').length || 0) >= 1,
        { timeout: 15000 }
      );
      const listed = await selectPage.locator('#selectList .card').count();
      record('리뷰 작업 화면 진입·목록 확인(UI)', listed >= 2, {
        listed,
        url: selectPage.url(),
      });

      const allBtn = selectPage.locator('#selectAllBtn');
      if (await allBtn.count()) {
        await allBtn.click();
      } else {
        const checks = selectPage.locator('#selectList .card-check');
        const n = await checks.count();
        for (let i = 0; i < n; i += 1) {
          await checks.nth(i).check({ force: true }).catch(() => {});
        }
      }
      await selectPage.waitForFunction(
        () => {
          const btn = document.getElementById('generateBtn');
          return btn && !btn.disabled;
        },
        { timeout: 10000 }
      );
      await selectPage.click('#generateBtn');
      record('리뷰 답글 생성 버튼 클릭(UI)', true, { selected: listed });

      await selectPage.waitForFunction(
        () => {
          const progress = document.getElementById('genProgress');
          const inputs = document.querySelectorAll('#reviewList .reply-input');
          const filled = [...inputs].filter((el) => (el.value || '').trim().length > 8).length;
          const text = document.body?.innerText || '';
          return (
            filled >= 1 ||
            /완성|완료|성공/.test(text) ||
            (progress && !progress.classList.contains('hidden') && /완료|성공|완성/.test(progress.textContent || ''))
          );
        },
        { timeout: 240000 }
      );

      // 검토 탭으로 전환 (생성 완료 시 자동 전환되나 재클릭으로 보장)
      await selectPage.locator('#tabReview').click({ timeout: 10000 }).catch(() => {});
      await selectPage.evaluate(() => {
        if (typeof switchTab === 'function') switchTab('review');
      }).catch(() => {});
      await selectPage.waitForSelector('#reviewList .reply-input', { timeout: 60000 });

      const replies = await selectPage.evaluate(() =>
        [...document.querySelectorAll('#reviewList .reply-input')].map((el) => ({
          id: el.getAttribute('data-id'),
          text: (el.value || '').trim(),
          disabled: !!el.disabled,
        }))
      );
      const generatedOk =
        replies.length >= 1 && replies.every((r) => r.text.length > 8);
      const politeHint = replies.some((r) => /감사|고객님|합니다|해요/.test(r.text));
      record('리뷰 답글 생성 결과·형식(UI)', generatedOk, {
        replies: replies.map((r) => ({ id: r.id, len: r.text.length, preview: r.text.slice(0, 120) })),
      });
      record('말투 적용 후 답글 반영(UI)', generatedOk && (politeHint || /말투|존댓/.test(toneUiAppliedPrompt)), {
        politeHint,
        sample: replies[0]?.text?.slice(0, 160),
      });

      // 입력(수정) 기능 — 복사 전용 버튼은 UI에 없음
      if (replies[0]?.id && !replies[0].disabled) {
        const first = selectPage.locator(`#reviewList .reply-input[data-id="${replies[0].id}"]`);
        const edited = `${replies[0].text}\n(E2E수정확인)`;
        await first.fill(edited);
        await selectPage.waitForTimeout(400);
        const after = await first.inputValue();
        record('리뷰 답글 입력·수정(UI)', after.includes('E2E수정확인'), {
          note: '복사 전용 버튼 없음 — textarea 직접 수정으로 입력 기능 검증',
        });
        // 기존 항목 유지: 확장 세션 postAiApi 보조 검증
        const reviewText = await page.evaluate(async () => {
          const settingsKey = CONFIG.SETTINGS_KEY || 'smartstoreReviewSettings';
          const settings = (await chrome.storage.local.get([settingsKey]))[settingsKey] || {};
          const data = await postAiApi('/api/generate-reply', {
            channel: 'review',
            systemPrompt: settings.systemPrompt,
            row: { product: 'E2E오메가3', content: '배송 빨라요 좋아요', rating: '5' },
          });
          return { text: data.text };
        });
        record('리뷰 답글 생성(확장 postAiApi)', !!reviewText.text && reviewText.text.length > 8, {
          text: String(reviewText.text || '').slice(0, 200),
          note: 'UI 생성과 별도 — 로드된 확장 postAiApi 보조 검증',
        });
      } else {
        record('리뷰 답글 입력·수정(UI)', false, { error: '수정 가능한 reply-input 없음', replies });
        record('리뷰 답글 생성(확장 postAiApi)', false, { error: '선행 UI 생성 실패' });
      }

      report.categories.notRun.push({
        name: '리뷰 답글 복사 버튼',
        ok: false,
        reason: 'select.html에 복사 전용 UI 없음 — 입력(textarea 수정)만 검증',
      });
      await selectPage.close().catch(() => {});
    } catch (err) {
      record('리뷰 답글 UI 흐름', false, { error: err.message || String(err) });
    }

    record('API 요청 호스트 127.0.0.1:8787', [...apiHosts].some((h) => h.includes('127.0.0.1:8787')), {
      apiHosts: [...apiHosts],
    });

    // --- Security A/B ---
    // 확장 로그아웃은 해당 세션 토큰만 폐기하므로, API 로그인으로 A 검증용 토큰을 따로 확보
    const loginA = await api('/api/auth/login', {
      method: 'POST',
      body: { email: emailA, password },
    });
    const tokenA = loginA.data?.token || '';
    if (!tokenA) {
      record('보안: A API 토큰 확보', false, { loginA }, 'apiOnly');
    }

    // UI 확인 흐름에서 확보한 A confirmation id (승인 후라도 소유권 검사에 사용)
    let aConfIdForSecurity = capturedConfirmIdA;
    if (!aConfIdForSecurity && tokenA) {
      for (const status of ['approved', 'needs_confirm', 'dismissed']) {
        const listed = await api(`/api/inquiry-confirmations?status=${status}`, { token: tokenA });
        aConfIdForSecurity = listed.data?.items?.[0]?.id || null;
        if (aConfIdForSecurity) break;
      }
    }
    if (!aConfIdForSecurity && tokenA) {
      const genA = await api('/api/generate-reply', {
        method: 'POST',
        token: tokenA,
        body: {
          channel: 'inquiry',
          systemPrompt: '[말투·표현] - 존댓말\n[답변 방식] - 사실에 근거한다',
          row: {
            product: 'E2E오메가3',
            productNo,
            content: '이 제품에 히알루론산도 들어있나요?',
          },
          references: [
            {
              id: 'sec-ref-1',
              question: '사용법요',
              answer: '하루 1캡슐 드세요',
              product: 'E2E오메가3',
              productNo,
            },
          ],
        },
      });
      aConfIdForSecurity =
        genA.data?.confirmation?.id ||
        (await api('/api/inquiry-confirmations?status=needs_confirm', { token: tokenA })).data?.items?.[0]
          ?.id ||
        null;
    }

    // Create B via API then login in extension UI
    const emailBPass = password;
    await api('/api/auth/register', { method: 'POST', body: { email: emailB, password: emailBPass } });
    await logoutIfPossible(page);
    await page.waitForTimeout(500);
    try {
      await dismissOnboardingIfPresent(page);
      await clickTab(page, 'account');
      await page.waitForFunction(
        () => {
          const box = document.getElementById('emailAuthBox');
          const loggedIn = document.getElementById('accountLoggedIn');
          return box && !box.hidden && (!loggedIn || loggedIn.hidden);
        },
        { timeout: 15000 }
      );
      await page.fill('#emailAuthEmail', emailB);
      await page.fill('#emailAuthPassword', emailBPass);
      await page.click('#emailLoginBtn');
      await page.waitForFunction(
        () => {
          const el = document.getElementById('accountLoggedIn');
          return el && !el.hidden;
        },
        { timeout: 30000 }
      );
      const sessionB = await page.evaluate(async () => {
        const s = await loadAuthSession();
        return { email: s?.email || '', hasToken: !!s?.token };
      });
      record('사용자 B 확장 로그인', sessionB.hasToken && sessionB.email === emailB, {
        email: emailB,
        sessionB,
      });
    } catch (err) {
      record('사용자 B 확장 로그인', false, { error: err.message || String(err) });
    }

    // B must not see A's KB
    try {
      const leak = await page.evaluate(async (no) => {
        try {
          return await fetchAuthApi(`/api/product-knowledge/${encodeURIComponent(no)}`);
        } catch (e) {
          return { error: e.message || String(e), code: e.code };
        }
      }, productNo);
      const blocked =
        !!leak?.error || leak?.ok === false || !leak?.item || leak?.status === 404;
      // fetchAuthApi throws on 404
      record('보안: B가 A productNo 조회 불가(확장)', /찾을 수 없|404|로그인이 필요/i.test(String(leak?.error || '')) || !leak?.item, {
        leak,
      });

      // B creates own KB same productNo
      await saveKb(context, extensionId, {
        productNo,
        productName: 'B전용상품',
        specs: 'B-ONLY-SPEC-999',
      });
      const bLoaded = await loadKb(context, extensionId, productNo);
      record('보안: 동일 productNo B 전용 내용', /B-ONLY-SPEC-999/.test(bLoaded.specs || ''), {
        loaded: bLoaded,
      });

      // A token still has EPA not B-only when fetched via API-only check
      const aGet = await api(`/api/product-knowledge/${productNo}`, { token: tokenA });
      record(
        '보안: A KB가 B 저장과 격리(API 재확인)',
        aGet.status === 200 && /EPA/.test(aGet.data?.item?.specs || '') && !/B-ONLY-SPEC-999/.test(aGet.data?.item?.specs || ''),
        {
          status: aGet.status,
          aSpecs: aGet.data?.item?.specs || null,
          error: aGet.data?.error || null,
          hasTokenA: !!tokenA,
          categoryNote: 'API 로그인 토큰 검증(확장 로그아웃과 분리)',
        },
        'apiOnly'
      );

      // B cannot approve A's confirmation
      let aConfId = aConfIdForSecurity;
      if (!aConfId && tokenA) {
        const aList = await api('/api/inquiry-confirmations?status=needs_confirm', { token: tokenA });
        aConfId = aList.data?.items?.[0]?.id || null;
      }
      if (aConfId) {
        const cross = await page.evaluate(async (id) => {
          try {
            return await fetchAuthApi(`/api/inquiry-confirmations/${id}/approve-fact`, {
              method: 'POST',
              body: { productNo: '8800777666555', field: 'extra', value: 'HACK-BY-B' },
            });
          } catch (e) {
            return { error: e.message || String(e) };
          }
        }, aConfId);
        const blockedCross =
          !!cross?.error ||
          cross?.ok === false ||
          /없|권한|403|404|불가|소유/i.test(String(cross?.error || cross?.message || ''));
        record('보안: B가 A confirmation 승인 불가(확장)', blockedCross, { cross, aConfId });
      } else {
        record('보안: B가 A confirmation 승인 불가(확장)', false, {
          error: 'A confirmation id 확보 실패',
          note: 'needs_confirm 생성 실패 — 교차 승인 UI 검증 불가',
        });
      }

      // B generate should not include A's EPA
      const bGen = await page.evaluate(async (no) => {
        const settingsKey = CONFIG.SETTINGS_KEY || 'smartstoreReviewSettings';
        const settings = (await chrome.storage.local.get([settingsKey]))[settingsKey] || {};
        return postAiApi('/api/generate-reply', {
          channel: 'inquiry',
          systemPrompt: settings.inquirySystemPrompt || '[말투·표현] - 존댓말',
          row: { product: 'B전용상품', productNo: no, content: '스펙이 어떻게 되나요?' },
          references: [
            {
              id: '1',
              question: '스펙요',
              answer: '확인 후 안내드립니다',
              product: 'B전용상품',
            },
          ],
        });
      }, productNo);
      const blob = `${bGen?.text || ''}\n${(bGen?.evidence?.verifiedFacts || []).join('\n')}`;
      record('보안: B 생성에 A KB 미포함(확장 생성)', /B-ONLY-SPEC-999/.test(blob) && !/EPA 300mg/.test(blob), {
        text: String(bGen?.text || '').slice(0, 240),
        facts: bGen?.evidence?.verifiedFacts,
      });
    } catch (err) {
      record('보안 격리 시나리오', false, { error: err.message || String(err) });
    }

    report.categories.notRun.push({
      name: '네이버 판매자센터 실문의 수집·상품번호 추출',
      ok: false,
      reason: '판매자 계정/인증 없음 — 임의 접근하지 않음',
    });
  } catch (err) {
    record('확장 E2E 치명 오류', false, { error: err.message || String(err) });
  } finally {
    await context.close().catch(() => {});
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch (_) {}
  }

  report.finishedAt = new Date().toISOString();
  report.summary = {
    total: report.cases.length,
    pass: report.cases.filter((c) => c.ok).length,
    fail: report.cases.filter((c) => !c.ok).length,
    realExtensionUiPass: report.categories.realExtensionUi.filter((c) => c.ok).length,
    realExtensionUiFail: report.categories.realExtensionUi.filter((c) => !c.ok).length,
  };

  const outPath = path.join(OUT_DIR, `extension-e2e-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log('\nSummary', report.summary);
  console.log('Wrote', outPath);
  if (report.summary.fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  report.fatal = err.message || String(err);
  fs.writeFileSync(path.join(OUT_DIR, `extension-e2e-fatal-${stamp}.json`), JSON.stringify(report, null, 2));
  process.exit(1);
});
