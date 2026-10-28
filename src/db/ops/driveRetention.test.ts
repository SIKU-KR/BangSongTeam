import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DocumentReference } from "@google-cloud/firestore";
import { OPS_ERRORS } from "#shared";
import type { Db } from "../client";
import {
  decksCol,
  driveTombstonesCol,
  foldersCol,
  presentationMembersCol,
  presentationsCol,
  memberDocId,
} from "../collections";
import {
  createTestDb,
  deckDoc,
  folderDoc,
  presentationDoc,
  seedDocs,
  spawnScript,
  userDoc,
} from "../test/fixtures";
import {
  DEFAULT_TOMBSTONE_RETENTION_DAYS,
  DEFAULT_TRASH_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  pruneDriveRetention,
} from "./driveRetention";

const OWNER = "00000000000000000000r";
const MEMBER = "00000000000000000000m";
const DAY = 24 * 60 * 60 * 1000;

const OLD_FOLDER = "f00000000000000000old";
const OLD_CHILD = "f000000000000000child";
const IN_OLD_FOLDER = "p00000000000000infold";
const RECENT_FOLDER = "f00000000000000recent";
const OLD_PRESENTATION = "p00000000000000000old";
const RECENT_PRESENTATION = "p000000000000000recnt";
const KEPT_PRESENTATION = "p000000000000000kept0";
const OLD_TOMBSTONE = "p00000000000000tombst";

describe("pruneDriveRetention", () => {
  let db: Db;
  let now: Date;

  const exists = async (
    collection: typeof foldersCol | typeof presentationsCol,
    id: string,
  ) => (await collection(db).doc(id).get()).exists;
  const tombstoneExists = async (id: string) =>
    (await driveTombstonesCol(db).doc(id).get()).exists;
  const copiesOf = async (presentationId: string) =>
    (await decksCol(db).where("presentationId", "==", presentationId).get())
      .size;

  function daysAgo(days: number): Date {
    return new Date(now.getTime() - days * DAY);
  }

  beforeEach(async () => {
    db = createTestDb();
    now = new Date(Date.now() + (DEFAULT_TOMBSTONE_RETENTION_DAYS + 20) * DAY);
    await seedDocs(db, {
      users: [userDoc({ id: OWNER }), userDoc({ id: MEMBER })],
      folders: [
        folderDoc({ id: OLD_FOLDER, userId: OWNER, trashedAt: daysAgo(120) }),
        folderDoc({
          id: OLD_CHILD,
          userId: OWNER,
          parentId: OLD_FOLDER,
          trashedAt: daysAgo(100),
        }),
        folderDoc({
          id: RECENT_FOLDER,
          userId: OWNER,
          trashedAt: daysAgo(10),
        }),
      ],
      presentations: [
        presentationDoc({
          id: IN_OLD_FOLDER,
          userId: OWNER,
          folderId: OLD_CHILD,
        }),
        presentationDoc({
          id: OLD_PRESENTATION,
          userId: OWNER,
          folderId: RECENT_FOLDER,
          trashedAt: daysAgo(DEFAULT_TRASH_RETENTION_DAYS + 1),
          linkAccess: "view",
          linkToken: "token-old",
        }),
        presentationDoc({
          id: RECENT_PRESENTATION,
          userId: OWNER,
          trashedAt: daysAgo(DEFAULT_TRASH_RETENTION_DAYS - 1),
        }),
        presentationDoc({ id: KEPT_PRESENTATION, userId: OWNER }),
      ],
      decks: [
        deckDoc({
          id: "c00000000000000infold",
          userId: OWNER,
          presentationId: IN_OLD_FOLDER,
          itemId: "i00000000000000infold",
          position: 0,
        }),
        deckDoc({
          id: "c00000000000000000old",
          userId: OWNER,
          presentationId: OLD_PRESENTATION,
          itemId: "i00000000000000000old",
          position: 0,
        }),
      ],
      members: [{ presentationId: OLD_PRESENTATION, userId: MEMBER }],
    });
    await driveTombstonesCol(db)
      .doc(OLD_TOMBSTONE)
      .set({ itemId: OLD_TOMBSTONE, userId: OWNER, kind: "presentation" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("미리보기는 휴지통에 오래 둔 항목과 오래된 영구 삭제 기록만 찾고 아무것도 지우지 않는다", async () => {
    const report = await pruneDriveRetention(db, { now });

    expect(report.folders.map((item) => item.id).sort()).toEqual(
      [OLD_CHILD, OLD_FOLDER].sort(),
    );
    expect(report.presentations).toEqual([
      { id: OLD_PRESENTATION, userId: OWNER },
    ]);
    expect(report.tombstones).toEqual([OLD_TOMBSTONE]);
    expect(report.skipped).toEqual([]);
    expect(await exists(foldersCol, OLD_FOLDER)).toBe(true);
    expect(await exists(presentationsCol, OLD_PRESENTATION)).toBe(true);
    expect(await tombstoneExists(OLD_TOMBSTONE)).toBe(true);
  });

  it("적용하면 오래된 휴지통을 영구 삭제 흐름으로 지우고, 최근 휴지통과 휴지통 밖 항목은 남긴다", async () => {
    await pruneDriveRetention(db, { now, apply: true });

    for (const id of [OLD_FOLDER, OLD_CHILD]) {
      expect(await exists(foldersCol, id)).toBe(false);
    }
    expect(await exists(presentationsCol, IN_OLD_FOLDER)).toBe(false);
    expect(await exists(presentationsCol, OLD_PRESENTATION)).toBe(false);
    expect(await copiesOf(IN_OLD_FOLDER)).toBe(0);
    expect(await copiesOf(OLD_PRESENTATION)).toBe(0);
    expect(
      (
        await presentationMembersCol(db)
          .doc(memberDocId(OLD_PRESENTATION, MEMBER))
          .get()
      ).exists,
    ).toBe(false);

    expect(await exists(foldersCol, RECENT_FOLDER)).toBe(true);
    expect(await exists(presentationsCol, RECENT_PRESENTATION)).toBe(true);
    expect(await exists(presentationsCol, KEPT_PRESENTATION)).toBe(true);
  });

  it("적용하면 오래된 영구 삭제 기록은 지우고, 이번에 지우며 남긴 기록은 다른 기기가 볼 수 있게 남긴다", async () => {
    await pruneDriveRetention(db, { now, apply: true });

    expect(await tombstoneExists(OLD_TOMBSTONE)).toBe(false);
    for (const id of [OLD_FOLDER, OLD_CHILD, IN_OLD_FOLDER, OLD_PRESENTATION]) {
      expect(await tombstoneExists(id)).toBe(true);
    }
  });

  it("오래된 기록과 같은 id의 항목을 이번에 지우면 그 삭제의 기록을 남긴다", async () => {
    await driveTombstonesCol(db)
      .doc(OLD_PRESENTATION)
      .set({ itemId: OLD_PRESENTATION, userId: OWNER, kind: "presentation" });

    const report = await pruneDriveRetention(db, { now, apply: true });

    expect(report.tombstones).toContain(OLD_PRESENTATION);
    expect(await exists(presentationsCol, OLD_PRESENTATION)).toBe(false);
    expect(await tombstoneExists(OLD_PRESENTATION)).toBe(true);
  });

  it("찾은 뒤 지우기 전에 다시 쓰인 영구 삭제 기록은 지우지 않는다", async () => {
    const remove = DocumentReference.prototype.delete;
    vi.spyOn(DocumentReference.prototype, "delete").mockImplementation(
      async function (this: DocumentReference, precondition) {
        if (this.id === OLD_TOMBSTONE) {
          await this.set({
            itemId: OLD_TOMBSTONE,
            userId: MEMBER,
            kind: "folder",
          });
        }
        return remove.call(this, precondition);
      },
    );

    const report = await pruneDriveRetention(db, { now, apply: true });

    expect(report.skipped).toEqual([OLD_TOMBSTONE]);
    expect(await tombstoneExists(OLD_TOMBSTONE)).toBe(true);
  });

  it("보관 기간 안의 영구 삭제 기록은 남긴다", async () => {
    const report = await pruneDriveRetention(db, {
      now: new Date(),
      apply: true,
    });

    expect(report.tombstones).toEqual([]);
    expect(await tombstoneExists(OLD_TOMBSTONE)).toBe(true);
  });

  it("보관 기간을 바꿔 줄 수 있다", async () => {
    const report = await pruneDriveRetention(db, {
      now,
      trashDays: 110,
      tombstoneDays: DEFAULT_TOMBSTONE_RETENTION_DAYS + 30,
    });

    expect(report.folders.map((item) => item.id)).toEqual([OLD_FOLDER]);
    expect(report.presentations).toEqual([]);
    expect(report.tombstones).toEqual([]);
  });

  it(`보관 기간이 ${MIN_RETENTION_DAYS}일보다 짧거나 정수가 아니면 아무것도 읽지 않고 거절한다`, async () => {
    for (const days of [MIN_RETENTION_DAYS - 1, 45.5, Number.NaN]) {
      await expect(
        pruneDriveRetention(db, { now, apply: true, trashDays: days }),
      ).rejects.toThrow(OPS_ERRORS.retention.daysTooShort(MIN_RETENTION_DAYS));
      await expect(
        pruneDriveRetention(db, { now, apply: true, tombstoneDays: days }),
      ).rejects.toThrow(OPS_ERRORS.retention.daysTooShort(MIN_RETENTION_DAYS));
    }
    expect(await exists(foldersCol, OLD_FOLDER)).toBe(true);
  });

  it("스크립트는 기본이 미리보기라 무엇을 지울지만 보여 주고 아무것도 지우지 않는다", async () => {
    const result = await spawnScript(db, "driveRetention.mjs", []);

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("대상: 로컬 에뮬레이터");
    expect(result.stdout).toContain("미리보기라 아무것도 지우지 않았어요");
    expect(await exists(presentationsCol, OLD_PRESENTATION)).toBe(true);
  }, 60_000);

  it("스크립트는 모르는 옵션과 짧은 보관 기간을 거절한다", async () => {
    const typo = await spawnScript(db, "driveRetention.mjs", ["--aply"]);
    const short = await spawnScript(db, "driveRetention.mjs", [
      "--apply",
      "--trash-days=7",
    ]);

    expect(typo.code).toBe(1);
    expect(typo.stderr).toContain("모르는 옵션이에요: --aply");
    expect(short.code).toBe(1);
    expect(short.stderr).toContain(
      OPS_ERRORS.retention.daysTooShort(MIN_RETENTION_DAYS),
    );
    expect(await exists(presentationsCol, OLD_PRESENTATION)).toBe(true);
  }, 60_000);
});
