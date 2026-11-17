/**
 * Validates store (or beta) extension package — never prints secret values.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dirIdx = args.indexOf('--dir');
const packDir = path.resolve(
  dirIdx >= 0 && args[dirIdx + 1] ? args[dirIdx + 1] : path.join(root, 'store/dist/naver-smartstore-reply-store')
);
const expectVersion = (() => {
  const i = args.indexOf('--expect-version');
  return i >= 0 && args[i + 1] ? args[i + 1] : '1.3.86';
})();

const report = {
  packDir: path.relative(root, packDir),
  ok: true,
  errors: [],
  warnings: [],
  checks: {},
};

function fail(msg) {
  report.ok = false;
  report.errors.push(msg);
}

function warn(msg) {
  report.warnings.push(msg);
}

if (!fs.existsSync(packDir)) {
  fail(`package dir missing: ${packDir}`);
} else {
  const manifestPath = path.join(packDir, 'manifest.json');
  const configPath = path.join(packDir, 'config.js');
  const localPath = path.join(packDir, 'config.local.js');

  if (!fs.existsSync(manifestPath)) fail('manifest.json missing');
  else {
    const man = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    report.checks.version = man.version;
    if (man.version !== expectVersion) {
      fail(`version ${man.version} != expected ${expectVersion}`);
    }
    const hosts = man.host_permissions || [];
    report.checks.host_permissions = hosts;
    if (hosts.some((h) => /generativelanguage\.googleapis\.com/i.test(h))) {
      fail('store package must not include generativelanguage host permission');
    }
    if (hosts.some((h) => /127\.0\.0\.1|localhost/i.test(h))) {
      fail('store package must not include localhost host permission');
    }
    const csJs = (man.content_scripts || []).flatMap((c) => c.js || []);
    report.checks.content_scripts = csJs;
    // content_scripts may omit config.local; SW still needs the stub file
  }

  if (!fs.existsSync(configPath)) fail('config.js missing');
  else {
    const cfg = fs.readFileSync(configPath, 'utf8');
    const m = cfg.match(/GEMINI_API_KEY\s*[:=]\s*['"]([^'"]*)['"]/);
    const val = m ? m[1] : '';
    const live = /^AIza[0-9A-Za-z_-]{20,}$/.test(val);
    report.checks.configHasGeminiField = !!m;
    report.checks.configLooksLikeLiveKey = live;
    if (live) fail('config.js contains a live-looking GEMINI_API_KEY');
    if (/127\.0\.0\.1|localhost/i.test(cfg) && /API_BASE_URL/i.test(cfg)) {
      fail('config.js points API_BASE_URL at localhost');
    }
  }

  if (!fs.existsSync(localPath)) {
    fail('config.local.js stub missing (required for background importScripts)');
  } else {
    const local = fs.readFileSync(localPath, 'utf8');
    if (/LOCAL_API_OVERRIDE_ENABLED\s*=\s*true/.test(local)) {
      fail('config.local.js enables LOCAL_API_OVERRIDE');
    }
    if (/API_BASE_URL\s*=/.test(local) && /127\.0\.0\.1|localhost/.test(local)) {
      fail('config.local.js overrides API to localhost');
    }
    if (/GEMINI_API_KEY\s*[:=]\s*['"]AIza/.test(local)) {
      fail('config.local.js contains Gemini key');
    }
    report.checks.localOverrideDisabled = true;
  }

  const forbiddenNames = new Set(['e2e', 'server', 'node_modules', '.env', 'config.example.js']);
  const walkHits = [];
  const walk = (d) => {
    for (const name of fs.readdirSync(d)) {
      if (forbiddenNames.has(name)) {
        walkHits.push(path.relative(packDir, path.join(d, name)));
      }
      const p = path.join(d, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        if (name === 'node_modules' || name === 'e2e' || name === 'server') continue;
        walk(p);
      } else if (/\.(js|json|html|env|txt)$/i.test(name)) {
        const t = fs.readFileSync(p, 'utf8');
        if (/GEMINI_API_KEY\s*[:=]\s*['"]AIza[0-9A-Za-z_-]{20,}['"]/.test(t)) {
          fail(`live-looking GEMINI_API_KEY in ${path.relative(packDir, p)}`);
        }
        if (/^GEMINI_API_KEY=AIza/m.test(t)) {
          fail(`live-looking GEMINI_API_KEY env in ${path.relative(packDir, p)}`);
        }
      }
    }
  };
  walk(packDir);
  report.checks.forbiddenPathHits = walkHits;
  if (walkHits.length) fail(`forbidden paths in package: ${walkHits.join(', ')}`);

  // Source ↔ package sync (캐시/옛 dist 방지). store 전용 파일은 제외.
  const syncFiles = [
    'popup.html',
    'popup.js',
    'inquiry-style-pick.html',
    'inquiry-style-pick.js',
    'knowledge-manage.html',
    'knowledge-manage-page.js',
    'background.js',
    'lib/lookup-days.js',
    'lib/ai-proxy.js',
  ];
  const stale = [];
  for (const rel of syncFiles) {
    const src = path.join(root, rel);
    const dst = path.join(packDir, rel);
    if (!fs.existsSync(src)) continue;
    if (!fs.existsSync(dst)) {
      stale.push(`${rel} (missing in package)`);
      continue;
    }
    const a = fs.readFileSync(src);
    const b = fs.readFileSync(dst);
    if (!a.equals(b)) stale.push(rel);
  }
  report.checks.sourcePackageStale = stale;
  if (stale.length) {
    fail(`source↔package stale: ${stale.join(', ')} — run scripts/package-store.ps1`);
  }
}

const out = path.join(root, 'e2e/out/store-package-verify-3-11.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.ok) {
  console.error('STORE_PACKAGE_VERIFY_FAIL');
  process.exit(1);
}
console.log('STORE_PACKAGE_VERIFY_PASS');
