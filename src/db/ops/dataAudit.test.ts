import { describe, it, expect, beforeEach } from "vitest";
import { FALLBACK_USER_NAME } from "#shared";
import type { Db } from "../client";
import { COLLECTIONS, decksCol, usersCol } from "../collections";
import {
  createTestDb,
  deckDoc,
  folderDoc,
  seedDocs,
  userDoc,
} from "../test/fixtures";
import { folderCounts, textLimits } from "./dataAudit";

const A = "00000000000000000000a";
const B = "00000000000000000000b";
const C = "00000000000000000000c";
const D = "00000000000000000000d";
const MEDLEY = "c00000000000000000001";
const LONG_ARTIST = "c00000000000000000002";
const BAD_AUTHOR = "c00000000000000000003";
const NORMAL = "c00000000000000000004";
const SLIDES = JSON.stringify([{ id: "s", order: 0, lines: ["메들리"] }]);
const MEDLEY_TITLE = `메들리 ${"가".repeat(150)}`;

describe("데이터 점검", () => {
  let db: Db;

  const deck = async (id: string) => (await decksCol(db).doc(id).get()).data();
  const userName = async (id: string) =>
    (await usersCol(db).doc(id).get()).data()?.name;

  beforeEach(async () => {
    db = createTestDb();
    await seedDocs(db, {
      users: [
        userDoc({ id: D, name: "메들리 인도자" }),
        userDoc({ id: A, name: "가".repeat(60) }),
        userDoc({ id: C, name: "보통 이름" }),
      ],
      decks: [
        deckDoc({
          id: MEDLEY,
          userId: D,
          title: MEDLEY_TITLE,
          slides: SLIDES,
        }),
        deckDoc({ id: LONG_ARTIST, userId: A, artist: "나".repeat(120) }),
        deckDoc({ id: NORMAL, userId: C, title: "보통 곡" }),
      ],
    });
    await db
      .collection(COLLECTIONS.users)
      .doc(B)
      .set({ ...userDoc({ id: B }), name: 42 });
    await db
      .collection(COLLECTIONS.decks)
      .doc(BAD_AUTHOR)
      .set({
        ...deckDoc({ id: BAD_AUTHOR, userId: C, forkedFrom: MEDLEY }),
        forkedFromAuthorName: { name: "객체" },
      });
  });

  describe("textLimits", () => {
    it("미리보기는 한도를 넘는 곡과 사용자 이름을 찾고 아무것도 바꾸지 않는다", async () => {
      const found = await textLimits(db);

      expect([...found.decks].sort()).toEqual(
        [MEDLEY, LONG_ARTIST, BAD_AUTHOR].sort(),
      );
      expect([...found.users].sort()).toEqual([A, B].sort());
      expect((await deck(MEDLEY))?.title).toBe(MEDLEY_TITLE);
      expect(await userName(B)).toBe(42);
    });

    it("apply면 곡 글을 앱이 보여 주는 값으로 줄이고 다른 필드는 그대로 둔다", async () => {
      const before = await deck(MEDLEY);

      const fixed = await textLimits(db, { apply: true });

      expect([...fixed.decks].sort()).toEqual(
        [MEDLEY, LONG_ARTIST, BAD_AUTHOR].sort(),
      );
      const medley = await deck(MEDLEY);
      expect(medley?.title).toHaveLength(100);
      expect(medley).toEqual({ ...before, title: MEDLEY_TITLE.slice(0, 100) });
      expect((await deck(LONG_ARTIST))?.artist).toBe("나".repeat(100));
      expect((await deck(BAD_AUTHOR))?.forkedFromAuthorName).toBe(
        FALLBACK_USER_NAME.default,
      );
    });

    it("apply면 이름을 표시 이름으로 다듬고 보통 문서는 건드리지 않는다", async () => {
      const normal = await deck(NORMAL);

      await textLimits(db, { apply: true });

      expect(await userName(A)).toBe("가".repeat(50));
      expect(await userName(B)).toBe(FALLBACK_USER_NAME.default);
      expect(await userName(C)).toBe("보통 이름");
      expect(await userName(D)).toBe("메들리 인도자");
      expect(await deck(NORMAL)).toEqual(normal);
      expect(await textLimits(db, { apply: true })).toEqual({
        decks: [],
        users: [],
      });
    });
  });

  describe("folderCounts", () => {
    it("사용자마다 폴더 수를 많은 순으로 센다", async () => {
      await seedDocs(db, {
        folders: [
          ...Array.from({ length: 3 }, (_, n) =>
            folderDoc({ id: `a${n}`, userId: A }),
          ),
          ...Array.from({ length: 5 }, (_, n) =>
            folderDoc({ id: `b${n}`, userId: B }),
          ),
          folderDoc({ id: "c0", userId: C }),
        ],
      });

      expect(await folderCounts(db)).toEqual({
        total: 9,
        users: 3,
        top: [
          { userId: B, folders: 5 },
          { userId: A, folders: 3 },
          { userId: C, folders: 1 },
        ],
      });
      expect((await folderCounts(db, { top: 1 })).top).toEqual([
        { userId: B, folders: 5 },
      ]);
    });

    it("한 번에 읽는 쪽보다 많은 폴더도 모두 센다", async () => {
      await seedDocs(db, {
        folders: Array.from({ length: 450 }, (_, n) =>
          folderDoc({ id: `bulk-${n}`, userId: A }),
        ),
      });

      expect((await folderCounts(db)).top).toEqual([
        { userId: A, folders: 450 },
      ]);
    });
  });
});
