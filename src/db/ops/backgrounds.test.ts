import { describe, it, expect, beforeEach } from "vitest";
import type { Db } from "../client";
import { decksCol } from "../collections";
import { listBackgrounds } from "../queries/backgrounds";
import { createTestDb, deckDoc, seedDocs, userDoc } from "../test/fixtures";
import {
  countDecksByBackground,
  deleteBackground,
  listBackgroundFiles,
  registerBackground,
  updateBackgroundMetadata,
} from "./backgrounds";

const OWNER = "00000000000000000000a";
const SERVICE = "svc000000000000000001";
const DECK = "c00000000000000000001";

describe("배경 운영 작업", () => {
  let db: Db;

  const register = () =>
    registerBackground(db, {
      id: SERVICE,
      title: "은은한 빛의 흐름",
      mediaKey: `loops/${SERVICE}.mp4`,
      posterKey: `posters/${SERVICE}.webp`,
      durationSec: 20,
      sizeBytes: 18_000_000,
      description: "따뜻한 빛이 천천히 번져요.",
      keywords: ["빛", "따뜻한", "빛"],
    });

  beforeEach(async () => {
    db = createTestDb();
    await seedDocs(db, { users: [userDoc({ id: OWNER })] });
  });

  it("등록한 배경이 검색 메타데이터와 함께 앱의 배경 목록에 나온다", async () => {
    expect(await register()).toBe(true);

    const [listed] = await listBackgrounds(db);
    expect(listed).toMatchObject({
      id: SERVICE,
      kind: "video",
      mediaUrl: `/api/media/loops/${SERVICE}.mp4`,
      posterUrl: `/api/media/posters/${SERVICE}.webp`,
      description: "따뜻한 빛이 천천히 번져요.",
      keywords: ["따뜻한", "빛"],
    });
    expect(await listBackgroundFiles(db)).toEqual([
      {
        id: SERVICE,
        title: "은은한 빛의 흐름",
        mediaKey: `loops/${SERVICE}.mp4`,
        posterKey: `posters/${SERVICE}.webp`,
      },
    ]);
  });

  it("같은 id를 다시 등록하면 덮어쓰지 않는다", async () => {
    await register();
    expect(await register()).toBe(false);
  });

  it("메타데이터만 고치고 파일 키와 크기는 그대로 둔다", async () => {
    await register();

    await updateBackgroundMetadata(db, SERVICE, {
      title: "노을빛 흐름",
      description: "노을빛이 번져요.",
      keywords: ["노을"],
    });

    const [listed] = await listBackgrounds(db);
    expect(listed).toMatchObject({
      title: "노을빛 흐름",
      keywords: ["노을"],
      sizeBytes: 18_000_000,
      mediaUrl: `/api/media/loops/${SERVICE}.mp4`,
    });
  });

  it("배경을 지우면 쓰던 곡은 배경 없음이 된다", async () => {
    await register();
    await seedDocs(db, {
      decks: [deckDoc({ id: DECK, userId: OWNER, backgroundId: SERVICE })],
    });
    expect(await countDecksByBackground(db, [SERVICE, "unused"])).toEqual(
      new Map([[SERVICE, 1]]),
    );

    expect(await deleteBackground(db, SERVICE)).toEqual([DECK]);

    expect(
      (await decksCol(db).doc(DECK).get()).data()?.backgroundId,
    ).toBeNull();
    expect(await listBackgrounds(db)).toEqual([]);
  });
});
