import { describe, it, expect, beforeEach } from "vitest";
import type { Db } from "../client";
import { backgroundDoc, createTestDb, seedDocs } from "../test/fixtures";
import { listBackgrounds } from "./backgrounds";

const SERVICE_A = "svc000000000000000001";
const SERVICE_B = "svc000000000000000002";

describe("배경 쿼리 헬퍼", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await seedDocs(db, {
      backgrounds: [
        backgroundDoc({ id: SERVICE_B, title: "호수" }),
        backgroundDoc({ id: SERVICE_A, title: "노을" }),
      ],
    });
  });

  describe("listBackgrounds", () => {
    it("배경을 제목순으로 준다", async () => {
      const list = await listBackgrounds(db);
      expect(list.map((bg) => bg.id)).toEqual([SERVICE_A, SERVICE_B]);
    });

    it("저장소 키를 미디어 프록시 URL로 바꿔 돌려준다", async () => {
      const list = await listBackgrounds(db);
      expect(list.find((bg) => bg.id === SERVICE_A)).toMatchObject({
        mediaUrl: `/api/media/loops/${SERVICE_A}.mp4`,
        posterUrl: `/api/media/posters/${SERVICE_A}.webp`,
      });
    });
  });

  it("검색 메타데이터를 정렬해 주고, 없으면 빈 값이다", async () => {
    await seedDocs(db, {
      backgrounds: [
        backgroundDoc({
          id: "svc000000000000000004",
          title: "구름 하늘",
          description: "흰 구름이 천천히 흘러가요.",
          keywords: ["하늘", "구름", "clouds"],
        }),
      ],
    });

    const list = await listBackgrounds(db);
    expect(list.find((bg) => bg.id === "svc000000000000000004")).toMatchObject({
      description: "흰 구름이 천천히 흘러가요.",
      keywords: ["clouds", "구름", "하늘"],
    });
    expect(list.find((bg) => bg.id === SERVICE_A)).toMatchObject({
      description: "",
      keywords: [],
    });
  });
});
