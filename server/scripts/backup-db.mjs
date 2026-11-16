/**
 * 일회성 SQLite 온라인 백업.
 *
 * better-sqlite3 backup()은 sqlite3_backup_* API를 사용한다.
 * app.db, app.db-wal, app.db-shm 을 복사·이동·삭제하지 않는다.
 *
 * 지금 운영 이미지에는 이 파일이 없다. ESM은 NODE_PATH를 보지 않으므로
 * /tmp 에 두더라도 /app/package.json 기준으로 better-sqlite3를 찾는다.
 *   cd /app
 *   BACKUP_CONFIRM=yes node /tmp/backup-db.mjs
 *
 * 이 가드가 없으면 아무 파일도 만들지 않고 종료한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

function loadBetterSqlite() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const anchors = [
    path.join(scriptDir, '..', 'package.json'),
    '/app/package.json',
  ];
  const errors = [];
  for (const anchor of anchors) {
    if (!fs.existsSync(anchor)) continue;
    try {
      const require = createRequire(anchor);
      const Database = require('better-sqlite3');
      if (typeof Database !== 'function') {
        throw new Error('export가 생성자가 아닙니다.');
      }
      return { Database, modulePath: require.resolve('better-sqlite3'), anchor };
    } catch (err) {
      errors.push(`${anchor}: ${err.message}`);
    }
  }
  const error = new Error(
    `better-sqlite3를 찾지 못했습니다. ESM은 NODE_PATH를 사용하지 않습니다. ${errors.join(' | ')}`
  );
  error.code = 'MODULE_NOT_FOUND';
  throw error;
}

const { Database, modulePath, anchor: moduleAnchor } = loadBetterSqlite();

const SOURCE_PATH = process.env.DB_PATH || path.join(process.env.DATA_DIR || '/data', 'app.db');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(path.dirname(SOURCE_PATH), 'backups');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function stamp() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value || '00';
  return `${get('year')}${get('month')}${get('day')}-${get('hour')}${get('minute')}${get('second')}`;
}

function assertSafePaths(sourcePath, backupDir) {
  const source = path.resolve(sourcePath);
  const dir = path.resolve(backupDir);
  const base = path.basename(source);
  if (base !== 'app.db') {
    fail(`원본 파일명이 app.db 가 아닙니다: ${base}`);
  }
  if (!fs.existsSync(source)) {
    fail(`원본 DB가 없습니다: ${source}`);
  }
  const stat = fs.statSync(source);
  if (!stat.isFile() || stat.size <= 0) {
    fail(`원본 DB가 빈 파일이거나 일반 파일이 아닙니다: ${source}`);
  }
  if (dir === source || dir.startsWith(`${source}${path.sep}`)) {
    fail('백업 디렉터리는 원본 파일 안에 둘 수 없습니다.');
  }
  if (path.dirname(source) === dir) {
    fail('백업 디렉터리는 원본과 같은 폴더가 아니라 /data/backups 여야 합니다.');
  }
}

function quoteIdent(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    fail(`테이블 이름이 예상 밖입니다: ${name}`);
  }
  return `"${name}"`;
}

if (process.env.BACKUP_CONFIRM !== 'yes') {
  fail('실행하지 않았습니다. 승인 후 BACKUP_CONFIRM=yes 를 붙여 한 번만 실행하세요.');
}

assertSafePaths(SOURCE_PATH, BACKUP_DIR);
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const destination = path.join(BACKUP_DIR, `app-${stamp()}.db`);
if (fs.existsSync(destination)) {
  fail(`같은 이름의 백업이 이미 있습니다: ${destination}`);
}

const protectedNames = new Set(['app.db', 'app.db-wal', 'app.db-shm']);
if (protectedNames.has(path.basename(destination))) {
  fail('백업 파일명이 원본 DB 파일과 겹칩니다.');
}

const source = new Database(SOURCE_PATH, { readonly: true, fileMustExist: true });
let backupError = null;
try {
  await source.backup(destination);
} catch (err) {
  backupError = err;
} finally {
  source.close();
}
if (backupError) {
  fs.rmSync(destination, { force: true });
  fail(`온라인 백업 실패: ${backupError.message || backupError}`);
}

const packed = new Database(destination);
try {
  packed.pragma('wal_checkpoint(TRUNCATE)');
  packed.pragma('journal_mode = DELETE');
} finally {
  packed.close();
}
for (const suffix of ['-wal', '-shm']) {
  const sidecar = path.resolve(`${destination}${suffix}`);
  const root = path.resolve(BACKUP_DIR);
  if (!sidecar.startsWith(`${root}${path.sep}`)) {
    fail(`백업 부가 파일 경로가 백업 폴더 밖입니다: ${sidecar}`);
  }
  fs.rmSync(sidecar, { force: true });
}

const backup = new Database(destination, { readonly: true, fileMustExist: true });
let reportError = null;
try {
  const integrityRows = backup.pragma('integrity_check');
  const integrity = integrityRows.map((row) => row.integrity_check);
  if (integrity.length !== 1 || integrity[0] !== 'ok') {
    fail(`integrity_check 실패: ${integrity.join(', ')}`);
  }

  const tables = backup
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`
    )
    .all();

  console.log(`source=${path.resolve(SOURCE_PATH)}`);
  console.log(`backup=${path.resolve(destination)}`);
  console.log(`module=${modulePath}`);
  console.log(`moduleAnchor=${moduleAnchor}`);
  console.log(`bytes=${fs.statSync(destination).size}`);
  console.log('integrity_check=ok');
  console.log('tables:');
  for (const table of tables) {
    const columns = backup.pragma(`table_info(${quoteIdent(table.name)})`);
    const structure = columns.map((column) => `${column.name}:${column.type || 'ANY'}`).join(', ');
    const count = backup.prepare(`SELECT COUNT(*) AS n FROM ${quoteIdent(table.name)}`).get().n;
    console.log(`- ${table.name} rows=${count} columns=${structure}`);
  }
} catch (err) {
  reportError = err;
} finally {
  backup.close();
}
if (reportError) fail(reportError.message || String(reportError));
