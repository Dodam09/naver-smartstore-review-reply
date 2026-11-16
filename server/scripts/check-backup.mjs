import { createRequire } from "node:module";

const require = createRequire("/app/package.json");
const Database = require("better-sqlite3");

const dbPath = "/data/backups/app-20261105-111006.db";

let db;

try {
  db = new Database(dbPath, {
    readonly: true,
    fileMustExist: true
  });

  const result = db.pragma("integrity_check");

  console.log(JSON.stringify({
    file: dbPath,
    integrity_check: result
  }, null, 2));

  if (
    result.length !== 1 ||
    result[0].integrity_check !== "ok"
  ) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error("검사 실패:", error.message);
  process.exitCode = 1;
} finally {
  if (db) db.close();
}
