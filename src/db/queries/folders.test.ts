import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
  buildFolderIndex,
  DEFAULT_DECK_STYLE,
  editTimestamp,
  isFolderTrashed,
  MAX_CLOCK_SKEW_MS,
  MAX_FOLDERS_PER_USER,
  PresentationDocumentSchema,
  resolveFolderId,
  type Folder,
  type PresentationDocument,
} from "#shared";
import type { Db } from "../client";
import {
  decksCol,
  driveTombstonesCol,
  foldersCol,
  presentationMembersCol,
  presentationsCol,
  type FolderDoc,
} from "../collections";
import {
  clearDb,
  createTestDb,
  deckDoc,
  folderDoc,
  instrumentTransactions,
  presentationDoc,
  presentationsWithCopies,
  seedDocs,
  userDoc,
} from "../test/fixtures";
import { MAX_WRITES_PER_TRANSACTION } from "./cascade";
import { toSharedFolder } from "./mappers";
import {
  deleteFolderTree,
  getDriveTombstones,
  getFoldersByUserId,
  upsertFolder,
  type DeleteFolderTreeResult,
} from "./folders";
import {
  deletePresentation,
  getPresentationDocumentsByUserId,
  upsertPresentationDocument,
} from "./presentations";

const USER_A = "00000000000000000000a";
const USER_B = "00000000000000000000b";
const TRASHED_AT = "2026-09-25T00:00:00.000Z";
const NO_TOMBSTONES = { folderIds: [], presentationIds: [] };

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

function sortedIds(result: DeleteFolderTreeResult): DeleteFolderTreeResult {
  return result.status === "deleted"
    ? {
        status: "deleted",
        folderIds: [...result.folderIds].sort(),
        presentationIds: [...result.presentationIds].sort(),
      }
    : result;
}

function deletedPresentationIds(result: DeleteFolderTreeResult): string[] {
  return result.status === "deleted" ? result.presentationIds : [];
}

describe("드라이브 폴더 쿼리", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await seedDocs(db, {
      users: [
        userDoc({ id: USER_A, name: "A" }),
        userDoc({ id: USER_B, name: "B" }),
      ],
    });
  });

  describe("upsertFolder / getFoldersByUserId", () => {
    it("ms까지 그대로 왕복하고 본인 폴더만 돌려준다", async () => {
      const mine = makeFolder(USER_A, { name: "2026 주일" });
      await upsertFolder(db, USER_A, mine);
      await upsertFolder(db, USER_B, makeFolder(USER_B));

      const folders = await getFoldersByUserId(db, USER_A);
      expect(folders).toEqual([mine]);
    });

    it("본문의 userId가 세션 사용자와 다르면 쓰지 않는다", async () => {
      expect(await upsertFolder(db, USER_A, makeFolder(USER_B))).toEqual({
        status: "forbidden",
      });
      expect(await getFoldersByUserId(db, USER_A)).toEqual([]);
      expect(await getFoldersByUserId(db, USER_B)).toEqual([]);
    });

    it("남의 폴더는 덮어쓰지 못한다", async () => {
      const theirs = makeFolder(USER_B, { name: "B의 폴더" });
      await upsertFolder(db, USER_B, theirs);

      expect(
        await upsertFolder(db, USER_A, { ...theirs, name: "탈취" }),
      ).toEqual({ status: "forbidden" });
      const [still] = await getFoldersByUserId(db, USER_B);
      expect(still.name).toBe("B의 폴더");
    });

    it("남의 프레젠테이션 id로는 폴더를 만들 수 없다", async () => {
      const theirs = makeDoc(USER_B);
      await upsertPresentationDocument(db, USER_B, theirs);

      expect(
        await upsertFolder(db, USER_A, makeFolder(USER_A, { id: theirs.id })),
      ).toEqual({ status: "forbidden" });

      expect(await getFoldersByUserId(db, USER_A)).toEqual([]);
      expect((await foldersCol(db).doc(theirs.id).get()).exists).toBe(false);
    });

    it("이미 있는 폴더는 같은 id의 프레젠테이션이 생겨도 고칠 수 있다", async () => {
      const folder = makeFolder(USER_A);
      await upsertFolder(db, USER_A, folder);
      await upsertPresentationDocument(
        db,
        USER_A,
        makeDoc(USER_A, { id: folder.id }),
      );
      const renamed = { ...folder, name: "새 이름" };

      expect(await upsertFolder(db, USER_A, renamed)).toEqual({
        status: "saved",
        folder: renamed,
      });
    });

    it("늦게 도착한 옛 변경은 더 새 폴더를 덮지 않고 저장된 폴더를 돌려준다", async () => {
      const folder = makeFolder(USER_A, { name: "처음" });
      await upsertFolder(db, USER_A, folder);
      const newer = {
        ...folder,
        name: "주일 1부",
        updatedAt: "2026-09-25T00:00:02.000Z",
      };
      await upsertFolder(db, USER_A, newer);

      const late = await upsertFolder(db, USER_A, {
        ...folder,
        name: "주일 예배",
        updatedAt: "2026-09-25T00:00:01.000Z",
      });

      expect(late).toEqual({ status: "saved", folder: newer });
      expect(await getFoldersByUserId(db, USER_A)).toEqual([newer]);
    });

    it("시계가 30분 뒤처진 기기가 1분 전에 저장된 폴더를 고쳐도 쓴다", async () => {
      const now = new Date("2026-09-25T00:00:00.000Z");
      const elsewhere = makeFolder(USER_A, {
        name: "다른 기기",
        updatedAt: new Date(now.getTime() - 60_000).toISOString(),
      });
      await upsertFolder(db, USER_A, elsewhere, now);
      const renamed = {
        ...elsewhere,
        name: "새 이름",
        updatedAt: editTimestamp(
          elsewhere.updatedAt,
          now.getTime() - 30 * 60_000,
        ),
      };

      expect(await upsertFolder(db, USER_A, renamed, now)).toEqual({
        status: "saved",
        folder: renamed,
      });
      expect(await getFoldersByUserId(db, USER_A)).toEqual([renamed]);
    });

    it("수정 시각이 같으면 다시 쓴다", async () => {
      const folder = makeFolder(USER_A, { name: "처음" });
      await upsertFolder(db, USER_A, folder);
      const sameTime = { ...folder, name: "같은 시각" };

      expect(await upsertFolder(db, USER_A, sameTime)).toEqual({
        status: "saved",
        folder: sameTime,
      });
      expect(await getFoldersByUserId(db, USER_A)).toEqual([sameTime]);
    });

    it("서버 시계 + 5분보다 늦은 시각은 줄여서 저장하고 줄인 값을 돌려준다", async () => {
      const now = new Date("2026-09-25T00:00:00.000Z");
      const limit = new Date(now.getTime() + MAX_CLOCK_SKEW_MS).toISOString();
      const future = makeFolder(USER_A, {
        createdAt: "9999-12-31T00:00:00.000Z",
        updatedAt: "9999-12-31T00:00:00.000Z",
      });

      const result = await upsertFolder(db, USER_A, future, now);

      const clamped = { ...future, createdAt: limit, updatedAt: limit };
      expect(result).toEqual({ status: "saved", folder: clamped });
      expect(await getFoldersByUserId(db, USER_A)).toEqual([clamped]);
    });

    it("시각을 줄이기 전에 미래 시각으로 저장된 폴더도 이름을 바꿀 수 있다", async () => {
      const pinned = folderDoc({
        id: nextId(),
        userId: USER_A,
        name: "미래에 박힌 폴더",
        createdAt: new Date("2026-09-20T00:00:00.000Z"),
        updatedAt: new Date("9999-12-31T00:00:00.000Z"),
      });
      await seedDocs(db, { folders: [pinned] });
      const now = new Date("2026-09-25T00:00:00.000Z");
      const renamed = {
        ...toSharedFolder(pinned),
        name: "새 이름",
        updatedAt: now.toISOString(),
      };

      expect(await upsertFolder(db, USER_A, renamed, now)).toEqual({
        status: "saved",
        folder: renamed,
      });
      expect(await getFoldersByUserId(db, USER_A)).toEqual([renamed]);
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
      expect(await upsertFolder(db, USER_A, moved)).toEqual({
        status: "saved",
        folder: moved,
      });

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

      expect(orphan).toMatchObject({
        status: "saved",
        folder: { parentId: null },
      });
      expect(intruder).toMatchObject({
        status: "saved",
        folder: { parentId: null },
      });
    });

    it("하위 폴더 안으로 옮겨 사이클이 생기면 루트로 보정한다", async () => {
      const a = makeFolder(USER_A, { name: "a" });
      const b = makeFolder(USER_A, { name: "b", parentId: a.id });
      await upsertFolder(db, USER_A, a);
      await upsertFolder(db, USER_A, b);

      const saved = await upsertFolder(db, USER_A, { ...a, parentId: b.id });
      expect(saved).toMatchObject({
        status: "saved",
        folder: { parentId: null },
      });

      const self = await upsertFolder(db, USER_A, { ...b, parentId: b.id });
      expect(self).toMatchObject({
        status: "saved",
        folder: { parentId: null },
      });
    });
  });

  describe("사용자당 폴더 수 상한", () => {
    async function seedFolders(
      userId: string,
      count: number,
      overrides: Partial<FolderDoc> = {},
    ): Promise<FolderDoc[]> {
      const folders = Array.from({ length: count }, () =>
        folderDoc({ id: nextId(), userId, ...overrides }),
      );
      await seedDocs(db, { folders });
      return folders;
    }

    async function countFolders(userId: string): Promise<number> {
      const snapshot = await foldersCol(db)
        .where("userId", "==", userId)
        .count()
        .get();
      return snapshot.data().count;
    }

    it("상한만큼 폴더가 있으면 새 루트 폴더를 만들지 않는다", async () => {
      await seedFolders(USER_A, MAX_FOLDERS_PER_USER);
      const fresh = makeFolder(USER_A);
      const instrument = instrumentTransactions(db);

      const result = await upsertFolder(db, USER_A, fresh);
      instrument.restore();

      expect(result).toEqual({ status: "limitReached" });
      expect(instrument.max()).toBe(0);
      expect((await foldersCol(db).doc(fresh.id).get()).exists).toBe(false);
      expect(await countFolders(USER_A)).toBe(MAX_FOLDERS_PER_USER);
    });

    it("상한만큼 폴더가 있으면 새 하위 폴더도 만들지 않는다", async () => {
      const [parent] = await seedFolders(USER_A, MAX_FOLDERS_PER_USER);
      const fresh = makeFolder(USER_A, { parentId: parent.id });
      const instrument = instrumentTransactions(db);

      const result = await upsertFolder(db, USER_A, fresh);
      instrument.restore();

      expect(result).toEqual({ status: "limitReached" });
      expect(instrument.max()).toBe(0);
      expect((await foldersCol(db).doc(fresh.id).get()).exists).toBe(false);
      expect(await countFolders(USER_A)).toBe(MAX_FOLDERS_PER_USER);
    });

    it("상한을 넘긴 사용자도 이미 있는 폴더의 이름·이동·휴지통은 저장하고 새 폴더만 막는다", async () => {
      const overCap = MAX_FOLDERS_PER_USER + 5;
      const [folder, parent] = await seedFolders(USER_A, overCap);
      const renamed = {
        ...toSharedFolder(folder),
        name: "새 이름",
        updatedAt: "2026-09-25T00:00:00.000Z",
      };
      const moved = {
        ...renamed,
        parentId: parent.id,
        trashedAt: TRASHED_AT,
        updatedAt: "2026-09-25T00:00:01.000Z",
      };

      expect(await upsertFolder(db, USER_A, renamed)).toEqual({
        status: "saved",
        folder: renamed,
      });
      expect(await upsertFolder(db, USER_A, moved)).toEqual({
        status: "saved",
        folder: moved,
      });
      expect(await upsertFolder(db, USER_A, makeFolder(USER_A))).toEqual({
        status: "limitReached",
      });
      expect(await countFolders(USER_A)).toBe(overCap);
    });

    it("상한보다 하나 모자라면 하나 더 만들 수 있고 그다음부터 막는다", async () => {
      await seedFolders(USER_A, MAX_FOLDERS_PER_USER - 1);
      const last = makeFolder(USER_A);

      expect(await upsertFolder(db, USER_A, last)).toEqual({
        status: "saved",
        folder: last,
      });
      expect(await upsertFolder(db, USER_A, makeFolder(USER_A))).toEqual({
        status: "limitReached",
      });
      expect(await countFolders(USER_A)).toBe(MAX_FOLDERS_PER_USER);
    });

    it("휴지통에 있는 폴더도 영구 삭제하기 전에는 세고, 지우면 다시 만들 수 있다", async () => {
      await seedFolders(USER_A, MAX_FOLDERS_PER_USER - 1);
      const [trashed] = await seedFolders(USER_A, 1, {
        trashedAt: new Date(TRASHED_AT),
      });
      const fresh = makeFolder(USER_A);
      expect(await upsertFolder(db, USER_A, fresh)).toEqual({
        status: "limitReached",
      });

      expect((await deleteFolderTree(db, USER_A, trashed.id)).status).toBe(
        "deleted",
      );

      expect(await upsertFolder(db, USER_A, fresh)).toEqual({
        status: "saved",
        folder: fresh,
      });
    });

    it("다른 사용자의 폴더는 세지 않는다", async () => {
      await seedFolders(USER_A, MAX_FOLDERS_PER_USER);
      const root = makeFolder(USER_B);
      const nested = makeFolder(USER_B, { parentId: root.id });

      expect(await upsertFolder(db, USER_B, root)).toEqual({
        status: "saved",
        folder: root,
      });
      expect(await upsertFolder(db, USER_B, nested)).toEqual({
        status: "saved",
        folder: nested,
      });
    });

    it("상한에 이르러도 영구 삭제한 id는 deleted, 프레젠테이션 id는 forbidden이다", async () => {
      await seedFolders(USER_A, MAX_FOLDERS_PER_USER);
      const removed = makeFolder(USER_A);
      await driveTombstonesCol(db)
        .doc(removed.id)
        .set({ itemId: removed.id, userId: USER_A, kind: "folder" });
      const presentation = presentationDoc({ id: nextId(), userId: USER_A });
      await seedDocs(db, { presentations: [presentation] });

      expect(await upsertFolder(db, USER_A, removed)).toEqual({
        status: "deleted",
      });
      expect(
        await upsertFolder(
          db,
          USER_A,
          makeFolder(USER_A, { id: presentation.id }),
        ),
      ).toEqual({ status: "forbidden" });
    });
  });

  describe("deleteFolderTree", () => {
    it("하위 폴더와 그 안의 프레젠테이션·덱·항목을 함께 지운다", async () => {
      const root = makeFolder(USER_A, { name: "root", trashedAt: TRASHED_AT });
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
      expect(sortedIds(result)).toEqual({
        status: "deleted",
        folderIds: [root.id, child.id].sort(),
        presentationIds: [inRoot.id, inChild.id].sort(),
      });

      const folders = await getFoldersByUserId(db, USER_A);
      expect(folders.map((f) => f.id)).toEqual([sibling.id]);

      const docs = await getPresentationDocumentsByUserId(db, USER_A);
      expect(docs.map((d) => d.id).sort()).toEqual(
        [inSibling.id, atRoot.id].sort(),
      );

      for (const id of [inRoot.id, inChild.id]) {
        const orphanCopies = await decksCol(db)
          .where("presentationId", "==", id)
          .get();
        expect(orphanCopies.size).toBe(0);
      }
    });

    it("남의 폴더·없는 폴더는 notFound이고 아무것도 지우지 않는다", async () => {
      const theirs = makeFolder(USER_B, { trashedAt: TRASHED_AT });
      await upsertFolder(db, USER_B, theirs);
      await upsertPresentationDocument(
        db,
        USER_B,
        makeDoc(USER_B, { folderId: theirs.id }),
      );

      expect(await deleteFolderTree(db, USER_A, theirs.id)).toEqual({
        status: "notFound",
      });
      expect(await deleteFolderTree(db, USER_A, nextId())).toEqual({
        status: "notFound",
      });
      expect(await getFoldersByUserId(db, USER_B)).toHaveLength(1);
      expect((await presentationsCol(db).get()).size).toBe(1);
    });

    it("휴지통에 없는 폴더는 영구 삭제하지 않는다", async () => {
      const folder = makeFolder(USER_A);
      await upsertFolder(db, USER_A, folder);
      const doc = makeDoc(USER_A, { folderId: folder.id });
      await upsertPresentationDocument(db, USER_A, doc);

      expect(await deleteFolderTree(db, USER_A, folder.id)).toEqual({
        status: "conflict",
        partial: false,
      });

      expect(await getFoldersByUserId(db, USER_A)).toEqual([folder]);
      expect(
        (await getPresentationDocumentsByUserId(db, USER_A)).map((d) => d.id),
      ).toEqual([doc.id]);
      expect(
        (await decksCol(db).where("presentationId", "==", doc.id).get()).size,
      ).toBe(1);
      expect(await getDriveTombstones(db, USER_A)).toEqual(NO_TOMBSTONES);
    });

    it("다른 기기에서 복원한 폴더는 영구 삭제하지 않는다", async () => {
      const folder = makeFolder(USER_A);
      await upsertFolder(db, USER_A, {
        ...folder,
        trashedAt: TRASHED_AT,
        updatedAt: TRASHED_AT,
      });
      const doc = makeDoc(USER_A, { folderId: folder.id });
      await upsertPresentationDocument(db, USER_A, doc);
      const restored = {
        ...folder,
        trashedAt: null,
        updatedAt: "2026-09-26T00:00:00.000Z",
      };
      await upsertFolder(db, USER_A, restored);

      expect(await deleteFolderTree(db, USER_A, folder.id)).toEqual({
        status: "conflict",
        partial: false,
      });

      expect(await getFoldersByUserId(db, USER_A)).toEqual([restored]);
      expect(
        (await getPresentationDocumentsByUserId(db, USER_A)).map((d) => d.id),
      ).toEqual([doc.id]);
      expect(await getDriveTombstones(db, USER_A)).toEqual(NO_TOMBSTONES);
    });

    it("조상이 휴지통에 있으면 하위 폴더와 안의 프레젠테이션을 지운다", async () => {
      const parent = makeFolder(USER_A, { trashedAt: TRASHED_AT });
      const child = makeFolder(USER_A, { parentId: parent.id });
      const grandchild = makeFolder(USER_A, { parentId: child.id });
      for (const folder of [parent, child, grandchild]) {
        await upsertFolder(db, USER_A, folder);
      }
      const inParent = makeDoc(USER_A, { folderId: parent.id });
      const inGrandchild = makeDoc(USER_A, { folderId: grandchild.id });
      for (const doc of [inParent, inGrandchild]) {
        await upsertPresentationDocument(db, USER_A, doc);
      }

      const result = await deleteFolderTree(db, USER_A, child.id);

      expect(sortedIds(result)).toEqual({
        status: "deleted",
        folderIds: [child.id, grandchild.id].sort(),
        presentationIds: [inGrandchild.id],
      });
      expect(await getFoldersByUserId(db, USER_A)).toEqual([parent]);
      expect(
        (await getPresentationDocumentsByUserId(db, USER_A)).map((d) => d.id),
      ).toEqual([inParent.id]);
    });

    describe("기기가 본 하위 트리(expected)", () => {
      async function seedTrashedTree(): Promise<{
        parent: Folder;
        child: Folder;
        doc: PresentationDocument;
      }> {
        const parent = makeFolder(USER_A, { trashedAt: TRASHED_AT });
        const child = makeFolder(USER_A, { parentId: parent.id });
        await upsertFolder(db, USER_A, parent);
        await upsertFolder(db, USER_A, child);
        const doc = makeDoc(USER_A, { folderId: child.id });
        await upsertPresentationDocument(db, USER_A, doc);
        return { parent, child, doc };
      }

      it("보지 못한 하위 폴더가 서버 트리에 있으면 아무것도 지우지 않는다", async () => {
        const { parent, child, doc } = await seedTrashedTree();

        expect(
          await deleteFolderTree(db, USER_A, parent.id, {
            folderIds: [parent.id],
            presentationIds: [],
          }),
        ).toEqual({ status: "conflict", partial: false });

        expect(
          (await getFoldersByUserId(db, USER_A)).map((f) => f.id).sort(),
        ).toEqual([parent.id, child.id].sort());
        expect(
          (await getPresentationDocumentsByUserId(db, USER_A)).map((d) => d.id),
        ).toEqual([doc.id]);
        expect(await getDriveTombstones(db, USER_A)).toEqual(NO_TOMBSTONES);
      });

      it("보지 못한 프레젠테이션이 서버 트리에 있으면 아무것도 지우지 않는다", async () => {
        const { parent, child, doc } = await seedTrashedTree();

        expect(
          await deleteFolderTree(db, USER_A, parent.id, {
            folderIds: [parent.id, child.id],
            presentationIds: [],
          }),
        ).toEqual({ status: "conflict", partial: false });

        expect(await getFoldersByUserId(db, USER_A)).toHaveLength(2);
        expect(
          (await getPresentationDocumentsByUserId(db, USER_A)).map((d) => d.id),
        ).toEqual([doc.id]);
        expect(await getDriveTombstones(db, USER_A)).toEqual(NO_TOMBSTONES);
      });

      it("서버에 없는 id나 형식이 다른 id가 더 있어도 지운다", async () => {
        const { parent, child, doc } = await seedTrashedTree();

        const result = await deleteFolderTree(db, USER_A, parent.id, {
          folderIds: [parent.id, child.id, nextId(), "legacy-folder"],
          presentationIds: [doc.id, "550e8400-e29b-41d4-a716-446655440000"],
        });

        expect(sortedIds(result)).toEqual({
          status: "deleted",
          folderIds: [parent.id, child.id].sort(),
          presentationIds: [doc.id],
        });
        expect(await getFoldersByUserId(db, USER_A)).toEqual([]);
      });
    });
  });

  describe("여러 트랜잭션으로 나눠 영구 삭제", () => {
    const trashedAt = new Date(TRASHED_AT);

    afterEach(async () => {
      await clearDb(db);
    });

    interface SeededTree {
      rootId: string;
      folderIds: string[];
      presentationIds: string[];
    }

    async function seedTree(
      folders: FolderDoc[],
      folderId: string,
      presentationCount: number,
    ): Promise<SeededTree> {
      const presentations = Array.from({ length: presentationCount }, () =>
        presentationDoc({ id: nextId(), userId: USER_A, folderId }),
      );
      const decks = presentations.flatMap((presentation) =>
        Array.from({ length: 8 }, (_, position) =>
          deckDoc({
            id: nextId(),
            userId: USER_A,
            presentationId: presentation.id,
            itemId: nextId(),
            position,
          }),
        ),
      );
      await seedDocs(db, { folders, presentations, decks });
      return {
        rootId: folders[0].id,
        folderIds: folders.map((folder) => folder.id),
        presentationIds: presentations.map((presentation) => presentation.id),
      };
    }

    async function seedLargeFolder(): Promise<SeededTree> {
      const root = folderDoc({ id: nextId(), userId: USER_A, trashedAt });
      return seedTree([root], root.id, 60);
    }

    async function seedPresentationsInChild(): Promise<SeededTree> {
      const root = folderDoc({ id: nextId(), userId: USER_A, trashedAt });
      const child = folderDoc({
        id: nextId(),
        userId: USER_A,
        parentId: root.id,
      });
      return seedTree([root, child], child.id, 60);
    }

    async function seedManyFolders(): Promise<SeededTree> {
      const root = folderDoc({ id: nextId(), userId: USER_A, trashedAt });
      const middles = Array.from({ length: 10 }, () =>
        folderDoc({ id: nextId(), userId: USER_A, parentId: root.id }),
      );
      const leaves = middles.flatMap((middle) =>
        Array.from({ length: 25 }, () =>
          folderDoc({ id: nextId(), userId: USER_A, parentId: middle.id }),
        ),
      );
      return seedTree([root, ...middles, ...leaves], leaves[0].id, 5);
    }

    async function expectRestUnderTrashedRoot(tree: SeededTree): Promise<void> {
      const folders = await getFoldersByUserId(db, USER_A);
      const index = buildFolderIndex(folders);
      const presentations = await getPresentationDocumentsByUserId(db, USER_A);
      const tombstones = await getDriveTombstones(db, USER_A);

      expect(index.byId.has(tree.rootId)).toBe(true);
      for (const folder of folders) {
        expect(isFolderTrashed(index, folder.id)).toBe(true);
      }
      for (const presentation of presentations) {
        expect(
          isFolderTrashed(index, resolveFolderId(index, presentation.folderId)),
        ).toBe(true);
      }
      const remainingFolders = new Set(folders.map((folder) => folder.id));
      const remainingPresentations = new Set(
        presentations.map((presentation) => presentation.id),
      );
      expect(tombstones.folderIds.sort()).toEqual(
        tree.folderIds.filter((id) => !remainingFolders.has(id)).sort(),
      );
      expect(tombstones.presentationIds.sort()).toEqual(
        tree.presentationIds.filter((id) => !remainingPresentations.has(id)),
      );
    }

    it("곡 8개씩 든 프레젠테이션 60개 폴더를 트랜잭션마다 450건 이하로 나눠 모두 지운다", async () => {
      const tree = await seedLargeFolder();
      const instrument = instrumentTransactions(db);

      const result = await deleteFolderTree(db, USER_A, tree.rootId);
      instrument.restore();

      expect(instrument.writesPerAttempt.length).toBeGreaterThan(1);
      expect(instrument.max()).toBeLessThanOrEqual(MAX_WRITES_PER_TRANSACTION);
      expect(sortedIds(result)).toEqual({
        status: "deleted",
        folderIds: [tree.rootId],
        presentationIds: tree.presentationIds,
      });
      expect(
        (await decksCol(db).where("userId", "==", USER_A).get()).size,
      ).toBe(0);
      const tombstones = await getDriveTombstones(db, USER_A);
      expect(tombstones.folderIds).toEqual([tree.rootId]);
      expect(tombstones.presentationIds.sort()).toEqual(tree.presentationIds);
    });

    it.each([
      ["프레젠테이션을 나눠 지우는", seedPresentationsInChild],
      ["하위 폴더를 나눠 지우는", seedManyFolders],
    ])(
      "%s 중에 멈춰도 남은 항목은 휴지통 폴더 아래 있고, 다시 지우면 끝난다",
      async (_, seed) => {
        const tree = await seed();
        const instrument = instrumentTransactions(db, { failOnCall: 2 });

        await expect(
          deleteFolderTree(db, USER_A, tree.rootId),
        ).rejects.toThrow();
        instrument.restore();

        expect(instrument.max()).toBeLessThanOrEqual(
          MAX_WRITES_PER_TRANSACTION,
        );
        expect(
          (await getFoldersByUserId(db, USER_A)).length +
            (await getPresentationDocumentsByUserId(db, USER_A)).length,
        ).toBeLessThan(tree.folderIds.length + tree.presentationIds.length);
        await expectRestUnderTrashedRoot(tree);

        expect((await deleteFolderTree(db, USER_A, tree.rootId)).status).toBe(
          "deleted",
        );
        expect(await getFoldersByUserId(db, USER_A)).toEqual([]);
        expect(await getPresentationDocumentsByUserId(db, USER_A)).toEqual([]);
        const tombstones = await getDriveTombstones(db, USER_A);
        expect(tombstones.folderIds.sort()).toEqual([...tree.folderIds].sort());
        expect(tombstones.presentationIds.sort()).toEqual(tree.presentationIds);
      },
    );

    it("트랜잭션 콜백이 다시 돌아도 지운 id를 두 번 세지 않는다", async () => {
      const tree = await seedLargeFolder();
      const instrument = instrumentTransactions(db, {
        replayFirstAttempt: true,
      });

      const result = await deleteFolderTree(db, USER_A, tree.rootId);
      instrument.restore();

      expect(sortedIds(result)).toEqual({
        status: "deleted",
        folderIds: [tree.rootId],
        presentationIds: tree.presentationIds,
      });
    });

    it("여러 차례로 지우는 중에 다른 기기가 복원하면 일부만 지운 채 멈춘다", async () => {
      const tree = await seedLargeFolder();
      const restored = makeFolder(USER_A, { id: tree.rootId });
      const instrument = instrumentTransactions(db, {
        afterCall: {
          call: 1,
          run: async () => {
            await upsertFolder(db, USER_A, restored);
          },
        },
      });

      const result = await deleteFolderTree(db, USER_A, tree.rootId);
      instrument.restore();

      expect(result).toEqual({ status: "conflict", partial: true });
      expect(
        (await getFoldersByUserId(db, USER_A)).map((folder) => [
          folder.id,
          folder.trashedAt,
        ]),
      ).toEqual([[tree.rootId, null]]);
      const remaining = await getPresentationDocumentsByUserId(db, USER_A);
      expect(remaining.length).toBeGreaterThan(0);
      expect(remaining.length).toBeLessThan(tree.presentationIds.length);
      expect(
        (await getDriveTombstones(db, USER_A)).presentationIds,
      ).toHaveLength(tree.presentationIds.length - remaining.length);
    });

    it("여러 차례로 지우는 중에 기기가 보지 못한 프레젠테이션이 들어오면 일부만 지운 채 멈춘다", async () => {
      const tree = await seedLargeFolder();
      const outsider = makeDoc(USER_A);
      await upsertPresentationDocument(db, USER_A, outsider);
      const instrument = instrumentTransactions(db, {
        afterCall: {
          call: 1,
          run: async () => {
            await upsertPresentationDocument(db, USER_A, {
              ...outsider,
              folderId: tree.rootId,
            });
          },
        },
      });

      const result = await deleteFolderTree(db, USER_A, tree.rootId, {
        folderIds: [tree.rootId],
        presentationIds: tree.presentationIds,
      });
      instrument.restore();

      expect(result).toEqual({ status: "conflict", partial: true });
      const survivor = (
        await getPresentationDocumentsByUserId(db, USER_A)
      ).find((doc) => doc.id === outsider.id);
      expect(survivor?.folderId).toBe(tree.rootId);
      expect(survivor?.items).toHaveLength(1);
      expect(
        (await getDriveTombstones(db, USER_A)).presentationIds,
      ).not.toContain(outsider.id);
    });

    it("다른 요청이 차례 사이에 마저 지우면 이 요청이 지운 것만 담아 지운 것으로 답한다", async () => {
      const tree = await seedLargeFolder();
      const finishedElsewhere: DeleteFolderTreeResult[] = [];
      const instrument = instrumentTransactions(db, {
        afterCall: {
          call: 1,
          run: async () => {
            finishedElsewhere.push(
              await deleteFolderTree(db, USER_A, tree.rootId),
            );
          },
        },
      });

      const result = await deleteFolderTree(db, USER_A, tree.rootId);
      instrument.restore();

      const [other] = finishedElsewhere;
      expect(result).toMatchObject({ status: "deleted", folderIds: [] });
      expect(other).toMatchObject({
        status: "deleted",
        folderIds: [tree.rootId],
      });
      const firstPass = deletedPresentationIds(result);
      expect(firstPass.length).toBeGreaterThan(0);
      expect(firstPass.length).toBeLessThan(tree.presentationIds.length);
      expect([...firstPass, ...deletedPresentationIds(other)].sort()).toEqual(
        tree.presentationIds,
      );
      expect(await getFoldersByUserId(db, USER_A)).toEqual([]);
      expect(await getPresentationDocumentsByUserId(db, USER_A)).toEqual([]);
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
  });

  describe("영구 삭제 기록 (tombstone)", () => {
    it("폴더 트리 삭제는 지운 폴더·프레젠테이션을 기록한다 (본인 것만 보인다)", async () => {
      const root = makeFolder(USER_A, { trashedAt: TRASHED_AT });
      const child = makeFolder(USER_A, { parentId: root.id });
      await upsertFolder(db, USER_A, root);
      await upsertFolder(db, USER_A, child);
      const doc = makeDoc(USER_A, { folderId: child.id });
      await upsertPresentationDocument(db, USER_A, doc);

      await deleteFolderTree(db, USER_A, root.id);

      const tombstones = await getDriveTombstones(db, USER_A);
      expect(tombstones.folderIds.sort()).toEqual([root.id, child.id].sort());
      expect(tombstones.presentationIds).toEqual([doc.id]);
      expect(await getDriveTombstones(db, USER_B)).toEqual(NO_TOMBSTONES);
    });

    it("프레젠테이션 영구 삭제도 기록한다", async () => {
      const doc = makeDoc(USER_A, { trashedAt: TRASHED_AT });
      await upsertPresentationDocument(db, USER_A, doc);
      await deletePresentation(db, doc.id, USER_A);

      expect((await getDriveTombstones(db, USER_A)).presentationIds).toEqual([
        doc.id,
      ]);
    });

    it("영구 삭제한 id는 다시 저장해도 되살리지 않고 기록을 남긴다", async () => {
      const folder = makeFolder(USER_A, { trashedAt: TRASHED_AT });
      await upsertFolder(db, USER_A, folder);
      const doc = makeDoc(USER_A, { trashedAt: TRASHED_AT });
      await upsertPresentationDocument(db, USER_A, doc);
      await deleteFolderTree(db, USER_A, folder.id);
      await deletePresentation(db, doc.id, USER_A);

      expect(await upsertFolder(db, USER_A, folder)).toEqual({
        status: "deleted",
      });
      expect(
        await upsertFolder(db, USER_A, {
          ...folder,
          trashedAt: null,
          updatedAt: "2026-09-26T00:00:00.000Z",
        }),
      ).toEqual({ status: "deleted" });
      expect(await upsertPresentationDocument(db, USER_A, doc)).toBe(false);

      expect(await getDriveTombstones(db, USER_A)).toEqual({
        folderIds: [folder.id],
        presentationIds: [doc.id],
      });
      expect(await getFoldersByUserId(db, USER_A)).toEqual([]);
      expect(await getPresentationDocumentsByUserId(db, USER_A)).toEqual([]);
    });

    it("영구 삭제한 폴더도 내 영구 삭제 기록을 지우면 복구 스크립트가 다시 저장할 수 있다", async () => {
      const folder = makeFolder(USER_A, { trashedAt: TRASHED_AT });
      await upsertFolder(db, USER_A, folder);
      await deleteFolderTree(db, USER_A, folder.id);
      expect(await upsertFolder(db, USER_A, folder)).toEqual({
        status: "deleted",
      });

      const record = driveTombstonesCol(db).doc(folder.id);
      expect((await record.get()).data()).toEqual({
        itemId: folder.id,
        userId: USER_A,
        kind: "folder",
      });
      await record.delete();

      expect(await upsertFolder(db, USER_A, folder)).toEqual({
        status: "saved",
        folder,
      });
      expect(await getFoldersByUserId(db, USER_A)).toEqual([folder]);
      expect(await getDriveTombstones(db, USER_A)).toEqual(NO_TOMBSTONES);
    });

    it("폴더가 있으면 같은 id의 내 영구 삭제 기록을 지우고 저장한다", async () => {
      const folder = makeFolder(USER_A);
      await upsertFolder(db, USER_A, folder);
      await driveTombstonesCol(db)
        .doc(folder.id)
        .set({ itemId: folder.id, userId: USER_A, kind: "folder" });
      const renamed = { ...folder, name: "새 이름" };

      expect(await upsertFolder(db, USER_A, renamed)).toEqual({
        status: "saved",
        folder: renamed,
      });
      expect((await getDriveTombstones(db, USER_A)).folderIds).toEqual([]);
    });

    it("폴더가 있어도 같은 id의 남의 영구 삭제 기록은 지우지 않는다", async () => {
      const folder = makeFolder(USER_A);
      await upsertFolder(db, USER_A, folder);
      await driveTombstonesCol(db)
        .doc(folder.id)
        .set({ itemId: folder.id, userId: USER_B, kind: "folder" });
      const renamed = { ...folder, name: "새 이름" };

      expect(await upsertFolder(db, USER_A, renamed)).toEqual({
        status: "saved",
        folder: renamed,
      });
      expect((await getDriveTombstones(db, USER_B)).folderIds).toEqual([
        folder.id,
      ]);
    });

    it("내가 영구 삭제한 프레젠테이션의 id로는 폴더도 다시 만들지 않는다", async () => {
      const doc = makeDoc(USER_A, { trashedAt: TRASHED_AT });
      await upsertPresentationDocument(db, USER_A, doc);
      await deletePresentation(db, doc.id, USER_A);

      expect(
        await upsertFolder(db, USER_A, makeFolder(USER_A, { id: doc.id })),
      ).toEqual({ status: "deleted" });

      expect(await getFoldersByUserId(db, USER_A)).toEqual([]);
      expect(await getDriveTombstones(db, USER_A)).toEqual({
        folderIds: [],
        presentationIds: [doc.id],
      });
    });

    it("남이 같은 id로 만들고 지워도 내 영구 삭제 기록은 남는다", async () => {
      const theirs = makeDoc(USER_B, { trashedAt: TRASHED_AT });
      await upsertPresentationDocument(db, USER_B, theirs);
      expect(await deletePresentation(db, theirs.id, USER_B)).toEqual({
        status: "deleted",
      });

      const folder = makeFolder(USER_A, {
        id: theirs.id,
        trashedAt: TRASHED_AT,
      });
      expect(await upsertFolder(db, USER_A, folder)).toEqual({
        status: "saved",
        folder,
      });
      await upsertPresentationDocument(
        db,
        USER_A,
        makeDoc(USER_A, { id: theirs.id, trashedAt: TRASHED_AT }),
      );
      expect((await deleteFolderTree(db, USER_A, theirs.id)).status).toBe(
        "deleted",
      );
      expect(await deletePresentation(db, theirs.id, USER_A)).toEqual({
        status: "deleted",
      });

      expect(await getDriveTombstones(db, USER_B)).toEqual({
        folderIds: [],
        presentationIds: [theirs.id],
      });
    });

    it("in 조건 한도(30)를 넘는 항목을 지워도 모두 기록한다", async () => {
      const root = makeFolder(USER_A, { trashedAt: TRASHED_AT });
      await upsertFolder(db, USER_A, root);
      const children = Array.from({ length: 45 }, () =>
        makeFolder(USER_A, { parentId: root.id }),
      );
      for (const child of children) await upsertFolder(db, USER_A, child);

      const result = await deleteFolderTree(db, USER_A, root.id);
      expect(result.status === "deleted" && result.folderIds).toHaveLength(46);
      expect((await getDriveTombstones(db, USER_A)).folderIds).toHaveLength(46);
    });

    it("in 조건 한도(30)를 넘는 프레젠테이션을 담은 폴더도 사본 곡·공유 멤버까지 모두 지운다", async () => {
      const folder = makeFolder(USER_A, { trashedAt: TRASHED_AT });
      await upsertFolder(db, USER_A, folder);
      const seeded = presentationsWithCopies(USER_A, 31, 2, {
        folderId: folder.id,
      });
      await seedDocs(db, {
        ...seeded,
        members: seeded.presentations.map((presentation) => ({
          presentationId: presentation.id,
          userId: USER_B,
        })),
      });

      const result = await deleteFolderTree(db, USER_A, folder.id);

      expect(
        result.status === "deleted" && result.presentationIds,
      ).toHaveLength(31);
      expect(
        (await decksCol(db).where("userId", "==", USER_A).get()).size,
      ).toBe(0);
      expect(
        (await presentationMembersCol(db).where("userId", "==", USER_B).get())
          .size,
      ).toBe(0);
      expect(
        (await getDriveTombstones(db, USER_A)).presentationIds.sort(),
      ).toEqual(seeded.presentations.map((presentation) => presentation.id));
    });
  });
});
