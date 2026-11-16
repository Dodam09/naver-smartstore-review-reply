import { createRequire } from 'module';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';

const require = createRequire('C:/Users/rovem_re1cu58/AppData/Local/Temp/ss-shot/package.json');
const puppeteer = require('puppeteer-core');

const root = 'C:/Users/rovem_re1cu58/naver-smartstore-review-reply';
const outDir = path.join(root, 'store/screenshots/webstore');
const rawDir = path.join(outDir, 'raw');
const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profileDir = 'C:/Users/rovem_re1cu58/AppData/Local/Temp/ss-shot-profile';

const prompt = `[말투·표현]
- 존댓말을 쓰되, 딱딱하지 않게 다정하게 답한다.
- 리뷰에 나온 상품과 상황을 구체적으로 언급한다.

[응대 원칙]
- 감사와 기쁨을 짧게 표현하고, 다음 구매로 자연스럽게 이어간다.`;

const reviews = [
  {
    id: '5065734172',
    content: '집에서 간단하게 목욕시킬때 쓰기 좋아요 향도 좋고 편하게 사용가능 ㅎㅎ',
    product: '아밀리 천연 오트밀 샴푸 강아지 아토피 습진 발사탕 각질 보습 비건내 300ml, 1개',
    writer: 'tjdd*****',
    rating: '5',
    reviewType: '한달사용리뷰',
    reply:
      '첫 구매해 주셔서 정말 감사합니다! 믿고 선택해 주셔서 저희도 영광이에요. 만족하실 수 있도록 더 좋은 상품으로 보답하겠습니다 :)',
  },
  {
    id: '5065293299',
    content: '치아 냄새가 사라지고 무향이라 쓰기 좋아요',
    product: '아밀리 효소 바르는 펫치약 강아지 고양이 입냄새 시석 제거 60g, 1개',
    writer: 'bu****',
    rating: '5',
    reviewType: '일반리뷰',
    reply:
      '사용감이 만족스러우셨다니 정말 다행이에요! 편안한 하루에 도움이 되었다니 저희도 기쁩니다. 좋은 후기 남겨주셔서 감사합니다 :)',
  },
  {
    id: '5065246032',
    content: '많이 안써봐서 잘 모르지만 치석이 조금씩 사라지는 것 같아서 순하다니까 믿고 써요',
    product: '아밀리 바디케어 SET (효소 펫치약 +천연 오트밀 샴푸)',
    writer: 'jeon*****',
    rating: '5',
    reviewType: '일반리뷰',
    reply:
      '빠른 배송에 만족해 주셔서 감사합니다! 앞으로도 꼼꼼하고 빠른 배송으로 보답하겠습니다. 항상 믿고 찾아주셔서 감사해요 :)',
  },
  {
    id: '5065112088',
    content: '아이가 목욕을 덜 싫어해요. 거품도 부드럽고 헹굼이 빨라서 편합니다.',
    product: '아밀리 천연 오트밀 샴푸 강아지 아토피 습진 발사탕 각질 보습 비건내 300ml, 1개',
    writer: 'mink*****',
    rating: '5',
    reviewType: '한달사용리뷰',
    reply: '',
  },
  {
    id: '5064983310',
    content: '재구매입니다. 저번에 쓰던 치약보다 순하고 입냄새도 덜해요.',
    product: '아밀리 효소 바르는 펫치약 강아지 고양이 입냄새 시석 제거 60g, 1개',
    writer: 'ha****',
    rating: '4',
    reviewType: '일반리뷰',
    reply: '',
  },
];

const usage = {
  period: '2026-10',
  periodLabel: '2026-10',
  planId: 'basic',
  planName: '베이직',
  replyUsed: 9,
  replyLimit: 150,
  replyRemaining: 141,
  toneUsed: 1,
  toneLimit: 50,
  toneRemaining: 49,
  trial: false,
  locked: false,
};

const subscription = {
  active: true,
  status: 'active',
  planId: 'basic',
  planName: '베이직',
  cancelled: false,
  autoRenew: false,
  expiresAt: '2026-11-07',
};

const meBody = {
  ok: true,
  mode: 'user',
  user: {
    email: 'seller@example.com',
    displayName: '꿈꾸는 돌맹이',
    authProvider: 'email',
    planId: 'basic',
    plan: { name: '베이직' },
    subscription,
  },
  usage,
  subscription,
};

const seed = {
  smartstoreOnboardingTourV1: { done: true, finishedAt: Date.now() },
  smartstoreAuthSession: {
    token: 'screenshot-demo',
    email: 'seller@example.com',
    displayName: '꿈꾸는 돌맹이',
    authProvider: 'email',
    planId: 'basic',
    planName: '베이직',
    savedAt: Date.now(),
    usage,
    subscription,
  },
  smartstoreReviewSettings: {
    tonePresetId: 'learned',
    systemPrompt: prompt,
    styleActiveMode: 'learned',
    sampleFlow: { analyzedCount: 2, source: 'seller-pick' },
    customPresets: [{ id: 'learned', name: '내 스타일', prompt }],
    reviewLookupDays: 7,
    inquiryLookupDays: 7,
    inquiryTonePresetId: 'learned',
    inquirySystemPrompt: prompt,
    inquiryStyleActiveMode: 'learned',
    inquirySampleFlow: { analyzedCount: 2, source: 'seller-pick' },
    inquiryCustomPresets: [{ id: 'learned', name: '내 스타일', prompt }],
  },
  smartstoreReviewParseCache: {
    parsedRows: reviews.map(({ reply, ...row }) => row),
    selectedIds: ['5065734172', '5065293299', '5065246032'],
    fileName: '판매자센터 (1주일)',
    lookupDays: 7,
    skippedReplied: 0,
  },
  smartstoreReviewDraft: {
    items: reviews.slice(0, 3).map((row) => ({
      id: row.id,
      reviewContent: row.content,
      product: row.product,
      writer: row.writer,
      rating: row.rating,
      reviewType: row.reviewType,
      reply: row.reply,
    })),
    submittedIds: ['5065734172'],
  },
  smartstoreInquiryParseCache: {
    inquiryRows: [
      {
        id: 'q-20441',
        product: '아밀리 천연 오트밀 샴푸',
        content: '강아지 피부 트러블에도 써도 될까요? 향이 강한지 궁금합니다.',
        writer: 'soo*****',
      },
      {
        id: 'q-20418',
        product: '아밀리 효소 바르는 펫치약',
        content: '고양이한테도 발라도 괜찮은 제품인가요?',
        writer: 'nari****',
      },
    ],
    fileName: '판매자센터 (1주일)',
    lookupDays: 7,
  },
};

function attachMocks(page) {
  page.on('request', (req) => {
    const url = req.url();
    const json = (body) =>
      req.respond({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify(body),
      });
    if (url.includes('/api/auth/me')) {
      json(meBody);
      return;
    }
    if (url.includes('/api/billing/history')) {
      json({
        ok: true,
        history: [
          {
            kind: 'subscribe',
            kindLabel: '구독',
            planId: 'basic',
            planName: '베이직',
            paidAt: '2026-10-07',
            amount: 9900,
            status: 'paid',
          },
        ],
      });
      return;
    }
    if (url.includes('/api/billing/config')) {
      json({ ok: true, productionReady: false, mockMode: false, liveMode: false });
      return;
    }
    if (url.includes('/health')) {
      json({ ok: true, kakaoLoginEnabled: true, version: '1.3.75' });
      return;
    }
    if (
      url.includes('railway.app') ||
      url.includes('googleapis.com') ||
      url.includes('google-analytics') ||
      url.includes('kakao.com')
    ) {
      req.abort().catch(() => {});
      return;
    }
    req.continue().catch(() => {});
  });
}

async function prepare(page) {
  await page.setRequestInterception(true);
  attachMocks(page);
}

async function shot(page, file, clip) {
  const target = path.join(rawDir, file);
  await page.screenshot({ path: target, clip });
  return target;
}

async function waitForExtensionId(browser) {
  const start = Date.now();
  while (Date.now() - start < 20000) {
    const target = browser
      .targets()
      .find((item) => item.type() === 'service_worker' && item.url().startsWith('chrome-extension://'));
    if (target) return new URL(target.url()).host;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const urls = browser.targets().map((item) => `${item.type()} ${item.url()}`);
  throw new Error(`extension id not found\n${urls.join('\n')}`);
}

async function openExt(browser, extId, file, viewport) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await prepare(page);
  await page.goto(`chrome-extension://${extId}/${file}`, { waitUntil: 'domcontentloaded' });
  return page;
}

const frames = [
  {
    file: '01-sidepanel-1280x800.png',
    raw: 'sidepanel.png',
    title: '사이드 패널에서<br>리뷰 답글을 시작',
    sub: '말투를 정하고, 가져온 리뷰로 바로 답글을 만듭니다.',
    wide: false,
  },
  {
    file: '02-work-select-1280x800.png',
    raw: 'work-select.png',
    title: '리뷰는 왼쪽, 진행 상황은 오른쪽',
    sub: '사용량 게이지와 미답변·답변 완료가 한 화면에 있습니다.',
    wide: true,
  },
  {
    file: '03-work-review-1280x800.png',
    raw: 'work-review.png',
    title: '확인 후 답변란에 자동 채우기',
    sub: '리뷰마다 다른 답글을 읽고, 한 번에 판매자센터에 올립니다.',
    wide: true,
  },
  {
    file: '04-account-1280x800.png',
    raw: 'account.png',
    title: '계정에서 사용량을<br>게이지로 확인',
    sub: '답글과 말투 분석 남은 양을 숫자 문장 없이 봅니다.',
    wide: false,
  },
  {
    file: '05-inquiry-1280x800.png',
    raw: 'inquiry.png',
    title: '상품문의도<br>같은 흐름으로',
    sub: '문의 가져오기부터 답글 만들기까지 리뷰와 같습니다.',
    wide: false,
  },
];

function frameHtml(item) {
  const img = pathToFileURL(path.join(rawDir, item.raw)).href;
  if (item.wide) {
    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <style>
    html, body { margin: 0; width: 1280px; height: 800px; overflow: hidden; }
    body {
      display: flex;
      flex-direction: column;
      background: #0f172a;
      color: #fff;
      font-family: "Malgun Gothic", "Segoe UI", sans-serif;
    }
    .copy { padding: 22px 36px 0; }
    h1, p { word-break: keep-all; line-break: strict; }
    h1 { margin: 0; font-size: 30px; line-height: 1.3; letter-spacing: -0.03em; }
    p { margin: 6px 0 0; color: #cbd5e1; font-size: 16px; }
    .stage {
      flex: 1;
      min-height: 0;
      margin: 14px 28px 18px;
      background: #eef1f5;
      border-radius: 16px;
      overflow: hidden;
      display: flex;
    }
    img { width: 100%; height: 100%; object-fit: contain; object-position: center top; background: #fff; }
  </style>
</head>
<body>
  <div class="copy">
    <h1>${item.title}</h1>
    <p>${item.sub}</p>
  </div>
  <div class="stage"><img src="${img}" /></div>
</body>
</html>`;
  }
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <style>
    html, body { margin: 0; width: 1280px; height: 800px; overflow: hidden; }
    body {
      display: flex;
      background: #0f172a;
      color: #fff;
      font-family: "Malgun Gothic", "Segoe UI", sans-serif;
    }
    .copy { width: 440px; padding: 72px 28px 48px 48px; box-sizing: border-box; }
    h1, p, .mark { word-break: keep-all; line-break: strict; }
    h1 { margin: 0 0 16px; font-size: 36px; line-height: 1.35; letter-spacing: -0.03em; }
    p { margin: 0; color: #cbd5e1; font-size: 18px; line-height: 1.55; }
    .mark { margin-top: 28px; color: #03c75a; font-weight: 700; font-size: 16px; }
    .stage {
      flex: 1;
      min-width: 0;
      margin: 36px 36px 36px 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #eef1f5;
      border-radius: 24px;
      overflow: hidden;
      padding: 28px;
      box-sizing: border-box;
    }
    img { height: 100%; width: auto; max-width: 100%; border-radius: 16px; box-shadow: 0 18px 50px rgba(0,0,0,.35); background: #fff; }
  </style>
</head>
<body>
  <div class="copy">
    <h1>${item.title}</h1>
    <p>${item.sub}</p>
    <div class="mark">스마트스토어 AI 자동답글</div>
  </div>
  <div class="stage"><img src="${img}" /></div>
</body>
</html>`;
}

async function composeFrames() {
  const framePage = await puppeteer.launch({
    executablePath: chromePath,
    headless: false,
    pipe: true,
    args: ['--no-first-run', '--window-size=1280,800'],
    defaultViewport: null,
  });
  try {
    const page = await framePage.newPage();
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    for (const item of frames) {
      const htmlPath = path.join(rawDir, `${item.file}.html`);
      await writeFile(htmlPath, frameHtml(item), 'utf8');
      await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle0' });
      await new Promise((resolve) => setTimeout(resolve, 250));
      const finalPath = path.join(outDir, item.file);
      const tempPath = path.join(rawDir, `frame-${item.file}`);
      await page.screenshot({ path: tempPath });
      const bytes = await readFile(tempPath);
      try {
        await writeFile(finalPath, bytes);
      } catch {
        const fallback = path.join(outDir, item.file.replace('.png', '-fixed.png'));
        await writeFile(fallback, bytes);
        console.log('locked, wrote', fallback);
        continue;
      }
      console.log('wrote', item.file);
    }
  } finally {
    await framePage.close();
  }
}

async function main() {
  if (process.env.COMPOSE_ONLY === '1') {
    await mkdir(rawDir, { recursive: true });
    await composeFrames();
    return;
  }
  await mkdir(rawDir, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: false,
    userDataDir: profileDir,
    pipe: true,
    enableExtensions: [root],
    args: [
      '--no-first-run',
      '--disable-default-apps',
      '--hide-crash-restore-bubble',
      '--window-position=40,40',
      '--window-size=1400,900',
    ],
    defaultViewport: null,
  });

  try {
    const extId = await waitForExtensionId(browser);
    console.log('extension', extId);

    const boot = await browser.newPage();
    await boot.setViewport({ width: 420, height: 800 });
    await prepare(boot);
    await boot.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: 'domcontentloaded' });
    await boot.evaluate((data) => chrome.storage.local.set(data), seed);
    await boot.close();

    const work = await openExt(browser, extId, 'select.html', { width: 1280, height: 800 });
    await work.waitForSelector('.usage-meter', { timeout: 15000 });
    await work.waitForSelector('.badge.unanswered', { timeout: 15000 });
    await new Promise((resolve) => setTimeout(resolve, 600));
    await shot(work, 'work-select.png');

    await work.click('#tabReview');
    await work.waitForSelector('.reply-input', { timeout: 15000 });
    await work.waitForSelector('.badge.done', { timeout: 15000 });
    await new Promise((resolve) => setTimeout(resolve, 800));
    await shot(work, 'work-review.png');
    await work.close();

    const popup = await openExt(browser, extId, 'popup.html', { width: 400, height: 820 });
    await popup.waitForSelector('#reviewActiveStylePrompt', { timeout: 15000 });
    await new Promise((resolve) => setTimeout(resolve, 900));
    await shot(popup, 'sidepanel.png');

    await popup.click('#reviewModeStyle');
    await new Promise((resolve) => setTimeout(resolve, 400));
    await shot(popup, 'style.png');

    await popup.click('[data-tab="settings"]');
    await popup.waitForSelector('#accountSummary .usage-meter', { timeout: 15000 });
    await new Promise((resolve) => setTimeout(resolve, 500));
    await shot(popup, 'account.png');

    await popup.click('[data-tab="inquiry"]');
    await popup.waitForSelector('#inquirySummary.visible, #inquirySelectBtn', { timeout: 15000 });
    await new Promise((resolve) => setTimeout(resolve, 500));
    await shot(popup, 'inquiry.png');
    await popup.close();

    const framePage = await browser.newPage();
    await framePage.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    for (const item of frames) {
      const htmlPath = path.join(rawDir, `${item.file}.html`);
      await writeFile(htmlPath, frameHtml(item), 'utf8');
      await framePage.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle0' });
      await new Promise((resolve) => setTimeout(resolve, 250));
      await framePage.screenshot({ path: path.join(outDir, item.file) });
      console.log('wrote', item.file);
    }
    await framePage.close();
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
