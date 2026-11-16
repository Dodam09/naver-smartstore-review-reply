/**
 * 합성 업종 시드로 리뷰 답글 일괄 생성·체크리스트 검증 (로컬 전용).
 *
 * 사용:
 *   node scripts/run-synthetic-review-batch.mjs
 *   node scripts/run-synthetic-review-batch.mjs --smoke
 *   node scripts/run-synthetic-review-batch.mjs --store=pet_probiotic --limit=3
 *   node scripts/run-synthetic-review-batch.mjs --out=./scripts/out/report.json
 *
 * 서버 .env 의 GEMINI_API_KEY 사용. commit/push/deploy 대상 아님.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(__dirname, '..');
process.chdir(serverDir);

const require = createRequire(path.join(serverDir, 'package.json'));
require('dotenv').config({ path: path.join(serverDir, '.env') });

const { appendReplyHardRules, buildReviewUserContent, scrubReplyPlaceholders } = await import(
  pathToFileURL(path.join(serverDir, 'prompts.js')).href
);
const { generateWithSystem } = await import(pathToFileURL(path.join(serverDir, 'gemini.js')).href);

function parseArgs(argv) {
  const out = { store: null, limit: null, smoke: false, outPath: null, help: false };
  for (const arg of argv) {
    if (arg === '--smoke') out.smoke = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg.startsWith('--store=')) out.store = arg.slice('--store='.length).trim() || null;
    else if (arg.startsWith('--limit=')) out.limit = Number(arg.slice('--limit='.length));
    else if (arg.startsWith('--out=')) out.outPath = arg.slice('--out='.length).trim() || null;
  }
  if (out.smoke && out.limit == null) out.limit = 2;
  return out;
}

const BAN_PATTERNS = [
  { key: '덕분에_효능패턴', re: /제품\s*덕분에|덕분에\s*(장|배변|피부|건강|개선)/ },
  { key: '개선', re: /개선/ },
  { key: '원활', re: /원활/ },
  { key: '특성상', re: /특성상/ },
  { key: '순면이라', re: /순면이라|순면\s*소재/ },
  { key: '고객센터', re: /고객센터/ },
  { key: '문의_남겨', re: /문의\s*남겨/ },
  { key: 'markdown_bold', re: /\*\*[^*]+\*\*/ },
  { key: 'markdown_code', re: /`[^`]+`/ },
  { key: 'quote_short', re: /['"‘’“”]\s*(좋아요|굿|재구매할게요)\s*['"‘’“”]/ },
];

function sellerIntroHits(text, banNames) {
  const t = String(text || '');
  const hits = [];
  const first = (t.split(/\n/)[0] || '').trim();
  const intro = first.match(/^안녕하세요\s*,?\s*(.+?)입니다/);
  if (intro && !/고객님/.test(intro[1])) hits.push(`intro:${intro[1].trim()}`);
  for (const name of banNames || []) {
    if (!name) continue;
    if (new RegExp(`${escapeRe(name)}\\s*입니다`).test(t)) hits.push(`seller:${name}`);
  }
  return hits;
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findBanHits(text) {
  return BAN_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.key);
}

function loadSeeds() {
  const seedPath = path.join(__dirname, 'synthetic-review-seeds.json');
  return JSON.parse(fs.readFileSync(seedPath, 'utf8'));
}

function selectJobs(seeds, { store, limit }) {
  let stores = seeds.stores;
  if (store) {
    stores = stores.filter((s) => s.id === store);
    if (!stores.length) {
      throw new Error(`Unknown store id: ${store}. Available: ${seeds.stores.map((s) => s.id).join(', ')}`);
    }
  }
  const jobs = [];
  for (const s of stores) {
    let reviews = s.reviews || [];
    if (limit != null && Number.isFinite(limit) && limit > 0) {
      reviews = reviews.slice(0, limit);
    }
    for (const r of reviews) {
      jobs.push({ store: s, review: r });
    }
  }
  return jobs;
}

async function runOne(job) {
  const { store, review } = job;
  const style = String(review.systemPromptOverride || store.systemPrompt || '').trim();
  const row = {
    product: review.product,
    content: review.content,
    rating: review.rating,
  };
  if (review.useStoreName && store.storeName) {
    row.storeName = store.storeName;
  }

  const system = appendReplyHardRules(style, row);
  const user = buildReviewUserContent(row);
  let text = '';
  let error = null;
  try {
    text = await generateWithSystem(system, user, { temperature: 0.35 });
    text = scrubReplyPlaceholders(String(text || '').trim());
  } catch (err) {
    error = err?.message || String(err);
  }

  const banHits = error ? [] : findBanHits(text);
  const sellerHits = error ? [] : sellerIntroHits(text, store.banSellerNames);
  const hits = error ? ['ERROR'] : [...banHits, ...sellerHits];

  // storeName 허용 케이스: 확인된 스토어명 인사는 허용
  const allowedStoreIntro =
    row.storeName &&
    new RegExp(`^안녕하세요\\s*,?\\s*${escapeRe(row.storeName)}입니다`).test((text.split(/\n/)[0] || '').trim());
  const filteredHits = hits.filter((h) => !(allowedStoreIntro && h === `intro:${row.storeName}`));

  return {
    storeId: store.id,
    storeLabel: store.label,
    reviewId: review.id,
    tag: review.tag,
    product: review.product,
    content: review.content,
    usedStoreName: row.storeName || null,
    pass: !error && filteredHits.length === 0,
    hits: filteredHits,
    error,
    firstLine: String(text || '').split('\n')[0] || '',
    text,
  };
}

function printHelp() {
  console.log(`Usage:
  node scripts/run-synthetic-review-batch.mjs [--smoke] [--store=ID] [--limit=N] [--out=PATH]

Stores: pet_probiotic | baby_fashion | electronics | kitchen`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY missing in server/.env');
  }

  const seeds = loadSeeds();
  const jobs = selectJobs(seeds, args);
  if (!jobs.length) throw new Error('No jobs selected');

  console.error(`Running ${jobs.length} synthetic review generations...`);
  const results = [];
  for (const job of jobs) {
    process.stderr.write(`- ${job.store.id}/${job.review.id} ... `);
    const result = await runOne(job);
    results.push(result);
    process.stderr.write(result.pass ? 'pass\n' : `FAIL [${result.hits.join(', ')}]\n`);
  }

  const summary = {
    total: results.length,
    pass: results.filter((r) => r.pass).length,
    fail: results.filter((r) => !r.pass).length,
    byStore: Object.fromEntries(
      [...new Set(results.map((r) => r.storeId))].map((id) => {
        const rows = results.filter((r) => r.storeId === id);
        return [id, { pass: rows.filter((r) => r.pass).length, fail: rows.filter((r) => !r.pass).length }];
      })
    ),
    byTag: Object.fromEntries(
      [...new Set(results.map((r) => r.tag))].map((tag) => {
        const rows = results.filter((r) => r.tag === tag);
        return [tag, { pass: rows.filter((r) => r.pass).length, fail: rows.filter((r) => !r.pass).length }];
      })
    ),
  };

  const report = {
    generatedAt: new Date().toISOString(),
    args,
    checklist: seeds.checklist,
    summary,
    results,
  };

  const outPath =
    args.outPath ||
    path.join(__dirname, 'out', `synthetic-review-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

  console.log(JSON.stringify({ summary, outPath }, null, 2));
  if (summary.fail > 0) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err?.stack || err);
  process.exitCode = 1;
});
