import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDbResult } from "../test-utils";
import { MODERATION_SQL } from "./moderationSql";

const A = "00000000000000000000a";
const B = "00000000000000000000b";
const DECK = "c00000000000000000001";
const FORK = "c00000000000000000002";

/**
 * 운영 SQL을 실제 마이그레이션 스키마에 대해 실행한다.
 * 컬럼 이름이 바뀌면 런북이 운영 중에 깨지기 전에 여기서 깨진다.
 */
describe("운영 SQL (moderation runbook)", () => {
  let testDb: TestDbResult;
  const run = (key: keyof typeof MODERATION_SQL, params: object = {}) =>
    testDb.sqlite.prepare(MODERATION_SQL[key]).run(params);
  const all = (key: keyof typeof MODERATION_SQL, params: object = {}) =>
    testDb.sqlite.prepare(MODERATION_SQL[key]).all(params) as Record<
      string,
      unknown
    >[];
  const one = (sql: string, ...params: unknown[]) =>
    testDb.sqlite.prepare(sql).get(...params) as Record<string, unknown>;

  beforeEach(() => {
    testDb = createTestDb();
    const s = testDb.sqlite;
    s.exec(
      `INSERT INTO user (id, name, created_at, updated_at) VALUES ('${A}', 'A', 0, 0), ('${B}', 'B', 0, 0)`,
    );
    s.exec(
      `INSERT INTO decks (id, user_id, title, lyrics_raw, slides, style, visibility, published_at) VALUES ('${DECK}', '${A}', '시선', '가사', '[]', '{}', 'public', 1)`,
    );
    s.exec(
      `INSERT INTO decks (id, user_id, title, lyrics_raw, slides, style, visibility, forked_from, origin, published_at) VALUES ('${FORK}', '${B}', '시선', '가사', '[]', '{}', 'public', '${DECK}', 'fork', 1)`,
    );
    s.exec(
      `INSERT INTO reports (id, user_id, target_type, target_id, reason) VALUES ('r1', '${B}', 'deck', '${DECK}', 'copyright'), ('r2', '${A}', 'deck', '${FORK}', 'lyrics_error')`,
    );
  });

  afterEach(() => testDb.sqlite.close());

  it("lists pending reports with the target title", () => {
    const rows = all("LIST_PENDING_REPORTS");
    expect(rows.map((r) => [r.id, r.target_title])).toEqual([
      ["r1", "시선"],
      ["r2", "시선"],
    ]);
  });

  it("takes a deck down, removes it from search and blocks republishing", () => {
    run("TAKEDOWN_DECK", { deck_id: DECK });
    expect(
      one("SELECT visibility, takedown_at FROM decks WHERE id = ?", DECK),
    ).toMatchObject({
      visibility: "private",
    });
    expect(
      one("SELECT takedown_at FROM decks WHERE id = ?", DECK).takedown_at,
    ).not.toBeNull();
    expect(
      one("SELECT count(*) AS n FROM decks_fts WHERE deck_id = ?", DECK).n,
    ).toBe(0);

    // 가져가 다시 공개한 사본을 찾는다
    expect(
      all("LIST_PUBLIC_DESCENDANTS", { deck_id: DECK }).map((r) => r.id),
    ).toEqual([FORK]);

    run("RESOLVE_REPORTS_FOR_TARGET", { target_id: DECK, note: "권리자 요청" });
    expect(
      one("SELECT status, resolution_note FROM reports WHERE id = 'r1'"),
    ).toEqual({
      status: "resolved",
      resolution_note: "권리자 요청",
    });

    run("RESTORE_DECK", { deck_id: DECK });
    expect(
      one("SELECT visibility, takedown_at FROM decks WHERE id = ?", DECK),
    ).toEqual({
      visibility: "private",
      takedown_at: null,
    });
  });

  it("resolves or rejects single reports", () => {
    run("REJECT_REPORT", { report_id: "r2", note: "오류 아님" });
    expect(one("SELECT status FROM reports WHERE id = 'r2'").status).toBe(
      "rejected",
    );
    run("RESOLVE_REPORT", { report_id: "r1", note: "처리" });
    expect(all("LIST_PENDING_REPORTS")).toHaveLength(0);
  });
});
