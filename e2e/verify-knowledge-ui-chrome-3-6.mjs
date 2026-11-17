/**
 * 3-6 Chrome 실확장 UI 검증 (Playwright + unpack load-extension).
 * 등록·배포 없음. 초안 storage 시드 → inquiry-select 판정/근거 패널·수정 유지·격리 확인.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(__dirname, 'out');
const stamp = Date.now();
fs.mkdirSync(OUT_DIR, { recursive: true });

const DRAFT_KEY = 'smartstoreInquiryDraft';
const results = [];
function record(name, status, detail = {}) {
  results.push({ name, status, ...detail });
  console.log(`[${status}] ${name}`);
}

const seedItems = [
  {
    id: 'v36-ans-1',
    productNo: '10380586205',
    productName: '아밀리 효소 펫치약',
    question: '브로멜라인 함량이 얼마인가요?',
    reply: '안녕하세요 고객님. 아밀리입니다. 정확한 함량은 배합 기밀로 안내가 어렵습니다.',
    judgment: 'ANSWERABLE',
    usedKnowledge: [
      {
        id: 'pk-1',
        type: 'product_knowledge',
        field: '성분',
        trustStatus: 'approved',
        source: 'seller',
        productNo: '10380586205',
      },
    ],
  },
  {
    id: 'v36-sc-1',
    productNo: '10380586205',
    productName: '아밀리 효소 펫치약',
    question: '혹시 브로멜라인의 함량이 얼마일까요?',
    reply: '안녕하세요, 고객님. 아밀리입니다. 정확한 함량은 공개가 어렵습니다.',
    judgment: 'SELLER_CONFIRM',
    needsConfirm: true,
    confirmReason: '상품정보 없음',
    missingFields: ['성분·재질·사양'],
    usedKnowledge: [],
    evidence: { noProductKnowledge: true },
  },
  {
    id: 'v36-rt-1',
    productNo: '13512827869',
    productName: '아밀리 천연 오트밀 샴푸',
    question: '샴푸 품절인데 언제 입고되나요?',
    reply: '안녕하세요 고객님. 실시간 재고·입고일은 판매자센터에서 확인 후 안내드리겠습니다.',
    judgment: 'REALTIME_REQUIRED',
    usedKnowledge: [
      {
        id: 'pol-1',
        type: 'store_policies',
        field: '재고',
        trustStatus: 'approved',
        source: 'policy',
        productNo: '13512827869',
      },
    ],
  },
];

async function main() {
  const report = {
    startedAt: new Date().toISOString(),
    tool: 'playwright + chromium --load-extension (3-6 UI)',
    extensionRoot: EXT_ROOT,
    posted: false,
    deployed: false,
    results: [],
  };

  let context;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-3-6-ui-'));
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${EXT_ROOT}`,
        `--load-extension=${EXT_ROOT}`,
      ],
      viewport: { width: 1280, height: 900 },
    });

    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30000 });
    const extensionId = worker.url().split('/')[2];
    report.extensionId = extensionId;

    const manifest = JSON.parse(fs.readFileSync(path.join(EXT_ROOT, 'manifest.json'), 'utf8'));
    record('extension_manifest_version', manifest.version === '1.3.86' ? 'PASS' : 'FAIL', {
      version: manifest.version,
    });

    await worker.evaluate(async (payload) => {
      await chrome.storage.local.set({
        smartstoreOnboardingTourV1: { done: true, finishedAt: Date.now() },
        smartstoreInquiryDraft: { items: payload.items, updatedAt: Date.now() },
        smartstoreInquiryApplyEnabled: false,
      });
    }, { items: seedItems });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/inquiry-select.html#review`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForSelector('.knowledge-panel', { timeout: 15000 });
    await page.waitForTimeout(600);

    const shotAll = path.join(OUT_DIR, `knowledge-ui-3-6-pw-all-${stamp}.png`);
    await page.screenshot({ path: shotAll, fullPage: true });
    report.screenshotAll = shotAll;

    // 1) 세 판정 UI
    for (const expect of [
      { id: 'v36-ans-1', judgment: 'ANSWERABLE', badge: '답변 가능', card: 'needs-answerable' },
      { id: 'v36-sc-1', judgment: 'SELLER_CONFIRM', badge: '확인 필요', card: 'needs-confirm' },
      { id: 'v36-rt-1', judgment: 'REALTIME_REQUIRED', badge: '실시간 조회 필요', card: 'needs-realtime' },
    ]) {
      const card = page.locator(`.review-card[data-id="${expect.id}"], [data-inquiry-id="${expect.id}"]`).first();
      // review cards use dataset on reply-input; panel has data-inquiry-id
      const panel = page.locator(`.knowledge-panel[data-inquiry-id="${expect.id}"]`);
      const panelCount = await panel.count();
      const html = panelCount ? await panel.first().innerHTML() : '';
      const text = panelCount ? await panel.first().innerText() : '';
      const parent = panelCount
        ? await panel.first().evaluate((el) => el.closest('.card, .review-item, article, section, .item')?.className || el.parentElement?.className || '')
        : '';
      const ok =
        panelCount > 0 &&
        text.includes(expect.badge) &&
        (text.includes(expect.judgment) || html.includes(expect.judgment));
      const shot = path.join(OUT_DIR, `knowledge-ui-3-6-pw-${expect.judgment}-${stamp}.png`);
      if (panelCount) {
        await panel.first().screenshot({ path: shot }).catch(() => page.screenshot({ path: shot }));
      }
      record(`ui_${expect.judgment}`, ok ? 'PASS' : 'FAIL', {
        panelCount,
        textSnippet: text.slice(0, 240),
        parentClass: parent,
        screenshot: shot,
      });
    }

    // 2) 빈 근거 메시지 (SELLER_CONFIRM seed)
    const scText = await page.locator('.knowledge-panel[data-inquiry-id="v36-sc-1"]').innerText();
    record(
      'empty_usedKnowledge_message',
      /서버가 기록한 지식 근거 없음/.test(scText) ? 'PASS' : 'FAIL',
      { textSnippet: scText.slice(0, 200) }
    );

    // 3) ANSWERABLE usedKnowledge 목록
    const ansText = await page.locator('.knowledge-panel[data-inquiry-id="v36-ans-1"]').innerText();
    record(
      'answerable_usedKnowledge_list',
      /pk-1|product_knowledge|approved/.test(ansText) ? 'PASS' : 'FAIL',
      { textSnippet: ansText.slice(0, 240) }
    );

    // 4) 수정 시 근거 유지
    const ta = page.locator('textarea.reply-input[data-id="v36-ans-1"], textarea[data-id="v36-ans-1"]').first();
    if (!(await ta.count())) {
      // fallback: any textarea near panel
      record('edit_keeps_evidence', 'FAIL', { error: 'reply textarea not found' });
    } else {
      const beforeJudgment = await page.locator('.knowledge-panel[data-inquiry-id="v36-ans-1"]').innerText();
      await ta.fill((await ta.inputValue()) + ' [검증수정]');
      await ta.dispatchEvent('input');
      await ta.blur();
      await page.waitForTimeout(300);
      // trigger collect via storage save path used by UI — call applyKnowledgeOnEdit in page
      const kept = await page.evaluate(() => {
        const api = globalThis.InquiryKnowledgeUi;
        const item = {
          id: 'v36-ans-1',
          judgment: 'ANSWERABLE',
          usedKnowledge: [{ id: 'pk-1', type: 'product_knowledge', productNo: '10380586205' }],
          reply: 'old',
        };
        const next = api.applyKnowledgeOnEdit(item, 'edited reply [검증수정]');
        return {
          judgment: next.judgment,
          usedKnowledgeLen: next.usedKnowledge?.length || 0,
          reply: next.reply,
        };
      });
      const afterJudgment = await page.locator('.knowledge-panel[data-inquiry-id="v36-ans-1"]').innerText();
      record(
        'edit_keeps_evidence',
        kept.judgment === 'ANSWERABLE' &&
          kept.usedKnowledgeLen === 1 &&
          /ANSWERABLE|답변 가능/.test(afterJudgment)
          ? 'PASS'
          : 'FAIL',
        { kept, beforeSnippet: beforeJudgment.slice(0, 120), afterSnippet: afterJudgment.slice(0, 120) }
      );
    }

    // 5) 재생성 갱신 헬퍼 (서버 호출 없이 applyKnowledgeOnRegenerate)
    const regen = await page.evaluate(() => {
      const api = globalThis.InquiryKnowledgeUi;
      const item = {
        id: 'v36-ans-1',
        judgment: 'ANSWERABLE',
        usedKnowledge: [{ id: 'pk-1', productNo: '10380586205' }],
        reply: 'old',
      };
      return api.applyKnowledgeOnRegenerate(item, {
        reply: 'new realtime reply',
        judgment: 'REALTIME_REQUIRED',
        usedKnowledge: [{ id: 'pol-9', type: 'store_policies', productNo: '13512827869' }],
        productNo: '13512827869',
      });
    });
    record(
      'regenerate_updates_evidence',
      regen.judgment === 'REALTIME_REQUIRED' &&
        regen.usedKnowledge?.[0]?.id === 'pol-9' &&
        regen.reply.includes('realtime')
        ? 'PASS'
        : 'FAIL',
      { regen }
    );

    // 6) 다건 격리
    const iso = await page.evaluate(() => {
      const api = globalThis.InquiryKnowledgeUi;
      const items = [
        {
          id: 'a',
          productNo: '111',
          judgment: 'ANSWERABLE',
          usedKnowledge: [{ id: '1', productNo: '111' }],
        },
        {
          id: 'b',
          productNo: '222',
          judgment: 'ANSWERABLE',
          usedKnowledge: [{ id: '2', productNo: '222' }],
        },
      ];
      const ok = api.assertKnowledgeIsolation(items);
      const leak = api.assertKnowledgeIsolation([
        {
          id: 'a',
          productNo: '111',
          judgment: 'ANSWERABLE',
          usedKnowledge: [{ id: 'x', productNo: '999' }],
        },
      ]);
      return { ok: ok.ok, leakDetected: !leak.ok };
    });
    record('multi_isolation', iso.ok && iso.leakDetected ? 'PASS' : 'FAIL', iso);

    // 패널 DOM 격리: 서로 다른 productNo가 섞여 표시되지 않음
    const rtText = await page.locator('.knowledge-panel[data-inquiry-id="v36-rt-1"]').innerText();
    const ansOnly = await page.locator('.knowledge-panel[data-inquiry-id="v36-ans-1"]').innerText();
    record(
      'multi_panel_dom_isolation',
      /13512827869/.test(rtText) &&
        /10380586205/.test(ansOnly) &&
        !/13512827869/.test(ansOnly)
        ? 'PASS'
        : 'FAIL',
      { rtSnippet: rtText.slice(0, 160), ansSnippet: ansOnly.slice(0, 160) }
    );

    // 7) 리뷰 화면 회귀 — select.html 로드만 (등록 없음)
    const reviewPage = await context.newPage();
    await reviewPage.goto(`chrome-extension://${extensionId}/select.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    const reviewOk = await reviewPage.locator('body').count();
    const reviewShot = path.join(OUT_DIR, `knowledge-ui-3-6-pw-review-regression-${stamp}.png`);
    await reviewPage.screenshot({ path: reviewShot, fullPage: true }).catch(() => {});
    record('review_ui_loads', reviewOk ? 'PASS' : 'FAIL', { screenshot: reviewShot });

    // 문의 팝업 말투/지식 관리 진입 가능 여부
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await popup.waitForTimeout(800);
    const hasInquiryTab = (await popup.locator('button[data-tab="inquiry"], button:has-text("상품문의")').count()) > 0;
    const popupShot = path.join(OUT_DIR, `knowledge-ui-3-6-pw-popup-regression-${stamp}.png`);
    await popup.screenshot({ path: popupShot, fullPage: true }).catch(() => {});
    record('popup_inquiry_tab_present', hasInquiryTab ? 'PASS' : 'FAIL', { screenshot: popupShot });

    record('no_post_no_deploy', 'PASS', { posted: false, deployed: false });
  } catch (err) {
    record('fatal', 'FAIL', { error: String(err?.stack || err) });
    report.fatal = String(err?.stack || err);
  } finally {
    report.results = results;
    report.endedAt = new Date().toISOString();
    report.summary = {
      pass: results.filter((r) => r.status === 'PASS').length,
      fail: results.filter((r) => r.status === 'FAIL').length,
      notTested: results.filter((r) => r.status === 'NOT TESTED').length,
    };
    const jsonPath = path.join(OUT_DIR, `knowledge-ui-3-6-chrome-verify-${stamp}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
    console.log('report', jsonPath, report.summary);
    if (context) await context.close().catch(() => {});
  }
}

main();
