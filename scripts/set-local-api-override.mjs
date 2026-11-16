/**
 * config.local.js 의 LOCAL_API_OVERRIDE_ENABLED 를 켜거나 끕니다.
 * 사용:
 *   node scripts/set-local-api-override.mjs on
 *   node scripts/set-local-api-override.mjs off
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const target = path.join(root, 'config.local.js');
const mode = String(process.argv[2] || '').toLowerCase();
const enable = mode === 'on' || mode === 'true' || mode === '1';
const disable = mode === 'off' || mode === 'false' || mode === '0';

if (!enable && !disable) {
  console.error('Usage: node scripts/set-local-api-override.mjs on|off');
  process.exit(1);
}

let src = fs.readFileSync(target, 'utf8');
if (!/LOCAL_API_OVERRIDE_ENABLED\s*=/.test(src)) {
  console.error('config.local.js 에서 LOCAL_API_OVERRIDE_ENABLED 를 찾지 못했습니다.');
  process.exit(1);
}
src = src.replace(
  /LOCAL_API_OVERRIDE_ENABLED\s*=\s*(true|false)/,
  `LOCAL_API_OVERRIDE_ENABLED = ${enable}`
);
fs.writeFileSync(target, src, 'utf8');
console.log(`config.local.js LOCAL_API_OVERRIDE_ENABLED = ${enable}`);
console.log('Chrome 확장 프로그램 카드에서 "새로고침"을 누르세요.');
