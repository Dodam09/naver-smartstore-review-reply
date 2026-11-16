/**
 * 로컬 확장 E2E용 API 서버 기동.
 * 사용: node scripts/start-local-dev.mjs
 */
import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');
const dataDir =
  process.env.DATA_DIR ||
  path.join(os.tmpdir(), `ss-local-e2e-${new Date().toISOString().slice(0, 10)}`);
const dbPath = process.env.DB_PATH || path.join(dataDir, 'app.db');

fs.mkdirSync(dataDir, { recursive: true });

const env = {
  ...process.env,
  DATA_DIR: dataDir,
  DB_PATH: dbPath,
  PORT: process.env.PORT || '8787',
  ALLOW_REGISTRATION: process.env.ALLOW_REGISTRATION || 'true',
  BILLING_MOCK: process.env.BILLING_MOCK || 'true',
  RENEWAL_ENABLED: process.env.RENEWAL_ENABLED || 'false',
};

console.log('Local API starting');
console.log('  PORT=', env.PORT);
console.log('  DATA_DIR=', env.DATA_DIR);
console.log('  DB_PATH=', env.DB_PATH);
console.log('  ALLOW_REGISTRATION=', env.ALLOW_REGISTRATION);
console.log('  GEMINI_API_KEY=', env.GEMINI_API_KEY ? '(set)' : '(missing — set in server/.env)');

const child = spawn(process.execPath, ['index.js'], {
  cwd: serverRoot,
  env,
  stdio: 'inherit',
});

child.on('exit', (code) => process.exit(code ?? 1));
