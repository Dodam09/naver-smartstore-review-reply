/**
 * 네이버 판매자센터 접근 가능 여부만 확인.
 * 로그인·수집·게시는 하지 않음. 성공으로 위장하지 않음.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'out');
const stamp = Date.now();
fs.mkdirSync(OUT_DIR, { recursive: true });

const REVIEW_URL = 'https://sell.smartstore.naver.com/#/review/search';
const report = {
  startedAt: new Date().toISOString(),
  tool: 'playwright chromium (no extension load for access probe)',
  goal: 'seller-center access check only — no login, no scrape, no post',
  cases: [],
};

function record(name, ok, detail = {}) {
  const row = { name, ok, ...detail };
  report.cases.push(row);
  console.log(`[${ok ? 'PASS' : 'FAIL/BLOCKED'}] ${name}`);
  if (detail.note) console.log('   ', detail.note);
  if (detail.error) console.log('   ', detail.error);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(REVIEW_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    const url = page.url();
    const title = await page.title();
    const needsLogin =
      /accounts\.commerce\.naver\.com|login/i.test(url) ||
      /로그인|네이버 커머스 ID/i.test(title) ||
      (await page.locator('button:has-text("로그인"), input[type="password"]').count()) > 0;

    record('판매자센터 리뷰 URL 탐색', true, { url, title });
    record('판매자 로그인 세션 존재', !needsLogin, {
      needsLogin,
      note: needsLogin
        ? '커머스 로그인 화면으로 리다이렉트됨 — 사용자 승인·계정 없이 실수집 불가'
        : '로그인된 세션으로 리뷰 관리 접근 가능',
    });

    if (needsLogin) {
      report.notRun = [
        {
          name: '리뷰 목록 실수집',
          reason: '판매자 로그인 세션 없음',
        },
        {
          name: '상품번호·별점·작성일 실데이터 추출',
          reason: '판매자 로그인 세션 없음',
        },
        {
          name: '확장 전달 및 AI 답글(실데이터)',
          reason: '판매자 로그인 세션 없음',
        },
        {
          name: '실답글 게시',
          reason: '정책상 금지(생성까지만 허용, 게시는 금지)',
        },
      ];
      record('실데이터 수집 E2E', false, {
        note: '접근 불가 — PASS로 처리하지 않음',
      });
    } else {
      record('실데이터 수집 E2E', false, {
        note: '세션은 있으나 이 스크립트는 수집을 수행하지 않음 — 별도 승인 후 수동/확장 E2E 필요',
      });
    }
  } catch (err) {
    record('판매자센터 접근 프로브', false, { error: err.message || String(err) });
  } finally {
    await browser.close().catch(() => {});
  }

  // 정적: 리뷰 productNo 추출 규칙 (임의 생성 금지)
  const pick = (item) => {
    const raw =
      item?.productNo ||
      item?.channelProductNo ||
      item?.productId ||
      item?.product?.productNo ||
      item?.product?.id ||
      item?.product?.channelProductNo ||
      '';
    return String(raw).replace(/[^\d]/g, '');
  };
  const staticCases = [
    {
      name: '정적: productNo 필드 있으면 숫자만 추출',
      ok: pick({ productNo: 'AB-8800111' }) === '8800111',
    },
    {
      name: '정적: productNo 없으면 빈 문자열(상품명으로 추정 금지)',
      ok: pick({ productName: '오메가3' }) === '',
    },
    {
      name: '정적: channelProductNo 대체 필드',
      ok: pick({ channelProductNo: '12345' }) === '12345',
    },
  ];
  for (const c of staticCases) {
    record(c.name, c.ok, { category: 'staticMapping' });
    report.cases[report.cases.length - 1].category = 'staticMapping';
  }

  report.finishedAt = new Date().toISOString();
  report.summary = {
    total: report.cases.length,
    pass: report.cases.filter((c) => c.ok).length,
    failOrBlocked: report.cases.filter((c) => !c.ok).length,
    sellerCenterAccessible: report.cases.some(
      (c) => c.name === '판매자 로그인 세션 존재' && c.ok
    ),
  };
  const outPath = path.join(OUT_DIR, `seller-center-access-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log('\nSummary', report.summary);
  console.log('Wrote', outPath);
  // 접근 불가면 exit 0 — 프로브 자체는 정상 완료. 실수집 PASS를 주장하지 않음.
  if (!report.summary.sellerCenterAccessible) process.exitCode = 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
