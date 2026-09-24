import { describe, it, expect, afterEach } from "vitest";
import Database, {
  type Database as BetterSqliteDatabase,
} from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { INITIAL_BACKGROUNDS } from "@repo/shared";

/**
 * UUID → NanoID 전환 마이그레이션 (`0006_nanoid_reset`, `0007_seed_backgrounds_nanoid`).
 *
 * `createTestDb()`는 시드 마이그레이션을 건너뛰므로 여기서는 파일을 직접 순서대로
 * 적용한다. D1처럼 외래키를 켠다 (better-sqlite3 기본값은 꺼짐).
 */
const MIGRATIONS_DIR = path.resolve(__dirname, "../../drizzle");
const ALL_MIGRATIONS = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((name) => /^\d{4}_.*\.sql$/.test(name))
  .sort();
const BEFORE_RESET = ALL_MIGRATIONS.filter((name) => name < "0006");
const FROM_RESET = ALL_MIGRATIONS.filter((name) => name >= "0006");

const LEGACY_USER_ID = "8f14e45f-ceea-4e0a-9f2b-1a2b3c4d5e6f";
const LEGACY_PRESENTATION_ID = "10000000-0000-4000-8000-000000000001";
const LEGACY_DECK_ID = "c0000000-0000-4000-8000-000000000001";
const LEGACY_BACKGROUND_ID = "b0000000-0000-0000-0000-000000000001";

const USER_TABLES = [
  "user",
  "session",
  "account",
  "verification",
  "presentations",
  "presentation_items",
  "decks",
  "reports",
  "decks_fts",
] as const;

function applyMigrations(
  sqlite: BetterSqliteDatabase,
  files: readonly string[],
): void {
  for (const file of files) {
    const content = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
    for (const stmt of content.split("--> statement-breakpoint")) {
      if (stmt.trim()) sqlite.exec(stmt);
    }
  }
}

function openDb(): BetterSqliteDatabase {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  return sqlite;
}

function count(sqlite: BetterSqliteDatabase, table: string): number {
  const row = sqlite
    .prepare(`SELECT COUNT(*) AS n FROM \`${table}\``)
    .get() as {
    n: number;
  };
  return row.n;
}

function backgroundIds(sqlite: BetterSqliteDatabase): string[] {
  return (
    sqlite.prepare("SELECT id FROM backgrounds ORDER BY id").all() as {
      id: string;
    }[]
  ).map((row) => row.id);
}

const EXPECTED_BACKGROUND_IDS = INITIAL_BACKGROUNDS.map((bg) => bg.id).sort();

describe("0006_nanoid_reset + 0007_seed_backgrounds_nanoid", () => {
  let sqlite: BetterSqliteDatabase | null = null;

  afterEach(() => {
    sqlite?.close();
    sqlite = null;
  });

  it("새 DB에 전부 적용하면 배경은 NanoID 10건만 남는다", () => {
    sqlite = openDb();
    applyMigrations(sqlite, ALL_MIGRATIONS);

    expect(backgroundIds(sqlite)).toEqual(EXPECTED_BACKGROUND_IDS);
  });

  it("UUID 시절 데이터를 모두 지우고 배경을 NanoID로 바꾼다", () => {
    sqlite = openDb();
    applyMigrations(sqlite, BEFORE_RESET);

    // 0002가 넣은 UUID 배경을 참조하는 공개 덱 하나가 있는 운영 DB를 흉내 낸다
    const now = Math.floor(Date.now() / 1000);
    sqlite.exec(`
      INSERT INTO user (id, name, created_at, updated_at)
        VALUES ('${LEGACY_USER_ID}', '옛 사용자', ${now}, ${now});
      INSERT INTO session (id, user_id, token, expires_at, created_at, updated_at)
        VALUES ('s1', '${LEGACY_USER_ID}', 'token', ${now + 3600}, ${now}, ${now});
      INSERT INTO account (id, user_id, account_id, provider_id, created_at, updated_at)
        VALUES ('a1', '${LEGACY_USER_ID}', '12345', 'kakao', ${now}, ${now});
      INSERT INTO verification (id, identifier, value, expires_at, created_at, updated_at)
        VALUES ('v1', 'x', 'y', ${now + 3600}, ${now}, ${now});
      INSERT INTO presentations (id, user_id, title, service_date)
        VALUES ('${LEGACY_PRESENTATION_ID}', '${LEGACY_USER_ID}', '주일예배', '2026-09-27');
      INSERT INTO decks (id, user_id, scope, title, lyrics_raw, slides, background_id, style, visibility, published_at)
        VALUES ('${LEGACY_DECK_ID}', '${LEGACY_USER_ID}', 'library', '곡', '가사', '[]',
                '${LEGACY_BACKGROUND_ID}', '{}', 'public', ${now});
      INSERT INTO presentation_items (id, presentation_id, deck_id, "order")
        VALUES ('30000000-0000-4000-8000-000000000001', '${LEGACY_PRESENTATION_ID}', '${LEGACY_DECK_ID}', 0);
      INSERT INTO reports (id, user_id, target_type, target_id, reason)
        VALUES ('r1', '${LEGACY_USER_ID}', 'deck', '${LEGACY_DECK_ID}', 'lyrics_error');
    `);
    expect(count(sqlite, "decks_fts")).toBe(1);
    expect(backgroundIds(sqlite)).toContain(LEGACY_BACKGROUND_ID);

    applyMigrations(sqlite, FROM_RESET);

    for (const table of USER_TABLES) {
      expect(count(sqlite, table), `${table}가 비어 있어야 한다`).toBe(0);
    }
    expect(backgroundIds(sqlite)).toEqual(EXPECTED_BACKGROUND_IDS);
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
  });
});
