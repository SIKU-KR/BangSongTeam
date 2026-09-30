import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDbResult } from "../test-utils";
import { backgrounds, user, type NewBackground } from "../schema";
import {
  deleteServiceBackground,
  listBackgrounds,
  nullifyUnknownBackgrounds,
} from "./backgrounds";

const LEGACY_OWNER = "user00000000000000001";
const SERVICE_A = "svc000000000000000001";
const SERVICE_B = "svc000000000000000002";
const LEGACY_UPLOAD = "legacy000000000000001";

function row(
  overrides: Partial<NewBackground> & { id: string },
): NewBackground {
  return {
    title: overrides.id,
    r2Key: `loops/${overrides.id}.mp4`,
    posterKey: `posters/${overrides.id}.webp`,
    durationSec: 20,
    license: "CC0",
    ...overrides,
  };
}

describe("배경 쿼리 헬퍼", () => {
  let testDb: TestDbResult;

  beforeEach(async () => {
    testDb = createTestDb();
    await testDb.db.insert(user).values({
      id: LEGACY_OWNER,
      name: LEGACY_OWNER,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await testDb.db.insert(backgrounds).values([
      row({ id: SERVICE_B, title: "호수" }),
      row({ id: SERVICE_A, title: "노을" }),
      row({
        id: LEGACY_UPLOAD,
        title: "예전 업로드",
        source: "user",
        ownerUserId: LEGACY_OWNER,
        r2Key: `uploads/${LEGACY_OWNER}/${LEGACY_UPLOAD}.mp4`,
      }),
    ]);
  });

  afterEach(() => {
    testDb.sqlite.close();
  });

  describe("listBackgrounds", () => {
    it("기본 제공 배경을 제목순으로 주고 예전 사용자 업로드는 뺀다", async () => {
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

  it("검색 메타데이터를 JSON 배열 그대로 돌려주고, 없으면 빈 값이다", async () => {
    await testDb.db.insert(backgrounds).values(
      row({
        id: "svc000000000000000004",
        title: "구름 하늘",
        description: "흰 구름이 천천히 흘러가요.",
        keywords: ["구름", "하늘", "clouds"],
      }),
    );

    const list = await listBackgrounds(testDb.db);
    expect(list.find((bg) => bg.id === "svc000000000000000004")).toMatchObject({
      description: "흰 구름이 천천히 흘러가요.",
      keywords: ["구름", "하늘", "clouds"],
    });
    expect(list.find((bg) => bg.id === SERVICE_A)).toMatchObject({
      description: "",
      keywords: [],
    });
  });

  describe("deleteServiceBackground", () => {
    it("기본 제공 배경을 지우고 R2 키를 돌려준다", async () => {
      expect(await deleteServiceBackground(testDb.db, SERVICE_A)).toEqual({
        mediaKey: `loops/${SERVICE_A}.mp4`,
        posterKey: `posters/${SERVICE_A}.webp`,
      });
      const list = await listBackgrounds(testDb.db);
      expect(list.map((bg) => bg.id)).toEqual([SERVICE_B]);
    });

    it("없는 배경이나 예전 사용자 업로드는 null이다", async () => {
      expect(
        await deleteServiceBackground(testDb.db, "gone00000000000000001"),
      ).toBeNull();
      expect(
        await deleteServiceBackground(testDb.db, LEGACY_UPLOAD),
      ).toBeNull();
    });
  });

  it("nullifyUnknownBackgrounds는 모르는 id와 예전 사용자 업로드를 배경 없음으로 낮춘다", async () => {
    const rows = await nullifyUnknownBackgrounds(testDb.db, [
      { id: "1", backgroundId: SERVICE_A },
      { id: "2", backgroundId: LEGACY_UPLOAD },
      { id: "3", backgroundId: "gone00000000000000001" },
      { id: "4", backgroundId: null },
    ]);
    expect(rows.map((r) => r.backgroundId)).toEqual([
      SERVICE_A,
      null,
      null,
      null,
    ]);
  });
});
