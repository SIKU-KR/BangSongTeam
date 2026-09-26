import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDbResult } from "../test-utils";
import { decks, user } from "../schema";
import {
  insertServiceBackground,
  listBackgrounds,
} from "../queries/backgrounds";
import { BACKGROUND_SQL } from "./backgroundSql";

const OWNER = "00000000000000000000a";
const SERVICE = "svc000000000000000001";
const STILL = "svc000000000000000002";
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
    testDb.db
      .insert(user)
      .values({
        id: OWNER,
        name: "A",
        email: "admin@example.com",
        createdAt: new Date(0),
        updatedAt: new Date(0),
      })
      .run();
  });

  afterEach(() => testDb.sqlite.close());

  it("등록한 사전 주입 배경이 앱의 배경 목록에 그대로 나온다", async () => {
    register();

    const [listed] = await listBackgrounds(testDb.db);
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

  it("포스터 없이 올라간 이미지 배경에 축소 포스터를 채운다", async () => {
    register();
    await insertServiceBackground(testDb.db, {
      id: STILL,
      title: "본당",
      license: "CC0",
      kind: "image",
      mediaKey: `stills/${STILL}.jpg`,
      posterKey: `stills/${STILL}.jpg`,
      sizeBytes: 20_000_000,
      durationSec: 0,
      tags: [],
    });
    expect(all("LIST_IMAGE_BACKGROUNDS_WITHOUT_POSTER")).toEqual([
      {
        id: STILL,
        title: "본당",
        r2_key: `stills/${STILL}.jpg`,
        size_bytes: 20_000_000,
      },
    ]);

    const params = {
      background_id: STILL,
      poster_key: `posters/${STILL}.webp`,
      size_bytes: 20_150_000,
    };
    expect(run("SET_IMAGE_BACKGROUND_POSTER", params).changes).toBe(1);
    expect(run("SET_IMAGE_BACKGROUND_POSTER", params).changes).toBe(0);
    expect(
      run("SET_IMAGE_BACKGROUND_POSTER", { ...params, background_id: SERVICE })
        .changes,
    ).toBe(0);

    const listed = (await listBackgrounds(testDb.db)).find(
      (bg) => bg.id === STILL,
    );
    expect(listed).toMatchObject({
      mediaUrl: `/api/media/stills/${STILL}.jpg`,
      posterUrl: `/api/media/posters/${STILL}.webp`,
      sizeBytes: 20_150_000,
    });
    expect(all("LIST_IMAGE_BACKGROUNDS_WITHOUT_POSTER")).toEqual([]);
  });

  it("사전 주입 배경을 지우면 쓰던 곡은 배경 없음이 된다", () => {
    register();
    testDb.db
      .insert(decks)
      .values({
        id: DECK,
        userId: OWNER,
        title: "곡",
        lyricsRaw: "가사",
        slides: "[]",
        style: "{}",
        backgroundId: SERVICE,
      })
      .run();
    expect(
      all("COUNT_DECKS_USING_BACKGROUND", { background_id: SERVICE })[0].decks,
    ).toBe(1);

    run("DELETE_SERVICE_BACKGROUND", { background_id: SERVICE });

    const deck = testDb.db
      .select({ backgroundId: decks.backgroundId })
      .from(decks)
      .where(eq(decks.id, DECK))
      .get();
    expect(deck?.backgroundId).toBeNull();
  });

  it("관리자로 지정할 계정의 id를 이메일로 찾는다", () => {
    expect(
      all("FIND_USER_ID_BY_EMAIL", { email: "admin@example.com" }),
    ).toEqual([{ id: OWNER, name: "A", email: "admin@example.com" }]);
  });
});
