import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDbResult } from "../test-utils";
import { listVisibleBackgrounds } from "../queries/backgrounds";
import { BACKGROUND_SQL } from "./backgroundSql";

const OWNER = "00000000000000000000a";
const SERVICE = "svc000000000000000001";
const UPLOAD = "upl000000000000000001";
const DECK = "c00000000000000000001";

describe("운영 SQL (background runbook)", () => {
  let testDb: TestDbResult;
  const run = (key: keyof typeof BACKGROUND_SQL, params: object = {}) =>
    testDb.sqlite.prepare(BACKGROUND_SQL[key]).run(params);
  const all = (key: keyof typeof BACKGROUND_SQL, params: object = {}) =>
    testDb.sqlite.prepare(BACKGROUND_SQL[key]).all(params) as Record<
      string,
      unknown
    >[];

  const register = () =>
    run("REGISTER_SERVICE_BACKGROUND", {
      id: SERVICE,
      title: "은은한 빛의 흐름",
      r2_key: "loops/warm_light_flow.mp4",
      poster_key: "posters/warm_light_flow.webp",
      duration_sec: 20,
      license: "Service Original (CC0)",
      tags: '["잔잔한","따뜻한"]',
      size_bytes: 18_000_000,
    });

  beforeEach(() => {
    testDb = createTestDb();
    testDb.sqlite.exec(
      `INSERT INTO user (id, name, created_at, updated_at) VALUES ('${OWNER}', 'A', 0, 0)`,
    );
  });

  afterEach(() => testDb.sqlite.close());

  it("등록한 사전 주입 배경이 앱의 배경 목록에 그대로 나온다", async () => {
    register();

    const [listed] = await listVisibleBackgrounds(testDb.db, null);
    expect(listed).toMatchObject({
      id: SERVICE,
      source: "service",
      kind: "video",
      mediaUrl: "/api/media/loops/warm_light_flow.mp4",
      posterUrl: "/api/media/posters/warm_light_flow.webp",
      tags: ["잔잔한", "따뜻한"],
    });
    expect(all("LIST_SERVICE_BACKGROUNDS").map((row) => row.id)).toEqual([
      SERVICE,
    ]);
  });

  it("사전 주입 배경을 지우면 쓰던 곡은 배경 없음이 된다", () => {
    register();
    testDb.sqlite.exec(
      `INSERT INTO decks (id, user_id, title, lyrics_raw, slides, style, background_id) VALUES ('${DECK}', '${OWNER}', '곡', '가사', '[]', '{}', '${SERVICE}')`,
    );
    expect(
      all("COUNT_DECKS_USING_BACKGROUND", { background_id: SERVICE })[0].decks,
    ).toBe(1);

    run("DELETE_SERVICE_BACKGROUND", { background_id: SERVICE });

    const deck = testDb.sqlite
      .prepare("SELECT background_id FROM decks WHERE id = ?")
      .get(DECK) as { background_id: string | null };
    expect(deck.background_id).toBeNull();
  });

  it("사용자 업로드를 계정별로 집계하고 게시 중단하면 지울 R2 키를 돌려준다", () => {
    testDb.sqlite.exec(
      `INSERT INTO backgrounds (id, title, r2_key, poster_key, duration_sec, license, tags, source, owner_user_id, kind, size_bytes) VALUES ('${UPLOAD}', '업로드', 'uploads/${OWNER}/${UPLOAD}.mp4', 'uploads/${OWNER}/${UPLOAD}.poster.webp', 10, '사용자', '[]', 'user', '${OWNER}', 'video', 4096)`,
    );

    expect(all("LIST_USER_STORAGE")).toEqual([
      { owner_user_id: OWNER, files: 1, bytes: 4096 },
    ]);
    expect(all("TAKEDOWN_USER_BACKGROUND", { background_id: UPLOAD })).toEqual([
      {
        r2_key: `uploads/${OWNER}/${UPLOAD}.mp4`,
        poster_key: `uploads/${OWNER}/${UPLOAD}.poster.webp`,
      },
    ]);
  });
});
