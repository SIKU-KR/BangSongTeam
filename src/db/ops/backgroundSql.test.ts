import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDbResult } from "../test-utils";
import { decks, user } from "../schema";
import { deckRow } from "../test-fixtures";
import { listBackgrounds } from "../queries/backgrounds";
import { BACKGROUND_SQL } from "./backgroundSql";

const OWNER = "00000000000000000000a";
const SERVICE = "svc000000000000000001";
const DECK = "c00000000000000000001";

describe("운영 SQL (배경)", () => {
  let testDb: TestDbResult;
  const run = (key: keyof typeof BACKGROUND_SQL, params: object = {}) => {
    for (const statement of BACKGROUND_SQL[key].split("\n")) {
      testDb.sqlite.prepare(statement).run(params);
    }
  };
  const all = (key: keyof typeof BACKGROUND_SQL, params: object = {}) =>
    testDb.sqlite.prepare(BACKGROUND_SQL[key]).all(params) as Record<
      string,
      unknown
    >[];

  const register = () =>
    run("REGISTER_SERVICE_BACKGROUND", {
      id: SERVICE,
      title: "은은한 빛의 흐름",
      r2_key: `loops/${SERVICE}.mp4`,
      poster_key: `posters/${SERVICE}.webp`,
      duration_sec: 20,
      size_bytes: 18_000_000,
      description: "따뜻한 빛이 천천히 번져요.",
      keywords: JSON.stringify(["빛", "따뜻한"]),
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

  it("등록한 배경이 검색 메타데이터와 함께 앱의 배경 목록에 나온다", async () => {
    register();

    const [listed] = await listBackgrounds(testDb.db);
    expect(listed).toMatchObject({
      id: SERVICE,
      source: "service",
      kind: "video",
      mediaUrl: `/api/media/loops/${SERVICE}.mp4`,
      posterUrl: `/api/media/posters/${SERVICE}.webp`,
      description: "따뜻한 빛이 천천히 번져요.",
      keywords: ["따뜻한", "빛"],
    });
    expect(all("LIST_BACKGROUNDS")).toEqual([
      {
        id: SERVICE,
        title: "은은한 빛의 흐름",
        r2_key: `loops/${SERVICE}.mp4`,
        poster_key: `posters/${SERVICE}.webp`,
      },
    ]);
  });

  it("메타데이터만 고치고 파일 키와 크기는 그대로 둔다", async () => {
    register();

    run("UPDATE_BACKGROUND_METADATA", {
      id: SERVICE,
      title: "노을빛 흐름",
      description: "노을빛이 번져요.",
      keywords: JSON.stringify(["노을"]),
    });

    const [listed] = await listBackgrounds(testDb.db);
    expect(listed).toMatchObject({
      title: "노을빛 흐름",
      keywords: ["노을"],
      sizeBytes: 18_000_000,
      mediaUrl: `/api/media/loops/${SERVICE}.mp4`,
    });
  });

  it("배경을 지우면 쓰던 곡은 배경 없음이 된다", () => {
    register();
    testDb.db
      .insert(decks)
      .values(deckRow({ id: DECK, userId: OWNER, backgroundId: SERVICE }))
      .run();
    expect(all("COUNT_DECKS_BY_BACKGROUND")).toEqual([
      { background_id: SERVICE, decks: 1 },
    ]);

    run("DELETE_BACKGROUND", { id: SERVICE });

    const deck = testDb.db
      .select({ backgroundId: decks.backgroundId })
      .from(decks)
      .where(eq(decks.id, DECK))
      .get();
    expect(deck?.backgroundId).toBeNull();
  });
});
