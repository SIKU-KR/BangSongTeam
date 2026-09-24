import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BACKGROUND_UPLOAD_LIMITS } from "#shared";
import { createTestDb, type TestDbResult } from "../test-utils";
import { backgrounds, user, type NewBackground } from "../schema";
import {
  deleteUserBackground,
  getBackgroundUsage,
  insertUserBackground,
  listVisibleBackgrounds,
  maskNonServiceBackgrounds,
  nullifyUnknownBackgrounds,
} from "./backgrounds";

const ME = "user00000000000000001";
const OTHER = "user00000000000000002";
const SERVICE_A = "svc000000000000000001";
const SERVICE_B = "svc000000000000000002";
const MINE_OLD = "mine00000000000000001";
const MINE_NEW = "mine00000000000000002";
const OTHERS = "other0000000000000001";

function row(
  overrides: Partial<NewBackground> & { id: string },
): NewBackground {
  return {
    title: overrides.id,
    r2Key: `loops/${overrides.id}.mp4`,
    posterKey: `posters/${overrides.id}.webp`,
    durationSec: 20,
    license: "CC0",
    tags: JSON.stringify(["잔잔한"]),
    ...overrides,
  };
}

describe("배경 쿼리 헬퍼", () => {
  let testDb: TestDbResult;

  beforeEach(async () => {
    testDb = createTestDb();
    await testDb.db.insert(user).values(
      [ME, OTHER].map((id) => ({
        id,
        name: id,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    );
    await testDb.db.insert(backgrounds).values([
      row({ id: SERVICE_B, title: "호수" }),
      row({ id: SERVICE_A, title: "노을" }),
      row({
        id: MINE_OLD,
        title: "본당 1",
        source: "user",
        ownerUserId: ME,
        sizeBytes: 1000,
        createdAt: new Date("2026-09-01T00:00:00Z"),
      }),
      row({
        id: MINE_NEW,
        title: "본당 2",
        source: "user",
        ownerUserId: ME,
        kind: "image",
        r2Key: `uploads/${ME}/${MINE_NEW}.png`,
        posterKey: `uploads/${ME}/${MINE_NEW}.png`,
        sizeBytes: 500,
        createdAt: new Date("2026-09-20T00:00:00Z"),
      }),
      row({
        id: OTHERS,
        title: "남의 배경",
        source: "user",
        ownerUserId: OTHER,
        sizeBytes: 9000,
      }),
    ]);
  });

  afterEach(() => {
    testDb.sqlite.close();
  });

  describe("listVisibleBackgrounds", () => {
    it("비로그인은 사전 주입 배경만 제목순으로 본다", async () => {
      const list = await listVisibleBackgrounds(testDb.db, null);
      expect(list.map((bg) => bg.id)).toEqual([SERVICE_A, SERVICE_B]);
    });

    it("로그인하면 사전 주입 배경 뒤에 내 업로드가 최신순으로 붙고 남의 업로드는 빠진다", async () => {
      const list = await listVisibleBackgrounds(testDb.db, ME);
      expect(list.map((bg) => bg.id)).toEqual([
        SERVICE_A,
        SERVICE_B,
        MINE_NEW,
        MINE_OLD,
      ]);
    });

    it("R2 키를 미디어 프록시 URL로 바꿔 돌려준다", async () => {
      const list = await listVisibleBackgrounds(testDb.db, ME);
      const image = list.find((bg) => bg.id === MINE_NEW);
      expect(image).toMatchObject({
        kind: "image",
        source: "user",
        mediaUrl: `/api/media/uploads/${ME}/${MINE_NEW}.png`,
        posterUrl: `/api/media/uploads/${ME}/${MINE_NEW}.png`,
        tags: ["잔잔한"],
      });
    });

    it("태그 JSON이 깨져 있어도 목록을 망가뜨리지 않는다", async () => {
      await testDb.db
        .insert(backgrounds)
        .values(row({ id: "svc000000000000000003", tags: "{broken" }));
      const list = await listVisibleBackgrounds(testDb.db, null);
      expect(
        list.find((bg) => bg.id === "svc000000000000000003")?.tags,
      ).toEqual([]);
    });
  });

  it("getBackgroundUsage는 내 업로드 크기만 더한다", async () => {
    expect(await getBackgroundUsage(testDb.db, ME)).toEqual({
      usedBytes: 1500,
      limitBytes: BACKGROUND_UPLOAD_LIMITS.maxAccountBytes,
    });
    expect((await getBackgroundUsage(testDb.db, OTHER)).usedBytes).toBe(9000);
  });

  it("insertUserBackground는 소유자와 출처를 서버가 정해 넣는다", async () => {
    const created = await insertUserBackground(testDb.db, ME, {
      id: "mine00000000000000003",
      title: "성탄 배경",
      kind: "video",
      mediaKey: `uploads/${ME}/mine00000000000000003.mp4`,
      posterKey: `uploads/${ME}/mine00000000000000003.poster.webp`,
      sizeBytes: 2048,
      durationSec: 12,
      tags: ["밝은"],
    });

    expect(created).toMatchObject({
      source: "user",
      kind: "video",
      sizeBytes: 2048,
      durationSec: 12,
      tags: ["밝은"],
    });
    expect((await getBackgroundUsage(testDb.db, ME)).usedBytes).toBe(3548);
  });

  describe("deleteUserBackground", () => {
    it("내 업로드를 지우고 R2 키를 돌려준다", async () => {
      const keys = await deleteUserBackground(testDb.db, ME, MINE_OLD);
      expect(keys).toEqual({
        mediaKey: `loops/${MINE_OLD}.mp4`,
        posterKey: `posters/${MINE_OLD}.webp`,
      });
      const list = await listVisibleBackgrounds(testDb.db, ME);
      expect(list.map((bg) => bg.id)).not.toContain(MINE_OLD);
    });

    it("남의 업로드와 사전 주입 배경은 지우지 못한다", async () => {
      expect(await deleteUserBackground(testDb.db, ME, OTHERS)).toBeNull();
      expect(await deleteUserBackground(testDb.db, ME, SERVICE_A)).toBeNull();
      const all = await testDb.db.select().from(backgrounds);
      expect(all).toHaveLength(5);
    });
  });

  it("nullifyUnknownBackgrounds는 모르는 id와 남의 업로드를 배경 없음으로 낮춘다", async () => {
    const rows = await nullifyUnknownBackgrounds(testDb.db, ME, [
      { id: "1", backgroundId: SERVICE_A },
      { id: "2", backgroundId: MINE_NEW },
      { id: "3", backgroundId: OTHERS },
      { id: "4", backgroundId: "gone00000000000000001" },
      { id: "5", backgroundId: null },
    ]);
    expect(rows.map((r) => r.backgroundId)).toEqual([
      SERVICE_A,
      MINE_NEW,
      null,
      null,
      null,
    ]);
  });

  it("maskNonServiceBackgrounds는 공개 경로에서 커스텀 배경을 떼어 낸다", async () => {
    const rows = await maskNonServiceBackgrounds(testDb.db, [
      { backgroundId: SERVICE_B },
      { backgroundId: MINE_OLD },
      { backgroundId: OTHERS },
    ]);
    expect(rows.map((r) => r.backgroundId)).toEqual([SERVICE_B, null, null]);
  });
});
