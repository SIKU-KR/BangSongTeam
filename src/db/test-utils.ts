import Database, {
  type Database as BetterSqliteDatabase,
} from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
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
  const db = drizzle(sqlite, { schema });
  migrate(db, {
    migrationsFolder: path.resolve(__dirname, "../../migrations"),
  });
  return { sqlite, db };
}
