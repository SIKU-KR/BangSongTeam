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
 * Creates an in-memory SQLite database with all migrations applied (including FTS5 Trigram & triggers)
 * for fast and reliable integration/unit testing of Drizzle queries.
 */
export function createTestDb(): TestDbResult {
  const sqlite = new Database(":memory:");

  const initialSql = fs.readFileSync(
    path.resolve(__dirname, "../drizzle/0000_initial.sql"),
    "utf-8",
  );
  const fts5Sql = fs.readFileSync(
    path.resolve(__dirname, "../drizzle/0001_fts5.sql"),
    "utf-8",
  );

  for (const stmt of initialSql.split("--> statement-breakpoint")) {
    if (stmt.trim()) sqlite.exec(stmt);
  }
  for (const stmt of fts5Sql.split("--> statement-breakpoint")) {
    if (stmt.trim()) sqlite.exec(stmt);
  }

  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}
