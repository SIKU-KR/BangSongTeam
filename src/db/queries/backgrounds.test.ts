import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDbResult } from "../test-utils";
import { backgroundKeywords, backgrounds, type NewBackground } from "../schema";
import { listBackgrounds, nullifyUnknownBackgrounds } from "./backgrounds";

const SERVICE_A = "svc000000000000000001";
const SERVICE_B = "svc000000000000000002";

function row(
  overrides: Partial<NewBackground> & { id: string },
): NewBackground {
  return {
    title: overrides.id,
    r2Key: `loops/${overrides.id}.mp4`,
    posterKey: `posters/${overrides.id}.webp`,
    durationSec: 20,
    license: "CC0",
    createdAt: new Date(0),
    ...overrides,
  };
}

describe("배경 쿼리 헬퍼", () => {
  let testDb: TestDbResult;

  beforeEach(async () => {
    testDb = createTestDb();
    await testDb.db
      .insert(backgrounds)
      .values([
        row({ id: SERVICE_B, title: "호수" }),
        row({ id: SERVICE_A, title: "노을" }),
      ]);
  });

  afterEach(() => {
    testDb.sqlite.close();
  });

  describe("listBackgrounds", () => {
    it("배경을 제목순으로 준다", async () => {
      const list = await listBackgrounds(testDb.db);
      expect(list.map((bg) => bg.id)).toEqual([SERVICE_A, SERVICE_B]);
    });

    it("R2 키를 미디어 프록시 URL로 바꿔 돌려준다", async () => {
      const list = await listBackgrounds(testDb.db);
      expect(list.find((bg) => bg.id === SERVICE_A)).toMatchObject({
        source: "service",
        mediaUrl: `/api/media/loops/${SERVICE_A}.mp4`,
        posterUrl: `/api/media/posters/${SERVICE_A}.webp`,
      });
    });
  });

  it("검색 메타데이터를 키워드 행에서 모아 주고, 없으면 빈 값이다", async () => {
    await testDb.db.insert(backgrounds).values(
      row({
        id: "svc000000000000000004",
        title: "구름 하늘",
        description: "흰 구름이 천천히 흘러가요.",
      }),
    );
    await testDb.db.insert(backgroundKeywords).values(
      ["하늘", "구름", "clouds"].map((keyword) => ({
        backgroundId: "svc000000000000000004",
        keyword,
      })),
    );

    const list = await listBackgrounds(testDb.db);
    expect(list.find((bg) => bg.id === "svc000000000000000004")).toMatchObject({
      description: "흰 구름이 천천히 흘러가요.",
      keywords: ["clouds", "구름", "하늘"],
    });
    expect(list.find((bg) => bg.id === SERVICE_A)).toMatchObject({
      description: "",
      keywords: [],
    });
  });

  it("nullifyUnknownBackgrounds는 모르는 id를 배경 없음으로 낮춘다", async () => {
    const rows = await nullifyUnknownBackgrounds(testDb.db, [
      { id: "1", backgroundId: SERVICE_A },
      { id: "2", backgroundId: "gone00000000000000001" },
      { id: "3", backgroundId: null },
    ]);
    expect(rows.map((r) => r.backgroundId)).toEqual([SERVICE_A, null, null]);
  });
});
