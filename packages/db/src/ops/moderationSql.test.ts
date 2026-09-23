import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDbResult } from "../test-utils";
import { MODERATION_SQL } from "./moderationSql";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const DECK = "c0000000-0000-4000-8000-000000000001";
const FORK = "c0000000-0000-4000-8000-000000000002";
const CAT = "d0000000-0000-4000-8000-000000000001";
const CAT2 = "d0000000-0000-4000-8000-000000000002";

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
      `INSERT INTO lyrics_catalog (id, title, artist, title_norm, artist_norm, lyrics_canonical, version_count, status) VALUES ('${CAT}', '시선', '', '시선', '', '원래 가사', 2, 'normalized')`,
    );
    s.exec(
      `INSERT INTO decks (id, user_id, title, lyrics_raw, slides, style, visibility, published_at, catalog_id) VALUES ('${DECK}', '${A}', '시선', '가사', '[]', '{}', 'public', 1, '${CAT}')`,
    );
    s.exec(
      `INSERT INTO decks (id, user_id, title, lyrics_raw, slides, style, visibility, forked_from, origin, published_at) VALUES ('${FORK}', '${B}', '시선', '가사', '[]', '{}', 'public', '${DECK}', 'fork', 1)`,
    );
    s.exec(
      `INSERT INTO lyrics_versions (id, catalog_id, user_id, deck_id, lyrics) VALUES ('v1', '${CAT}', '${A}', '${DECK}', 'A 가사'), ('v2', '${CAT}', '${B}', 'deck-b', 'B 가사')`,
    );
    s.exec(
      `INSERT INTO reports (id, user_id, target_type, target_id, reason) VALUES ('r1', '${B}', 'deck', '${DECK}', 'copyright'), ('r2', '${A}', 'catalog', '${CAT}', 'lyrics_error')`,
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

  it("locks an operator-edited canonical and unlocks it again", () => {
    run("LOCK_CATALOG", { catalog_id: CAT, lyrics: "운영자가 고친 가사" });
    expect(
      one(
        "SELECT lyrics_canonical, status, canonical_source FROM lyrics_catalog WHERE id = ?",
        CAT,
      ),
    ).toEqual({
      lyrics_canonical: "운영자가 고친 가사",
      status: "locked",
      canonical_source: "operator",
    });

    run("UNLOCK_CATALOG", { catalog_id: CAT });
    expect(
      one(
        "SELECT status, lyrics_canonical FROM lyrics_catalog WHERE id = ?",
        CAT,
      ),
    ).toEqual({
      status: "normalized",
      lyrics_canonical: "운영자가 고친 가사",
    });
  });

  it("splits a wrongly merged song into a separate catalog", () => {
    expect(all("LIST_CATALOG_VERSIONS", { catalog_id: CAT })).toHaveLength(2);

    run("CREATE_CATALOG", {
      catalog_id: CAT2,
      title: "시선 (다른 곡)",
      artist: "",
      title_norm: "시선다른곡",
      artist_norm: "",
      lyrics: "B 가사",
    });
    run("MOVE_VERSION_DECK_TO_CATALOG", {
      version_id: "v1",
      to_catalog_id: CAT2,
    });
    run("MOVE_VERSION_TO_CATALOG", { version_id: "v1", to_catalog_id: CAT2 });
    run("RECOUNT_CATALOG", { catalog_id: CAT });
    run("RECOUNT_CATALOG", { catalog_id: CAT2 });

    expect(
      one("SELECT version_count FROM lyrics_catalog WHERE id = ?", CAT)
        .version_count,
    ).toBe(1);
    expect(
      one("SELECT version_count FROM lyrics_catalog WHERE id = ?", CAT2)
        .version_count,
    ).toBe(1);
    expect(
      one("SELECT catalog_id FROM decks WHERE id = ?", DECK).catalog_id,
    ).toBe(CAT2);
    // 새 카탈로그는 가사 라이브러리 검색에도 잡힌다 (FTS 트리거)
    expect(
      one(
        "SELECT count(*) AS n FROM lyrics_catalog_fts WHERE catalog_id = ?",
        CAT2,
      ).n,
    ).toBe(1);
  });

  it("deletes a catalog with its versions", () => {
    testDb.sqlite.pragma("foreign_keys = ON");
    run("DELETE_CATALOG", { catalog_id: CAT });
    expect(
      one("SELECT count(*) AS n FROM lyrics_versions WHERE catalog_id = ?", CAT)
        .n,
    ).toBe(0);
    // 사용자의 덱은 남고 연결만 끊긴다
    expect(
      one("SELECT catalog_id FROM decks WHERE id = ?", DECK).catalog_id,
    ).toBeNull();
  });
});
