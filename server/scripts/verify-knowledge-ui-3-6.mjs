/**
 * 3-6 업무 UI 지식 근거 — 단위/격리 검증 하네스 (배포·등록 없음)
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ui = require(path.join(root, 'lib', 'inquiry-knowledge-ui.js'));

const results = [];
function record(name, status, detail = {}) {
  results.push({ name, status, detail });
  console.log(`[${status}] ${name}`, detail?.note || '');
}

const cases = [
  {
    name: 'ui_ANSWERABLE',
    item: {
      id: '1001',
      productNo: '11417353082',
      reply: '하루 1포',
      judgment: 'ANSWERABLE',
      usedKnowledge: [
        {
          type: 'product',
          id: 'product:11417353082:usage',
          field: 'usage',
          trustStatus: 'approved',
          productNo: '11417353082',
        },
      ],
    },
    expect: (m) => m.primary === 'answerable' && m.hasUsedKnowledge,
  },
  {
    name: 'ui_SELLER_CONFIRM',
    item: {
      id: '1002',
      reply: '확인 후 안내',
      judgment: 'SELLER_CONFIRM',
      needsConfirm: true,
      confirmReason: '함량 확인 필요',
    },
    expect: (m) => m.primary === 'seller_confirm',
  },
  {
    name: 'ui_REALTIME_REQUIRED',
    item: {
      id: '1003',
      reply: '재고 확인 후 안내',
      judgment: 'REALTIME_REQUIRED',
      needsConfirm: true,
      confirmReason: '실시간 재고',
    },
    expect: (m) => m.primary === 'realtime',
  },
  {
    name: 'ui_NO_PRODUCT',
    item: {
      id: '1004',
      reply: '확인 후 안내',
      judgment: 'SELLER_CONFIRM',
      confirmReason: '상품번호에 해당하는 등록 상품정보가 없습니다.',
      evidence: { productMatchStatus: 'seller_confirm' },
    },
    expect: (m) => m.noProductKnowledge === true && m.primary === 'seller_confirm',
  },
  {
    name: 'ui_KNOWLEDGE_REVIEW',
    item: {
      id: '1005',
      reply: '확인 후 안내',
      judgment: 'SELLER_CONFIRM',
      evidence: { faqConflict: true },
      usedKnowledge: [{ type: 'faq', id: '1', trustStatus: 'pending' }],
    },
    expect: (m) => m.knowledgeNeedsReview === true,
  },
];

for (const c of cases) {
  const model = ui.buildKnowledgePanelModel(c.item);
  record(c.name, c.expect(model) ? 'PASS' : 'FAIL', {
    primary: model.primary,
    judgment: model.judgment,
    badges: model.secondaryBadges?.map((b) => b.label),
  });
}

const edited = ui.applyKnowledgeOnEdit(
  {
    id: 'e1',
    judgment: 'ANSWERABLE',
    usedKnowledge: [{ type: 'product', id: 'p', productNo: '1' }],
    reply: 'a',
  },
  'edited'
);
record(
  'edit_keeps_knowledge',
  edited.judgment === 'ANSWERABLE' && edited.usedKnowledge?.length === 1 ? 'PASS' : 'FAIL',
  { judgment: edited.judgment }
);

const regen = ui.applyKnowledgeOnRegenerate(
  { id: 'r1', judgment: 'SELLER_CONFIRM', usedKnowledge: [], reply: 'old' },
  {
    text: 'new',
    judgment: 'REALTIME_REQUIRED',
    needsConfirm: true,
    usedKnowledge: [{ type: 'official', id: 'o' }],
  }
);
record(
  'regen_updates_knowledge',
  regen.judgment === 'REALTIME_REQUIRED' && regen.usedKnowledge?.length === 1 ? 'PASS' : 'FAIL',
  { judgment: regen.judgment }
);

const iso = ui.assertKnowledgeIsolation([
  { id: 'a', productNo: '111', usedKnowledge: [{ productNo: '111' }] },
  { id: 'b', productNo: '222', usedKnowledge: [{ productNo: '222' }] },
]);
record('multi_isolation_ok', iso.ok ? 'PASS' : 'FAIL', iso);

const leak = ui.assertKnowledgeIsolation([
  { id: 'a', productNo: '111', usedKnowledge: [{ productNo: '999' }] },
]);
record('multi_isolation_detects_leak', !leak.ok ? 'PASS' : 'FAIL', leak);

const empty = ui.buildKnowledgePanelModel({ id: 'z', judgment: 'ANSWERABLE', usedKnowledge: [] });
record('no_fabricated_usedKnowledge', !empty.hasUsedKnowledge ? 'PASS' : 'FAIL');

const outDir = path.join(root, 'e2e', 'out');
fs.mkdirSync(outDir, { recursive: true });
const ts = Date.now();
const summary = {
  at: new Date().toISOString(),
  stage: '3-6',
  results,
  pass: results.filter((r) => r.status === 'PASS').length,
  fail: results.filter((r) => r.status === 'FAIL').length,
  deploy: false,
  posted: false,
};
fs.writeFileSync(path.join(outDir, `knowledge-ui-3-6-${ts}.json`), JSON.stringify(summary, null, 2));
const md = [
  '# 3-6 지식 근거 UI 검증',
  '',
  `- PASS ${summary.pass} / FAIL ${summary.fail}`,
  `- 배포: 없음 · 등록: 없음`,
  '',
  ...results.map((r) => `- **${r.status}** ${r.name}`),
  '',
].join('\n');
fs.writeFileSync(path.join(outDir, `knowledge-ui-3-6-report.md`), md);
console.log(JSON.stringify({ pass: summary.pass, fail: summary.fail, out: `knowledge-ui-3-6-${ts}.json` }));
process.exit(summary.fail ? 1 : 0);
