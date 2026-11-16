/**
 * Reports whether Gemini-like keys exist — never prints secret values.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function analyzeText(text) {
  const m = text.match(/GEMINI_API_KEY\s*[:=]\s*['"]([^'"]*)['"]/);
  const envM = text.match(/^GEMINI_API_KEY=(.*)$/m);
  const val = (m ? m[1] : envM ? envM[1].trim() : '') || '';
  const placeholder =
    !val ||
    /YOUR_|CHANGE|HERE|xxx|test-key|placeholder|EXAMPLE/i.test(val) ||
    val.length < 20;
  const looksLikeLiveKey = /^AIza[0-9A-Za-z_-]{20,}$/.test(val) && !placeholder;
  return {
    hasField: !!(m || envM),
    isPlaceholder: placeholder,
    looksLikeLiveKey,
    valueLength: val.length,
  };
}

function inspect(rel) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) return { path: rel, exists: false };
  return { path: rel, exists: true, ...analyzeText(fs.readFileSync(p, 'utf8')) };
}

const files = [
  'config.js',
  'config.local.js',
  'config.example.js',
  'store/config.js',
  'beta/config.js',
  'server/.env',
  'server/.env.example',
];

const report = { files: files.map(inspect), gitTracked: {}, packageScans: [] };

try {
  const tracked = execSync('git ls-files config.js config.local.js store/config.js beta/config.js server/.env', {
    cwd: root,
    encoding: 'utf8',
  })
    .trim()
    .split(/\n/)
    .filter(Boolean);
  report.gitTracked.list = tracked;
  for (const f of tracked) {
    const blob = execSync(`git show HEAD:${f}`, { cwd: root, encoding: 'utf8' });
    report.gitTracked[f] = analyzeText(blob);
  }
} catch (e) {
  report.gitTracked.error = String(e.message || e).slice(0, 200);
}

for (const dir of ['store/dist', 'beta/dist']) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) continue;
  const hits = [];
  const walk = (d) => {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(js|json|html|env)$/i.test(name)) {
        const t = fs.readFileSync(p, 'utf8');
        if (/GEMINI_API_KEY/.test(t)) {
          const a = analyzeText(t);
          hits.push({ file: path.relative(root, p), ...a });
        }
        if (/config\.local/.test(t) && /LOCAL_API_OVERRIDE_ENABLED\s*=\s*true/.test(t)) {
          hits.push({ file: path.relative(root, p), localOverrideOn: true });
        }
      }
    }
  };
  walk(abs);
  report.packageScans.push({ dir, hits });
}

const out = path.join(root, 'e2e/out/secret-presence-3-11.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log('wrote', out);
