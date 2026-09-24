import Database, {
  type Database as BetterSqliteDatabase,
} from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

export interface TestDbResult {
  sqlite: BetterSqliteDatabase;
  db: BetterSQLite3Database<typeof schema>;
}

/**
 * 모든 마이그레이션(FTS5 가상 테이블·트리거 포함)을 적용한 인메모리 SQLite를 만든다.
 *
 * 주의: better-sqlite3는 `PRAGMA foreign_keys`를 켜지 않으면 외래키를 강제하지 않는다.
 * D1은 강제한다. 외래키 동작은 worker 테스트(`src/worker`, workerd)에서 검증한다.
 */
export function createTestDb(): TestDbResult {
  const sqlite = new Database(":memory:");
  const dir = path.resolve(__dirname, "../../migrations");

  const files = fs
    .readdirSync(dir)
    .filter((name) => /^\d{4}_.*\.sql$/.test(name))
    .sort();

  for (const file of files) {
    const content = fs.readFileSync(path.join(dir, file), "utf-8");
    for (const stmt of content.split("--> statement-breakpoint")) {
      if (stmt.trim()) sqlite.exec(stmt);
    }
  }
  sqlite.exec("DELETE FROM backgrounds");

  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}
