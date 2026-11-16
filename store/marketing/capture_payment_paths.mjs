/**
 * 토스 심사용 결제경로 화면 캡쳐 (puppeteer-core + 로컬 Chrome)
 * BILLING_PASSWORD 필요. ONETIME_PASSWORD 있으면 단건 계정으로도 캡쳐.
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire('C:/Users/rovem_re1cu58/AppData/Local/Temp/ss-shot/package.json');
const puppeteer = require('puppeteer-core');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'payment_path_shots');
const BASE = process.env.APP_BASE_URL || 'https://naver-smartstore-review-reply-production.up.railway.app';
const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profileDir = 'C:/Users/rovem_re1cu58/AppData/Local/Temp/toss-ppt-capture-profile';

const BILLING_EMAIL = process.env.BILLING_EMAIL || 'toss-review-billing@damdores.com';
const BILLING_PASSWORD = process.env.BILLING_PASSWORD || '';
const ONETIME_EMAIL = process.env.ONETIME_EMAIL || 'toss-review@damdores.com';
const ONETIME_PASSWORD = process.env.ONETIME_PASSWORD || '';

fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file });
  console.log('saved', name);
}

async function login(page, email, password) {
  await page.goto(`${BASE}/review-login.html`, { waitUntil: 'networkidle2' });
  await page.$eval('#email', (el, v) => { el.value = v; }, email);
  await page.$eval('#password', (el, v) => { el.value = v; }, password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 25000 }),
    page.click('#loginBtn'),
  ]);
  await sleep(1200);
}

async function ensureAgree(page) {
  await page.evaluate(() => {
    const box = document.getElementById('legalAgree');
    if (box && !box.checked) box.checked = true;
  });
}

async function scrollTo(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.scrollIntoView({ block: 'start' });
  }, selector);
  await sleep(400);
}

async function capturePublic(page) {
  await page.goto(`${BASE}/review-login.html`, { waitUntil: 'networkidle2' });
  await page.evaluate(() => { document.title = 'TOSS_PPT_CAPTURE_WINDOW'; });
  await shot(page, '01-login.png');

  await page.goto(`${BASE}/billing-terms.html`, { waitUntil: 'networkidle2' });
  await page.evaluate(() => { document.title = 'TOSS_PPT_CAPTURE_WINDOW'; });
  await shot(page, '02-billing-terms.png');
  await page.evaluate(() => {
    const headings = [...document.querySelectorAll('h2')];
    const refund = headings.find((el) => (el.textContent || '').includes('환불'));
    if (refund) refund.scrollIntoView({ block: 'start' });
  });
  await sleep(400);
  await shot(page, '02b-refund.png');

  await page.goto(`${BASE}/privacy.html`, { waitUntil: 'networkidle2' });
  await page.evaluate(() => { document.title = 'TOSS_PPT_CAPTURE_WINDOW'; });
  await shot(page, '03-privacy.png');

  await page.goto(`${BASE}/billing.html`, { waitUntil: 'networkidle2' });
  await sleep(1200);
  await page.evaluate(() => { document.title = 'TOSS_PPT_CAPTURE_WINDOW'; });
  await shot(page, '04-billing-page-top.png');

  await scrollTo(page, '#billingProductsSection');
  await shot(page, '05-billing-products.png');

  await scrollTo(page, '#onetimeProductsSection');
  await shot(page, '06-onetime-products.png');

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(400);
  await shot(page, '07-footer.png');
}

async function closePayOverlay(page) {
  // Toss iframe/modal close
  await page.evaluate(() => {
    const close =
      document.querySelector('[aria-label="닫기"]') ||
      document.querySelector('button.close') ||
      [...document.querySelectorAll('button, a')].find((el) => (el.textContent || '').trim() === '×' || (el.getAttribute('aria-label') || '').includes('Close'));
    if (close) close.click();
  }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(800);
}

async function capturePayClick(page, hostSel, outName, buttonIndex = 0) {
  await ensureAgree(page);
  await scrollTo(page, hostSel);
  const clicked = await page.evaluate((sel, idx) => {
    const buttons = [...document.querySelectorAll(`${sel} button[data-review-pay="1"]`)];
    const btn = buttons[idx];
    if (!btn || btn.disabled) return false;
    btn.scrollIntoView({ block: 'center' });
    btn.click();
    return true;
  }, hostSel, buttonIndex);
  if (!clicked) {
    console.warn('no pay button', hostSel, buttonIndex);
    return false;
  }
  await sleep(4000);
  await shot(page, outName);
  await closePayOverlay(page);
  const url = page.url();
  await page.goto(url, { waitUntil: 'networkidle2' });
  await sleep(1000);
  await ensureAgree(page);
  return true;
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: false,
    defaultViewport: { width: 1280, height: 800 },
    userDataDir: profileDir,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(25000);

  await capturePublic(page);

  if (BILLING_PASSWORD) {
    await login(page, BILLING_EMAIL, BILLING_PASSWORD);
    await page.evaluate(() => { document.title = 'TOSS_PPT_CAPTURE_WINDOW'; });
    await ensureAgree(page);
    await scrollTo(page, '#billingProductsSection');
    await shot(page, '08-billing-logged-in.png');

    const billingShots = [
      '09a-billing-9900.png',
      '09b-billing-19900.png',
      '09c-billing-39900.png',
    ];
    for (let i = 0; i < billingShots.length; i += 1) {
      await capturePayClick(page, '#billingProducts', billingShots[i], i);
    }

    await scrollTo(page, '#onetimeProductsSection');
    await shot(page, '10-onetime-logged-in.png');

    const onetimeShots = [
      '11a-onetime-9900.png',
      '11b-onetime-10000.png',
      '11c-onetime-30000.png',
      '11d-onetime-20000.png',
    ];
    for (let i = 0; i < onetimeShots.length; i += 1) {
      const ok = await capturePayClick(page, '#onetimeProducts', onetimeShots[i], i);
      if (!ok) {
        await page.reload({ waitUntil: 'networkidle2' });
        await sleep(1200);
        await ensureAgree(page);
        await capturePayClick(page, '#onetimeProducts', onetimeShots[i], i);
      }
    }
  } else {
    console.warn('skip pay windows: set BILLING_PASSWORD');
  }

  if (ONETIME_PASSWORD) {
    await page.goto('about:blank');
    await page.evaluate(() => sessionStorage.clear());
    await login(page, ONETIME_EMAIL, ONETIME_PASSWORD);
    await ensureAgree(page);
    await scrollTo(page, '#onetimeProductsSection');
    await shot(page, '12-onetime-account.png');
    await capturePayClick(page, '#onetimeProducts', '13-onetime-pay-window-basic.png');
  }

  await browser.close();
  console.log('done', OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
