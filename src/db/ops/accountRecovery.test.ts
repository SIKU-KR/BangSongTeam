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
  reportsCol,
} from "../collections";
import { getMyLibraryDecks } from "../queries/decks";
import { getFoldersByUserId } from "../queries/folders";
import { getPresentationDocumentsByUserId } from "../queries/presentations";
import {
  createTestDb,
  deckDoc,
  folderDoc,
  presentationDoc,
  seedAccount,
  seedDocs,
  userDoc,
} from "../test/fixtures";
import { takedownDeck } from "./moderation";
import { countSocialOnlyUsers, reassignUserData } from "./accountRecovery";

const KAKAO_USER = "000000000000000kakao1";
const NAVER_USER = "000000000000000naver1";
const GOOGLE_USER = "00000000000000google1";
const EMAIL_USER = "000000000000000email1";
const SYNTHETIC_DOMAIN = "users.noreply.example";
const NOW = new Date("2026-10-27T00:00:00.000Z");

describe("카카오·네이버로만 들어오는 사용자 세기", () => {
  it("이메일 종류마다 나눠 센다", async () => {
    const db = createTestDb();
    await seedDocs(db, {
      users: [
        userDoc({ id: KAKAO_USER, email: `kakao_42@${SYNTHETIC_DOMAIN}` }),
        userDoc({ id: NAVER_USER, email: "naver@example.com" }),
        userDoc({
          id: GOOGLE_USER,
          email: "google@example.com",
          emailVerified: true,
        }),
        userDoc({ id: EMAIL_USER, email: "mail@example.com" }),
      ],
    });
    await seedAccount(db, KAKAO_USER, "kakao");
    await seedAccount(db, NAVER_USER, "naver");
    await seedAccount(db, GOOGLE_USER, "kakao");
    await seedAccount(db, GOOGLE_USER, "google");
    await seedAccount(db, EMAIL_USER, "credential");

    expect(
      await countSocialOnlyUsers(db, {
        syntheticEmailDomain: SYNTHETIC_DOMAIN,
      }),
    ).toEqual({
      total: 2,
      syntheticEmail: 1,
      verifiedEmail: 0,
      unverifiedEmail: 1,
      userIds: [KAKAO_USER, NAVER_USER],
    });
  });
});

describe("다른 계정으로 데이터 옮기기", () => {
  const A = "00000000000000000000a";
  const B = "00000000000000000000b";
  const O = "00000000000000000000o";
  const FOLDER = "f00000000000000000001";
  const OWN = "p00000000000000000001";
  const SHARED = "p00000000000000000002";
  const DECK = "c00000000000000000001";
  const FORK = "c00000000000000000002";
  const SLIDES = JSON.stringify([{ id: "s", order: 0, lines: ["시선"] }]);
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await seedDocs(db, {
      users: [
        userDoc({ id: A, name: "옛 계정" }),
        userDoc({ id: B, name: "새 계정" }),
        userDoc({ id: O, name: "다른 사람" }),
      ],
      folders: [folderDoc({ id: FOLDER, userId: A })],
      presentations: [
        presentationDoc({ id: OWN, userId: A, folderId: FOLDER }),
        presentationDoc({ id: SHARED, userId: O }),
      ],
      decks: [
        deckDoc({
          id: DECK,
          userId: A,
          title: "옮길 곡",
          visibility: "public",
          publishedAt: new Date(1),
          slides: SLIDES,
          forkCount: 1,
        }),
        deckDoc({ id: FORK, userId: O, forkedFrom: DECK, slides: SLIDES }),
        ...[0, 1].map((position) =>
          deckDoc({
            id: `copy-${position}`,
            userId: A,
            presentationId: OWN,
            itemId: `i${position}`,
            position,
            slides: SLIDES,
            forkedFrom: DECK,
          }),
        ),
      ],
      members: [
        { presentationId: OWN, userId: O },
        { presentationId: OWN, userId: B },
        { presentationId: SHARED, userId: A },
      ],
    });
    await Promise.all(
      [A, B].map((userId) =>
        db
          .collection(COLLECTIONS.sessions)
          .doc(`s-${userId}`)
          .set({ id: `s-${userId}`, userId }),
      ),
    );
    await driveTombstonesCol(db)
      .doc("gone")
      .set({ itemId: "gone", userId: A, kind: "presentation" });
    await reportsCol(db)
      .doc("r1")
      .set({
        id: "r1",
        reporterId: A,
        deckId: FORK,
        targetUserId: O,
        targetTitle: "song",
        reason: "lyrics_error",
        details: null,
        status: "pending",
        resolvedAt: null,
        resolutionNote: null,
        createdAt: new Date(2),
      });
  });

  it("미리보기는 옮길 데이터 수만 세고 아무것도 옮기지 않는다", async () => {
    expect(await reassignUserData(db, { fromUserId: A, toUserId: B })).toEqual({
      status: "ready",
      counts: {
        sessions: 1,
        folders: 1,
        presentations: 1,
        libraryDecks: 1,
        memberships: 1,
        tombstones: 1,
        reports: 1,
        reportTargets: 0,
        moderationEvents: 0,
      },
    });
    expect(await getMyLibraryDecks(db, B)).toEqual([]);
    expect(
      (await db.collection(COLLECTIONS.sessions).doc(`s-${A}`).get()).exists,
    ).toBe(true);
  });

  it("옛 계정의 세션만 끊고, 새 계정이 갖게 된 프레젠테이션의 멤버 기록은 지운다", async () => {
    const result = await reassignUserData(db, {
      fromUserId: A,
      toUserId: B,
      apply: true,
    });

    expect(result).toMatchObject({ status: "moved", counts: { sessions: 1 } });
    const session = (userId: string) =>
      db.collection(COLLECTIONS.sessions).doc(`s-${userId}`).get();
    expect((await session(A)).exists).toBe(false);
    expect((await session(B)).exists).toBe(true);
    const member = (userId: string) =>
      presentationMembersCol(db).doc(memberDocId(OWN, userId)).get();
    expect((await member(B)).exists).toBe(false);
    expect((await member(O)).exists).toBe(true);
  });

  it("폴더·프레젠테이션과 사본·보관함 곡을 새 계정으로 옮기고 색인과 가져간 횟수는 그대로 둔다", async () => {
    const before = (await decksCol(db).doc(DECK).get()).data();

    const result = await reassignUserData(db, {
      fromUserId: A,
      toUserId: B,
      apply: true,
    });

    expect(result.status).toBe("moved");
    expect(await getFoldersByUserId(db, A)).toEqual([]);
    expect(await getPresentationDocumentsByUserId(db, A)).toEqual([]);
    expect(await getMyLibraryDecks(db, A)).toEqual([]);
    expect((await getFoldersByUserId(db, B)).map((f) => f.id)).toEqual([
      FOLDER,
    ]);
    const [moved] = await getPresentationDocumentsByUserId(db, B);
    expect(moved).toMatchObject({ id: OWN, userId: B, folderId: FOLDER });
    expect(moved?.items.map((item) => item.deck.userId)).toEqual([B, B]);
    const deck = (await decksCol(db).doc(DECK).get()).data();
    expect(deck).toEqual({ ...before, userId: B });
    expect((await decksCol(db).doc(FORK).get()).data()?.forkedFrom).toBe(DECK);
  });

  it("링크로 들어간 프레젠테이션·영구 삭제 기록·신고도 새 계정으로 옮긴다", async () => {
    await reassignUserData(db, { fromUserId: A, toUserId: B, apply: true });

    const member = (id: string) => presentationMembersCol(db).doc(id).get();
    expect((await member(memberDocId(SHARED, A))).exists).toBe(false);
    expect((await member(memberDocId(SHARED, B))).data()).toEqual({
      presentationId: SHARED,
      userId: B,
    });
    expect((await member(memberDocId(OWN, O))).exists).toBe(true);
    expect(
      (await driveTombstonesCol(db).doc("gone").get()).data()?.userId,
    ).toBe(B);
    expect((await reportsCol(db).doc("r1").get()).data()?.reporterId).toBe(B);
  });

  it("옮긴 곡의 게시 중단 기록도 새 계정으로 옮기고, 다시 실행하면 옮길 것이 없다", async () => {
    await takedownDeck(db, DECK, NOW);

    await reassignUserData(db, { fromUserId: A, toUserId: B, apply: true });

    expect(
      (await moderationEventsCol(db).get()).docs.map(
        (doc) => doc.data().userId,
      ),
    ).toEqual([B]);
    expect(
      await reassignUserData(db, { fromUserId: A, toUserId: B, apply: true }),
    ).toEqual({
      status: "moved",
      counts: {
        sessions: 0,
        folders: 0,
        presentations: 0,
        libraryDecks: 0,
        memberships: 0,
        tombstones: 0,
        reports: 0,
        reportTargets: 0,
        moderationEvents: 0,
      },
    });
  });

  it("없거나 같은 계정, 공식 계정, 제한된 계정은 옮기지 않는다", async () => {
    await seedDocs(db, {
      users: [
        userDoc({ id: OFFICIAL_LIBRARY_USER_ID, name: OFFICIAL_LIBRARY_NAME }),
        userDoc({ id: O, name: "다른 사람", bannedAt: NOW }),
      ],
    });

    for (const [fromUserId, toUserId, status] of [
      ["000000000000000nobody", B, "not_found"],
      [A, "000000000000000nobody", "not_found"],
      [A, A, "same_user"],
      [OFFICIAL_LIBRARY_USER_ID, B, "official"],
      [A, OFFICIAL_LIBRARY_USER_ID, "official"],
      [O, B, "banned"],
      [A, O, "banned"],
    ] as const) {
      expect(
        await reassignUserData(db, { fromUserId, toUserId, apply: true }),
      ).toEqual({ status });
    }
    expect((await getMyLibraryDecks(db, A)).map((deck) => deck.id)).toEqual([
      DECK,
    ]);
  });
});
