import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  DEFAULT_DECK_STYLE,
  PresentationDocumentSchema,
  type Folder,
  type PresentationDocument,
} from "@repo/shared";
import { createTestDb } from "../test-utils";
import { user, decks, presentations, presentationItems } from "../schema";
import {
  deleteFolderTree,
  getDriveTombstones,
  getFoldersByUserId,
  resolveOwnedFolderId,
  upsertFolder,
} from "./folders";
import {
  deletePresentation,
  getPresentationDocumentsByUserId,
  upsertPresentationDocument,
} from "./presentations";

const USER_A = "00000000000000000000a";
const USER_B = "00000000000000000000b";

let seq = 0;
function nextId(): string {
  seq += 1;
  return `f00000000${String(seq).padStart(12, "0")}`;
}

function makeFolder(userId: string, overrides: Partial<Folder> = {}): Folder {
  return {
    id: nextId(),
    userId,
    parentId: null,
    name: "폴더",
    trashedAt: null,
    createdAt: "2026-09-24T00:00:00.123Z",
    updatedAt: "2026-09-24T00:00:00.456Z",
    ...overrides,
  };
}

function makeDoc(
  userId: string,
  overrides: Partial<PresentationDocument> = {},
): PresentationDocument {
  const id = overrides.id ?? nextId();
  const deckId = nextId();
  return PresentationDocumentSchema.parse({
    id,
    userId,
    title: "주일 예배",
    serviceDate: "2026-09-27",
    items: [
      {
        id: nextId(),
        presentationId: id,
        deckId,
        order: 0,
        deck: {
          id: deckId,
          userId,
          scope: "presentation",
          presentationId: id,
          title: "은혜로다",
          artist: "",
          lyricsRaw: "시작됐네",
          slides: [{ id: "s1", order: 0, lines: ["시작됐네"] }],
          backgroundId: null,
          style: DEFAULT_DECK_STYLE,
          visibility: "private",
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

describe("드라이브 폴더 쿼리", () => {
  let db: ReturnType<typeof createTestDb>["db"];

  beforeEach(async () => {
    db = createTestDb().db;
    await db.insert(user).values([
      { id: USER_A, name: "A", createdAt: new Date(), updatedAt: new Date() },
      { id: USER_B, name: "B", createdAt: new Date(), updatedAt: new Date() },
    ]);
  });

  describe("upsertFolder / getFoldersByUserId", () => {
    it("ms까지 그대로 왕복하고 본인 폴더만 돌려준다", async () => {
      const mine = makeFolder(USER_A, { name: "2026 주일" });
      await upsertFolder(db, USER_A, mine);
      await upsertFolder(db, USER_B, makeFolder(USER_B));

      const folders = await getFoldersByUserId(db, USER_A);
      expect(folders).toEqual([mine]);
    });

    it("본문의 userId를 믿지 않고 세션 소유자로 강제한다", async () => {
      const forged = makeFolder(USER_B);
      const saved = await upsertFolder(db, USER_A, forged);
      expect(saved?.userId).toBe(USER_A);
      expect(await getFoldersByUserId(db, USER_B)).toEqual([]);
    });

    it("남의 폴더는 덮어쓰지 못한다", async () => {
      const theirs = makeFolder(USER_B, { name: "B의 폴더" });
      await upsertFolder(db, USER_B, theirs);

      expect(
        await upsertFolder(db, USER_A, { ...theirs, name: "탈취" }),
      ).toBeNull();
      const [still] = await getFoldersByUserId(db, USER_B);
      expect(still.name).toBe("B의 폴더");
    });

    it("이름 변경·이동·휴지통을 반영한다", async () => {
      const parent = makeFolder(USER_A, { name: "부모" });
      const child = makeFolder(USER_A, { name: "자식" });
      await upsertFolder(db, USER_A, parent);
      await upsertFolder(db, USER_A, child);

      const moved = {
        ...child,
        name: "옮긴 자식",
        parentId: parent.id,
        trashedAt: "2026-09-25T00:00:00.789Z",
        updatedAt: "2026-09-25T00:00:00.789Z",
      };
      expect(await upsertFolder(db, USER_A, moved)).toEqual(moved);

      const folders = await getFoldersByUserId(db, USER_A);
      expect(folders.find((f) => f.id === child.id)).toEqual(moved);
    });

    it("없는 부모·남의 부모를 가리키면 루트로 보정한다", async () => {
      const theirs = makeFolder(USER_B);
      await upsertFolder(db, USER_B, theirs);

      const orphan = await upsertFolder(
        db,
        USER_A,
        makeFolder(USER_A, { parentId: nextId() }),
      );
      const intruder = await upsertFolder(
        db,
        USER_A,
        makeFolder(USER_A, { parentId: theirs.id }),
      );

      expect(orphan?.parentId).toBeNull();
      expect(intruder?.parentId).toBeNull();
    });

    it("하위 폴더 안으로 옮겨 사이클이 생기면 루트로 보정한다", async () => {
      const a = makeFolder(USER_A, { name: "a" });
      const b = makeFolder(USER_A, { name: "b", parentId: a.id });
      await upsertFolder(db, USER_A, a);
      await upsertFolder(db, USER_A, b);

      // 다른 기기에서 a를 b 아래로 옮겼다 → a→b→a 사이클
      const saved = await upsertFolder(db, USER_A, { ...a, parentId: b.id });
      expect(saved?.parentId).toBeNull();

      const self = await upsertFolder(db, USER_A, { ...b, parentId: b.id });
      expect(self?.parentId).toBeNull();
    });
  });

  describe("deleteFolderTree", () => {
    it("하위 폴더와 그 안의 프레젠테이션·덱·항목을 함께 지운다", async () => {
      const root = makeFolder(USER_A, { name: "root" });
      const child = makeFolder(USER_A, { name: "child", parentId: root.id });
      const sibling = makeFolder(USER_A, { name: "sibling" });
      for (const folder of [root, child, sibling]) {
        await upsertFolder(db, USER_A, folder);
      }

      const inRoot = makeDoc(USER_A, { folderId: root.id });
      const inChild = makeDoc(USER_A, { folderId: child.id });
      const inSibling = makeDoc(USER_A, { folderId: sibling.id });
      const atRoot = makeDoc(USER_A);
      for (const doc of [inRoot, inChild, inSibling, atRoot]) {
        await upsertPresentationDocument(db, USER_A, doc);
      }

      const result = await deleteFolderTree(db, USER_A, root.id);
      expect(result?.folderIds.sort()).toEqual([root.id, child.id].sort());
      expect(result?.presentationIds.sort()).toEqual(
        [inRoot.id, inChild.id].sort(),
      );

      const folders = await getFoldersByUserId(db, USER_A);
      expect(folders.map((f) => f.id)).toEqual([sibling.id]);

      const docs = await getPresentationDocumentsByUserId(db, USER_A);
      expect(docs.map((d) => d.id).sort()).toEqual(
        [inSibling.id, atRoot.id].sort(),
      );

      // 고아 덱·항목이 남지 않는다
      const orphanDecks = await db
        .select()
        .from(decks)
        .where(eq(decks.presentationId, inRoot.id));
      const orphanItems = await db
        .select()
        .from(presentationItems)
        .where(eq(presentationItems.presentationId, inChild.id));
      expect(orphanDecks).toHaveLength(0);
      expect(orphanItems).toHaveLength(0);
    });

    it("남의 폴더·없는 폴더는 null이고 아무것도 지우지 않는다", async () => {
      const theirs = makeFolder(USER_B);
      await upsertFolder(db, USER_B, theirs);
      await upsertPresentationDocument(
        db,
        USER_B,
        makeDoc(USER_B, { folderId: theirs.id }),
      );

      expect(await deleteFolderTree(db, USER_A, theirs.id)).toBeNull();
      expect(await deleteFolderTree(db, USER_A, nextId())).toBeNull();
      expect(await getFoldersByUserId(db, USER_B)).toHaveLength(1);
      expect(await db.select().from(presentations)).toHaveLength(1);
    });
  });

  describe("프레젠테이션 드라이브 배치", () => {
    it("folderId·trashedAt을 왕복한다", async () => {
      const folder = makeFolder(USER_A);
      await upsertFolder(db, USER_A, folder);
      const doc = makeDoc(USER_A, {
        folderId: folder.id,
        trashedAt: "2026-09-24T01:02:03.456Z",
      });
      await upsertPresentationDocument(db, USER_A, doc);

      const [restored] = await getPresentationDocumentsByUserId(db, USER_A);
      expect(restored.folderId).toBe(folder.id);
      expect(restored.trashedAt).toBe("2026-09-24T01:02:03.456Z");
    });

    it("폴더 기능 이전 문서는 folderId null·trashedAt null로 읽힌다", async () => {
      await upsertPresentationDocument(db, USER_A, makeDoc(USER_A));
      const [restored] = await getPresentationDocumentsByUserId(db, USER_A);
      expect(restored.folderId).toBeNull();
      expect(restored.trashedAt).toBeNull();
    });

    it("필드가 없는 문서(구버전 클라이언트)는 기존 배치를 유지한다", async () => {
      const folder = makeFolder(USER_A);
      await upsertFolder(db, USER_A, folder);
      const doc = makeDoc(USER_A, {
        folderId: folder.id,
        trashedAt: "2026-09-24T00:00:00.000Z",
      });
      await upsertPresentationDocument(db, USER_A, doc);

      // 구버전 클라이언트는 드라이브 필드를 아예 보내지 않는다
      const legacy: PresentationDocument = {
        ...doc,
        title: "구버전에서 고친 제목",
      };
      delete legacy.folderId;
      delete legacy.trashedAt;
      await upsertPresentationDocument(db, USER_A, legacy);

      const [restored] = await getPresentationDocumentsByUserId(db, USER_A);
      expect(restored.title).toBe("구버전에서 고친 제목");
      expect(restored.folderId).toBe(folder.id);
      expect(restored.trashedAt).toBe("2026-09-24T00:00:00.000Z");
    });

    it("남의 폴더·없는 폴더를 가리키면 루트로 보정한다", async () => {
      const theirs = makeFolder(USER_B);
      await upsertFolder(db, USER_B, theirs);

      await upsertPresentationDocument(
        db,
        USER_A,
        makeDoc(USER_A, { folderId: theirs.id }),
      );
      await upsertPresentationDocument(
        db,
        USER_A,
        makeDoc(USER_A, { folderId: nextId() }),
      );

      const docs = await getPresentationDocumentsByUserId(db, USER_A);
      expect(docs.map((d) => d.folderId)).toEqual([null, null]);
    });

    it("명시적 null이면 루트로 옮긴다", async () => {
      const folder = makeFolder(USER_A);
      await upsertFolder(db, USER_A, folder);
      const doc = makeDoc(USER_A, { folderId: folder.id });
      await upsertPresentationDocument(db, USER_A, doc);
      await upsertPresentationDocument(db, USER_A, {
        ...doc,
        folderId: null,
        trashedAt: null,
      });

      const [restored] = await getPresentationDocumentsByUserId(db, USER_A);
      expect(restored.folderId).toBeNull();
    });

    it("resolveOwnedFolderId는 본인 폴더만 통과시킨다", async () => {
      const mine = makeFolder(USER_A);
      const theirs = makeFolder(USER_B);
      await upsertFolder(db, USER_A, mine);
      await upsertFolder(db, USER_B, theirs);

      expect(await resolveOwnedFolderId(db, USER_A, mine.id)).toBe(mine.id);
      expect(await resolveOwnedFolderId(db, USER_A, theirs.id)).toBeNull();
      expect(await resolveOwnedFolderId(db, USER_A, null)).toBeNull();
    });
  });

  describe("영구 삭제 기록 (tombstone)", () => {
    it("폴더 트리 삭제는 지운 폴더·프레젠테이션을 기록한다 (본인 것만 보인다)", async () => {
      const root = makeFolder(USER_A);
      const child = makeFolder(USER_A, { parentId: root.id });
      await upsertFolder(db, USER_A, root);
      await upsertFolder(db, USER_A, child);
      const doc = makeDoc(USER_A, { folderId: child.id });
      await upsertPresentationDocument(db, USER_A, doc);

      await deleteFolderTree(db, USER_A, root.id);

      const tombstones = await getDriveTombstones(db, USER_A);
      expect(tombstones.folderIds.sort()).toEqual([root.id, child.id].sort());
      expect(tombstones.presentationIds).toEqual([doc.id]);
      expect(await getDriveTombstones(db, USER_B)).toEqual({
        folderIds: [],
        presentationIds: [],
      });
    });

    it("프레젠테이션 영구 삭제도 기록한다", async () => {
      const doc = makeDoc(USER_A);
      await upsertPresentationDocument(db, USER_A, doc);
      await deletePresentation(db, doc.id, USER_A);

      expect((await getDriveTombstones(db, USER_A)).presentationIds).toEqual([
        doc.id,
      ]);
    });

    it("같은 id를 다시 저장하면 기록을 지우고 되살린다", async () => {
      const folder = makeFolder(USER_A);
      await upsertFolder(db, USER_A, folder);
      const doc = makeDoc(USER_A);
      await upsertPresentationDocument(db, USER_A, doc);
      await deleteFolderTree(db, USER_A, folder.id);
      await deletePresentation(db, doc.id, USER_A);

      await upsertFolder(db, USER_A, folder);
      await upsertPresentationDocument(db, USER_A, doc);

      expect(await getDriveTombstones(db, USER_A)).toEqual({
        folderIds: [],
        presentationIds: [],
      });
      expect(await getFoldersByUserId(db, USER_A)).toHaveLength(1);
    });

    it("많은 항목을 지워도 문장당 바인딩 제한 안에서 기록한다", async () => {
      const root = makeFolder(USER_A);
      await upsertFolder(db, USER_A, root);
      const children = Array.from({ length: 45 }, () =>
        makeFolder(USER_A, { parentId: root.id }),
      );
      for (const child of children) await upsertFolder(db, USER_A, child);

      const result = await deleteFolderTree(db, USER_A, root.id);
      expect(result?.folderIds).toHaveLength(46);
      expect((await getDriveTombstones(db, USER_A)).folderIds).toHaveLength(46);
    });
  });
});
