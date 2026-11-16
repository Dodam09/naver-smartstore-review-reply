/**
 * Gemini 키 로테이션 준비 체크리스트 (실제 발급/폐기/Secret 변경은 하지 않음).
 * 키 값은 절대 출력하지 않습니다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function analyze(rel) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) return { path: rel, exists: false };
  const text = fs.readFileSync(p, 'utf8');
  const m = text.match(/GEMINI_API_KEY\s*[:=]\s*['"]([^'"]*)['"]/);
  const envM = text.match(/^GEMINI_API_KEY=(.*)$/m);
  const val = (m ? m[1] : envM ? envM[1].trim() : '') || '';
  const hasField = !!(m || envM || /GEMINI_API_KEY/.test(text));
  const placeholder =
    !val ||
    /YOUR_|CHANGE|HERE|xxx|test-key|placeholder|EXAMPLE/i.test(val) ||
    val.length < 20;
  const looksLikeLiveKey = /^AIza[0-9A-Za-z_-]{20,}$/.test(val) && !placeholder;
  return {
    path: rel,
    exists: true,
    hasField,
    isPlaceholder: placeholder,
    looksLikeLiveKey,
    valueLength: val ? val.length : 0,
  };
}

const checks = {
  extensionConfig: analyze('config.js'),
  extensionExample: analyze('config.example.js'),
  storeConfig: analyze('store/config.js'),
  betaConfig: analyze('beta/config.js'),
  serverEnv: analyze('server/.env'),
  serverEnvExample: analyze('server/.env.example'),
  gitignore: {
    configJs: fs.readFileSync(path.join(root, '.gitignore'), 'utf8').includes('config.js'),
    serverEnv: fs.readFileSync(path.join(root, '.gitignore'), 'utf8').includes('server/.env'),
  },
  gitTracked: [],
  ceoSteps: [
    '1. Google AI Studio에서 신규 Gemini 키 발급',
    '2. 승인된 서버 Secret(GEMINI_API_KEY)에 신규 키 등록 (Railway Variables 등)',
    '3. 서버 재시작',
    '4. /health 에서 geminiConfigured=true 확인 (키 값 미표시)',
    '5. 리뷰/문의 답글 생성으로 실제 Gemini 호출 확인',
    '6. 신규 키만 쓰는지 확인 후 기존 키 폐기',
    '7. 로컬 server/.env 평문 키를 신규로 교체하거나 제거(로컬은 .env만)',
    '8. 확장 config.js에 키가 없는지 재확인 후 회귀 테스트',
  ],
  doNotDoNow: [
    '신규 키 임의 발급',
    '기존 키 임의 폐기',
    'Railway Secret 변경',
    '배포 / CWS 업로드',
  ],
};

try {
  checks.gitTracked = execSync('git ls-files config.js server/.env store/config.js beta/config.js', {
    cwd: root,
    encoding: 'utf8',
  })
    .trim()
    .split(/\n/)
    .filter(Boolean);
} catch (_) {
  checks.gitTracked = [];
}

const out = path.join(root, 'e2e/out/gemini-rotation-checklist-3-12.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(checks, null, 2));
console.log(JSON.stringify(checks, null, 2));
console.log('wrote', out);
