import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "../client";
import {
  decksCol,
  driveTombstonesCol,
  presentationsCol,
  type FolderDoc,
  type PresentationDoc,
} from "../collections";
import {
  createTestDb,
  deckDoc,
  folderDoc,
  presentationDoc,
  presentationsWithCopies,
  seedDocs,
  userDoc,
} from "../test/fixtures";
import {
  buildFolderIndex,
  DEFAULT_DECK_STYLE,
  isFolderTrashed,
  PresentationDocumentSchema,
  resolveFolderId,
  type PresentationDocument,
} from "#shared";
import { isPresentationInTrash } from "./folders";
import { toSharedFolder } from "./mappers";
import {
  deletePresentation,
  upsertPresentationDocument,
  getPresentationDocumentsByUserId,
} from "./presentations";

const DOC_ID = "100000000000000000001";
const TRASHED_AT = "2026-09-25T00:00:00.000Z";

function makeDoc(
  userId: string,
  overrides: Partial<PresentationDocument> = {},
): PresentationDocument {
  const deckId = "c00000000000000000001";
  return PresentationDocumentSchema.parse({
    id: DOC_ID,
    userId,
    title: "주일 1부 예배",
    serviceDate: "2026-09-27",
    items: [
      {
        id: "300000000000000000001",
        presentationId: DOC_ID,
        deckId,
        order: 0,
        deck: {
          id: deckId,
          userId,
          scope: "presentation",
          presentationId: DOC_ID,
          title: "은혜로다",
          artist: "예수전도단",
          lyricsRaw: "시작됐네",
          slides: [{ id: "s1", order: 0, lines: ["시작됐네"] }],
          backgroundId: null,
          style: { ...DEFAULT_DECK_STYLE, overlayOpacity: 70 },
          visibility: "private",
          forkedFrom: null,
          forkCount: 0,
          createdAt: "2026-09-20T00:00:00.000Z",
          updatedAt: "2026-09-21T00:00:00.000Z",
        },
      },
    ],
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
    ...overrides,
  });
}

describe("프레젠테이션 쿼리", () => {
  let db: Db;

  const userAId = "000000000000000000001";
  const userBId = "000000000000000000002";

  beforeEach(async () => {
    db = createTestDb();
    await seedDocs(db, {
      users: [
        userDoc({ id: userAId, name: "Worship Leader" }),
        userDoc({ id: userBId, name: "Other User" }),
      ],
    });
  });

  describe("in 조건 한도(30)를 넘는 목록", () => {
    it("프레젠테이션이 30개를 넘어도 모두 제 사본 곡을 자리순으로 붙여 돌려준다", async () => {
      const seeded = presentationsWithCopies(userAId, 65, 2);
      await seedDocs(db, seeded);
      const expectedDeckIds = new Map<string, string[]>();
      for (const deck of [...seeded.decks].sort(
        (a, b) => (a.position ?? 0) - (b.position ?? 0),
      )) {
        const id = deck.presentationId as string;
        expectedDeckIds.set(id, [...(expectedDeckIds.get(id) ?? []), deck.id]);
      }

      const documents = await getPresentationDocumentsByUserId(db, userAId);

      expect(documents).toHaveLength(65);
      for (const document of documents) {
        expect(document.items.map((item) => item.order)).toEqual([0, 1]);
        expect(document.items.map((item) => item.deckId)).toEqual(
          expectedDeckIds.get(document.id),
        );
      }
    });
  });

  describe("deletePresentation", () => {
    const clonedDeckId = "c00000000000000000001";

    it("should delete presentation and cascade-delete its copy decks (no orphans)", async () => {
      await seedDocs(db, {
        decks: [
          deckDoc({
            id: "deck-song-1",
            userId: userAId,
            title: "Song 1: 꽃들도",
            lyricsRaw: "이곳에 생명샘 솟아나",
            visibility: "public",
          }),
        ],
      });
      await upsertPresentationDocument(
        db,
        userAId,
        makeDoc(userAId, { trashedAt: TRASHED_AT }),
      );

      expect((await decksCol(db).doc(clonedDeckId).get()).exists).toBe(true);

      expect(await deletePresentation(db, DOC_ID, userAId)).toEqual({
        status: "deleted",
      });

      expect((await presentationsCol(db).doc(DOC_ID).get()).exists).toBe(false);
      expect((await decksCol(db).doc(clonedDeckId).get()).exists).toBe(false);
      expect((await decksCol(db).doc("deck-song-1").get()).exists).toBe(true);
    });

    it("휴지통에 없는 프레젠테이션은 영구 삭제하지 않는다", async () => {
      await upsertPresentationDocument(db, userAId, makeDoc(userAId));

      expect(await deletePresentation(db, DOC_ID, userAId)).toEqual({
        status: "conflict",
        partial: false,
      });

      expect((await presentationsCol(db).doc(DOC_ID).get()).exists).toBe(true);
      expect((await decksCol(db).doc(clonedDeckId).get()).exists).toBe(true);
      expect((await driveTombstonesCol(db).get()).size).toBe(0);
    });

    it("휴지통 폴더(조상 포함) 안의 프레젠테이션은 지운다", async () => {
      const trashed = folderDoc({
        id: "f00000000000000000001",
        userId: userAId,
        trashedAt: new Date(TRASHED_AT),
      });
      const child = folderDoc({
        id: "f00000000000000000002",
        userId: userAId,
        parentId: trashed.id,
      });
      await seedDocs(db, { folders: [trashed, child] });
      const inChild = makeDoc(userAId, { folderId: child.id });
      await upsertPresentationDocument(db, userAId, inChild);
      await seedDocs(db, {
        presentations: [
          presentationDoc({
            id: "100000000000000000002",
            userId: userAId,
            folderId: trashed.id,
          }),
        ],
      });

      expect(await deletePresentation(db, DOC_ID, userAId)).toEqual({
        status: "deleted",
      });
      expect(
        await deletePresentation(db, "100000000000000000002", userAId),
      ).toEqual({ status: "deleted" });

      expect((await presentationsCol(db).get()).size).toBe(0);
      expect((await decksCol(db).doc(clonedDeckId).get()).exists).toBe(false);
      expect(
        (await driveTombstonesCol(db).get()).docs.map((doc) => doc.id).sort(),
      ).toEqual([DOC_ID, "100000000000000000002"]);
    });

    it("남의 프레젠테이션·없는 프레젠테이션은 notFound이고 아무것도 지우지 않는다", async () => {
      await upsertPresentationDocument(
        db,
        userAId,
        makeDoc(userAId, { trashedAt: TRASHED_AT }),
      );

      expect(await deletePresentation(db, DOC_ID, userBId)).toEqual({
        status: "notFound",
      });
      expect(
        await deletePresentation(db, "100000000000000000009", userAId),
      ).toEqual({ status: "notFound" });

      expect((await presentationsCol(db).doc(DOC_ID).get()).exists).toBe(true);
      expect((await decksCol(db).doc(clonedDeckId).get()).exists).toBe(true);
      expect((await driveTombstonesCol(db).get()).size).toBe(0);
    });
  });

  describe("isPresentationInTrash", () => {
    const P = "f0000000000000000000p";
    const Q = "f0000000000000000000q";
    const R = "f0000000000000000000r";
    const trashedAt = new Date(TRASHED_AT);

    function readerOf(folders: FolderDoc[]) {
      const byId = new Map(folders.map((folder) => [folder.id, folder]));
      return vi.fn(async (id: string) => byId.get(id));
    }

    function presentationIn(
      folderId: string | null,
      overrides: Partial<PresentationDoc> = {},
    ): PresentationDoc {
      return presentationDoc({
        id: DOC_ID,
        userId: userAId,
        folderId,
        ...overrides,
      });
    }

    function clientRule(
      folders: FolderDoc[],
      presentation: PresentationDoc,
    ): boolean {
      const index = buildFolderIndex(
        folders
          .filter((folder) => folder.userId === presentation.userId)
          .map(toSharedFolder),
      );
      return (
        Boolean(presentation.trashedAt) ||
        isFolderTrashed(index, resolveFolderId(index, presentation.folderId))
      );
    }

    it("프레젠테이션 자신이 휴지통에 있으면 폴더를 읽지 않고 참이다", async () => {
      const read = readerOf([]);

      expect(
        await isPresentationInTrash(read, presentationIn(P, { trashedAt })),
      ).toBe(true);
      expect(read).not.toHaveBeenCalled();
    });

    it("루트의 프레젠테이션은 폴더를 읽지 않고, 휴지통 필드가 없는 옛 문서는 휴지통 밖이다", async () => {
      const read = readerOf([]);
      const legacy = presentationIn(null) as Partial<PresentationDoc>;
      delete legacy.trashedAt;
      delete legacy.folderId;

      expect(await isPresentationInTrash(read, presentationIn(null))).toBe(
        false,
      );
      expect(await isPresentationInTrash(read, legacy as PresentationDoc)).toBe(
        false,
      );
      expect(read).not.toHaveBeenCalled();
    });

    it.each<[string, FolderDoc[], string, boolean]>([
      [
        "담긴 폴더가 휴지통에 있다",
        [folderDoc({ id: P, userId: userAId, trashedAt })],
        P,
        true,
      ],
      [
        "조상 폴더가 휴지통에 있다",
        [
          folderDoc({ id: P, userId: userAId, parentId: Q }),
          folderDoc({ id: Q, userId: userAId, trashedAt }),
        ],
        P,
        true,
      ],
      ["담긴 폴더가 없으면 루트다", [], P, false],
      [
        "부모가 없으면 그 폴더에서 루트로 끊는다",
        [folderDoc({ id: P, userId: userAId, parentId: R })],
        P,
        false,
      ],
      [
        "남의 폴더는 없는 폴더처럼 루트로 끊는다",
        [
          folderDoc({ id: P, userId: userAId, parentId: Q }),
          folderDoc({ id: Q, userId: userBId, trashedAt }),
        ],
        P,
        false,
      ],
      [
        "사이클 너머의 휴지통 폴더는 세지 않는다",
        [
          folderDoc({ id: P, userId: userAId, parentId: Q }),
          folderDoc({ id: Q, userId: userAId, parentId: P, trashedAt }),
        ],
        P,
        false,
      ],
      [
        "사이클로 들어가는 길의 휴지통 폴더는 센다",
        [
          folderDoc({ id: R, userId: userAId, parentId: P }),
          folderDoc({ id: P, userId: userAId, parentId: Q, trashedAt }),
          folderDoc({ id: Q, userId: userAId, parentId: P }),
        ],
        R,
        true,
      ],
      [
        "사이클로 들어가는 길에서도 끊은 곳 너머는 세지 않는다",
        [
          folderDoc({ id: R, userId: userAId, parentId: P }),
          folderDoc({ id: P, userId: userAId, parentId: Q }),
          folderDoc({ id: Q, userId: userAId, parentId: P, trashedAt }),
        ],
        R,
        false,
      ],
    ])("%s", async (_, folders, folderId, expected) => {
      const presentation = presentationIn(folderId);

      expect(clientRule(folders, presentation)).toBe(expected);
      expect(await isPresentationInTrash(readerOf(folders), presentation)).toBe(
        expected,
      );
    });
  });

  describe("문서 단위 업서트 (동기화)", () => {
    it("저장한 문서를 곡·스타일까지 그대로 되읽는다", async () => {
      expect(
        await upsertPresentationDocument(db, userAId, makeDoc(userAId)),
      ).toBe(true);

      const [restored] = await getPresentationDocumentsByUserId(db, userAId);
      expect(restored.title).toBe("주일 1부 예배");
      expect(restored.items).toHaveLength(1);
      expect(restored.items[0].deck.title).toBe("은혜로다");
      expect(restored.items[0].deck.style.overlayOpacity).toBe(70);
      expect(restored.items[0].deck.slides[0].lines).toEqual(["시작됐네"]);
    });

    it("클라이언트가 만든 id를 그대로 보존한다", async () => {
      await upsertPresentationDocument(db, userAId, makeDoc(userAId));
      const [restored] = await getPresentationDocumentsByUserId(db, userAId);

      expect(restored.id).toBe(DOC_ID);
      expect(restored.items[0].deck.id).toBe("c00000000000000000001");
    });

    it("두 번 저장해도 문서가 중복되지 않는다 (멱등)", async () => {
      await upsertPresentationDocument(db, userAId, makeDoc(userAId));
      await upsertPresentationDocument(db, userAId, makeDoc(userAId));

      expect(await getPresentationDocumentsByUserId(db, userAId)).toHaveLength(
        1,
      );
    });

    it("곡을 지운 문서로 덮어쓰면 서버에서도 사라진다", async () => {
      await upsertPresentationDocument(db, userAId, makeDoc(userAId));
      await upsertPresentationDocument(
        db,
        userAId,
        makeDoc(userAId, { items: [] }),
      );

      const [restored] = await getPresentationDocumentsByUserId(db, userAId);
      expect(restored.items).toHaveLength(0);

      const orphans = await decksCol(db)
        .where("presentationId", "==", DOC_ID)
        .get();
      expect(orphans.size).toBe(0);
    });

    it("본문의 userId가 세션 사용자와 다르면 쓰지 않는다", async () => {
      expect(
        await upsertPresentationDocument(db, userAId, makeDoc(userBId)),
      ).toBe(false);

      expect(await getPresentationDocumentsByUserId(db, userAId)).toHaveLength(
        0,
      );
      expect(await getPresentationDocumentsByUserId(db, userBId)).toHaveLength(
        0,
      );
      expect(
        (await decksCol(db).where("presentationId", "==", DOC_ID).get()).size,
      ).toBe(0);
    });

    it("남의 문서는 덮어쓰지 못한다", async () => {
      await upsertPresentationDocument(db, userAId, makeDoc(userAId));

      const hijacked = await upsertPresentationDocument(
        db,
        userBId,
        makeDoc(userBId, { title: "탈취" }),
      );

      expect(hijacked).toBe(false);
      const [mine] = await getPresentationDocumentsByUserId(db, userAId);
      expect(mine.title).toBe("주일 1부 예배");
    });

    it("빈 저장소에서 목록은 빈 배열이다 (에러 아님)", async () => {
      expect(await getPresentationDocumentsByUserId(db, userAId)).toEqual([]);
    });
  });
});
