import { describe, it, expect, beforeEach } from "vitest";
import { OFFICIAL_LIBRARY_NAME, OFFICIAL_LIBRARY_USER_ID } from "#shared";
import type { Db } from "../client";
import {
  COLLECTIONS,
  decksCol,
  driveTombstonesCol,
  memberDocId,
  moderationEventsCol,
  presentationMembersCol,
  presentationsCol,
  reportsCol,
  userEmailDocId,
  userEmailsCol,
} from "../collections";
import {
  createTestDb,
  deckDoc,
  folderDoc,
  presentationDoc,
  presentationsWithCopies,
  seedDocs,
  seedUserQuota,
  spawnScript,
  userDoc,
} from "../test/fixtures";
import { takedownDeck } from "./moderation";
import {
  countUserData,
  deleteUserData,
  getAccountIdentity,
  revokeUserAccess,
  type UserDataCounts,
} from "./deleteUser";

const U = "00000000000000000000u";
const O = "00000000000000000000o";
const D1 = "c0000000000000000000d";
const D2 = "c0000000000000000002d";
const F1 = "c0000000000000000000f";
const P1 = "c0000000000000000000p";
const C1 = "c0000000000000000000c";
const C2 = "c0000000000000000002c";
const F2 = "c0000000000000000002f";
const X1 = "p0000000000000000000x";
const Y1 = "p0000000000000000000y";
const G1 = "g0000000000000000000g";
const SLIDES = JSON.stringify([{ id: "s", order: 0, lines: ["시선"] }]);
const NOW = new Date("2026-10-27T00:00:00.000Z");
const JOINED_AT = new Date("2026-03-01T09:00:00.000Z");

const NOTHING: UserDataCounts = {
  user: 0,
  sessions: 0,
  accounts: 0,
  emailReservations: 0,
  presentations: 0,
  libraryDecks: 0,
  otherDecks: 0,
  folders: 0,
  memberships: 0,
  tombstones: 0,
  reports: 0,
  quotas: 0,
  forksByOthers: 0,
};

describe("계정 삭제", () => {
  let db: Db;

  const exists = async (collection: string, id: string) =>
    (await db.collection(collection).doc(id).get()).exists;
  const sizeByUser = async (collection: string) =>
    (await db.collection(collection).where("userId", "==", U).get()).size;

  beforeEach(async () => {
    db = createTestDb();
    const shared = {
      visibility: "public",
      publishedAt: new Date(1),
      slides: SLIDES,
    } as const;
    await seedDocs(db, {
      users: [
        userDoc({
          id: U,
          name: "지울 사람",
          email: "u@example.com",
          createdAt: JOINED_AT,
        }),
        userDoc({ id: O, name: "남을 사람", email: "o@example.com" }),
      ],
      folders: [folderDoc({ id: G1, userId: U })],
      presentations: [
        presentationDoc({ id: X1, userId: U, folderId: G1 }),
        presentationDoc({ id: Y1, userId: O }),
      ],
      decks: [
        deckDoc({
          ...shared,
          id: D1,
          userId: U,
          title: "지울 곡",
          forkCount: 1,
        }),
        deckDoc({
          id: F1,
          userId: O,
          title: "지울 곡",
          slides: SLIDES,
          forkedFrom: D1,
          forkedFromAuthorName: "지울 사람",
        }),
        deckDoc({
          ...shared,
          id: P1,
          userId: O,
          title: "남을 곡",
          forkCount: 1,
        }),
        deckDoc({
          id: D2,
          userId: U,
          title: "남을 곡",
          slides: SLIDES,
          forkedFrom: P1,
          forkedFromAuthorName: "남을 사람",
        }),
        deckDoc({
          id: C1,
          userId: U,
          presentationId: X1,
          itemId: "i1",
          position: 0,
          slides: SLIDES,
          forkedFrom: D1,
        }),
      ],
      members: [
        { presentationId: X1, userId: O },
        { presentationId: Y1, userId: U },
      ],
    });
    await Promise.all([
      db
        .collection(COLLECTIONS.sessions)
        .doc("s-u")
        .set({ id: "s-u", userId: U }),
      db
        .collection(COLLECTIONS.sessions)
        .doc("s-o")
        .set({ id: "s-o", userId: O }),
      db
        .collection(COLLECTIONS.accounts)
        .doc("a-u")
        .set({ id: "a-u", userId: U, providerId: "kakao", accountId: "1" }),
      db
        .collection(COLLECTIONS.accounts)
        .doc("a-o")
        .set({ id: "a-o", userId: O, providerId: "google", accountId: "2" }),
      userEmailsCol(db).doc(userEmailDocId("u@example.com")).set({ userId: U }),
      userEmailsCol(db).doc(userEmailDocId("o@example.com")).set({ userId: O }),
      driveTombstonesCol(db)
        .doc("gone")
        .set({ itemId: "gone", userId: U, kind: "folder" }),
      reportsCol(db)
        .doc("r1")
        .set({
          id: "r1",
          reporterId: U,
          deckId: P1,
          targetUserId: O,
          targetTitle: "남을 곡",
          reason: "lyrics_error",
          details: null,
          status: "pending",
          resolvedAt: null,
          resolutionNote: null,
          createdAt: new Date(2),
        }),
      seedUserQuota(db, U, NOW, { report: 1 }),
    ]);
  });

  it("지울 데이터를 세기만 하고 아무것도 바꾸지 않는다", async () => {
    expect(await countUserData(db, U)).toEqual({
      user: 1,
      sessions: 1,
      accounts: 1,
      emailReservations: 1,
      presentations: 1,
      libraryDecks: 2,
      otherDecks: 1,
      folders: 1,
      memberships: 1,
      tombstones: 1,
      reports: 1,
      quotas: 1,
      forksByOthers: 1,
    });
    expect(await exists(COLLECTIONS.users, U)).toBe(true);
    expect(await sizeByUser(COLLECTIONS.decks)).toBe(3);
  });

  it("먼저 로그인 수단을 지워 그 계정으로 다시 들어오지 못하게 한다", async () => {
    expect(await revokeUserAccess(db, U)).toEqual({
      status: "revoked",
      sessions: 1,
      accounts: 1,
      user: true,
    });

    expect(await sizeByUser(COLLECTIONS.sessions)).toBe(0);
    expect(await sizeByUser(COLLECTIONS.accounts)).toBe(0);
    expect(await exists(COLLECTIONS.users, U)).toBe(false);
    expect(
      (await userEmailsCol(db).doc(userEmailDocId("u@example.com")).get())
        .exists,
    ).toBe(false);
    expect(await sizeByUser(COLLECTIONS.decks)).toBe(3);
  });

  it("D1의 외래키가 하던 정리를 모두 하고 그 사용자를 가리키는 문서를 남기지 않는다", async () => {
    await revokeUserAccess(db, U);

    const result = await deleteUserData(db, U, NOW);

    expect(result).toMatchObject({ status: "deleted", remaining: NOTHING });
    for (const collection of [
      COLLECTIONS.sessions,
      COLLECTIONS.accounts,
      COLLECTIONS.decks,
      COLLECTIONS.presentations,
      COLLECTIONS.presentationMembers,
      COLLECTIONS.folders,
      COLLECTIONS.driveTombstones,
      COLLECTIONS.userQuotas,
    ]) {
      expect(await sizeByUser(collection), collection).toBe(0);
    }
    expect(await exists(COLLECTIONS.users, U)).toBe(false);
    expect((await decksCol(db).doc(F1).get()).data()).toMatchObject({
      forkedFrom: null,
      forkedFromAuthorName: "지울 사람",
    });
    expect((await decksCol(db).doc(P1).get()).data()?.forkCount).toBe(0);
    expect((await reportsCol(db).doc("r1").get()).data()).toMatchObject({
      reporterId: null,
      deckId: P1,
    });
    expect(
      (await presentationMembersCol(db).doc(memberDocId(X1, O)).get()).exists,
    ).toBe(false);
    expect(
      (await presentationMembersCol(db).doc(memberDocId(Y1, U)).get()).exists,
    ).toBe(false);
  });

  it("다른 사용자의 계정과 데이터는 그대로 둔다", async () => {
    await revokeUserAccess(db, U);
    await deleteUserData(db, U, NOW);

    expect(await exists(COLLECTIONS.users, O)).toBe(true);
    expect(await exists(COLLECTIONS.sessions, "s-o")).toBe(true);
    expect(await exists(COLLECTIONS.accounts, "a-o")).toBe(true);
    expect((await presentationsCol(db).doc(Y1).get()).exists).toBe(true);
    expect((await decksCol(db).doc(P1).get()).data()?.listed).toBe(true);
    expect(
      (
        await userEmailsCol(db).doc(userEmailDocId("o@example.com")).get()
      ).data(),
    ).toEqual({ userId: O });
  });

  it("로그인 수단을 먼저 지우지 않았어도 마지막에 함께 지우고, 다시 실행해도 된다", async () => {
    expect(await deleteUserData(db, U, NOW)).toMatchObject({
      status: "deleted",
      remaining: NOTHING,
    });

    expect(await deleteUserData(db, U, NOW)).toEqual({
      status: "deleted",
      before: NOTHING,
      remaining: NOTHING,
    });
  });

  it("사용자 문서가 먼저 지워졌어도 그 사용자를 가리키는 이메일 예약을 세고 지운다", async () => {
    await db.collection(COLLECTIONS.users).doc(U).delete();
    await userEmailsCol(db)
      .doc(userEmailDocId("old-u@example.com"))
      .set({ userId: U });

    expect(await deleteUserData(db, U, NOW)).toMatchObject({
      status: "deleted",
      before: { user: 0, emailReservations: 2 },
      remaining: NOTHING,
    });

    expect((await userEmailsCol(db).where("userId", "==", U).get()).size).toBe(
      0,
    );
    expect(
      (
        await userEmailsCol(db).doc(userEmailDocId("o@example.com")).get()
      ).data(),
    ).toEqual({ userId: O });
  });

  it("게시 중단 운영 기록은 남기고, 가져간 비공개 곡은 게시 중단을 이어받는다", async () => {
    await takedownDeck(db, D1, NOW, "권리자 요청");

    await deleteUserData(db, U, NOW);

    expect(
      (await moderationEventsCol(db).get()).docs
        .map((doc) => doc.data())
        .map(({ userId, deckId, cause }) => ({ userId, deckId, cause }))
        .sort((a, b) => String(a.userId).localeCompare(String(b.userId))),
    ).toEqual([
      { userId: O, deckId: F1, cause: "fork" },
      { userId: U, deckId: D1, cause: "direct" },
    ]);
    expect((await decksCol(db).doc(F1).get()).data()?.takedownAt).toEqual(NOW);
  });

  it("이미 없는 프레젠테이션을 가리키던 사본도 지우고, 그 사본을 가리키던 다른 사용자의 사본은 연결만 끊는다", async () => {
    await seedDocs(db, {
      decks: [
        deckDoc({
          id: C2,
          userId: U,
          presentationId: "p0000000000000000000z",
          itemId: "i2",
          position: 0,
          slides: SLIDES,
        }),
        deckDoc({
          id: F2,
          userId: O,
          presentationId: Y1,
          itemId: "i3",
          position: 0,
          slides: SLIDES,
          forkedFrom: C2,
        }),
      ],
    });

    expect(await deleteUserData(db, U, NOW)).toMatchObject({
      status: "deleted",
      before: { otherDecks: 2 },
      remaining: NOTHING,
    });

    expect((await decksCol(db).doc(C2).get()).exists).toBe(false);
    expect((await decksCol(db).doc(F2).get()).data()).toMatchObject({
      userId: O,
      presentationId: Y1,
      forkedFrom: null,
    });
  });

  it("in 조건 한도를 넘는 프레젠테이션과 사본도 모두 지운다", async () => {
    const many = presentationsWithCopies(U, 31, 2);
    await seedDocs(db, many);

    await deleteUserData(db, U, NOW);

    expect(await sizeByUser(COLLECTIONS.presentations)).toBe(0);
    expect(await sizeByUser(COLLECTIONS.decks)).toBe(0);
  });

  it("본인 확인에 견줄 계정 정보를 읽고, 없거나 Firestore가 예약한 꼴의 id는 없는 계정으로 본다", async () => {
    expect(await getAccountIdentity(db, U)).toEqual({
      name: "지울 사람",
      email: "u@example.com",
      createdAt: JOINED_AT,
    });
    expect(await getAccountIdentity(db, "000000000000000nobody")).toBeNull();
    expect(await getAccountIdentity(db, `__${"0".repeat(17)}__`)).toBeNull();
  });

  it("스크립트 미리보기는 누구의 계정인지와 지울 데이터 수를 보여 주고 아무것도 지우지 않는다", async () => {
    const result = await spawnScript(db, "deleteUser.mjs", [U]);

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      `계정: ${U} 지울 사람 · u@example.com · ${JOINED_AT.toISOString()} 가입`,
    );
    expect(result.stdout).toContain("이메일 예약: 1");
    expect(await countUserData(db, U)).toMatchObject({
      user: 1,
      emailReservations: 1,
      libraryDecks: 2,
    });
  }, 60_000);

  it("스크립트에 --apply를 붙이면 모두 지우고, 지운 뒤의 미리보기는 사용자 문서가 없다고 알린다", async () => {
    const applied = await spawnScript(db, "deleteUser.mjs", [U, "--apply"]);

    expect(applied.code, applied.stderr).toBe(0);
    expect(applied.stdout).toContain("계정과 데이터를 모두 지웠어요.");
    expect(await countUserData(db, U)).toEqual(NOTHING);

    const preview = await spawnScript(db, "deleteUser.mjs", [U]);
    expect(preview.stdout).toContain(`계정: ${U} (사용자 문서 없음)`);
  }, 60_000);

  it("공식 라이브러리 계정은 지우지 않는다", async () => {
    await seedDocs(db, {
      users: [
        userDoc({ id: OFFICIAL_LIBRARY_USER_ID, name: OFFICIAL_LIBRARY_NAME }),
      ],
    });

    expect(await revokeUserAccess(db, OFFICIAL_LIBRARY_USER_ID)).toEqual({
      status: "official",
    });
    expect(await deleteUserData(db, OFFICIAL_LIBRARY_USER_ID)).toEqual({
      status: "official",
    });
    expect(await exists(COLLECTIONS.users, OFFICIAL_LIBRARY_USER_ID)).toBe(
      true,
    );
  });
});
