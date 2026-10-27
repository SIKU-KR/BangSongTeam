import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Transaction } from "@google-cloud/firestore";
import { OFFICIAL_LIBRARY_NAME, OFFICIAL_LIBRARY_USER_ID } from "#shared";
import type { Db } from "../client";
import {
  COLLECTIONS,
  decksCol,
  moderationEventsCol,
  reportsCol,
  usersCol,
} from "../collections";
import { deleteDeckScoped } from "../queries/decks";
import { createReport } from "../queries/reports";
import { searchPublicDecks } from "../queries/search";
import { forkPublicDeck, setDeckVisibility } from "../queries/sharing";
import {
  createTestDb,
  deckDoc,
  presentationDoc,
  seedDocs,
  userDoc,
} from "../test/fixtures";
import {
  banUser,
  findBlockingSource,
  listDescendants,
  listPendingReports,
  rejectReport,
  resolveReport,
  resolveReportsForTarget,
  restoreDeck,
  takedownDeck,
  takedownForks,
  unbanUser,
} from "./moderation";

const A = "00000000000000000000a";
const B = "00000000000000000000b";
const C = "00000000000000000000c";
const NOBODY = "000000000000000000zzz";
const DECK = "c00000000000000000001";
const FORK = "c00000000000000000002";
const SLIDES = JSON.stringify([{ id: "s", order: 0, lines: ["시선"] }]);

describe("신고·게시 중단 운영 작업", () => {
  let db: Db;

  const deckState = async (id: string) => {
    const deck = (await decksCol(db).doc(id).get()).data();
    return { visibility: deck?.visibility, takedownAt: deck?.takedownAt };
  };
  const report = async (id: string) => {
    const row = (await reportsCol(db).doc(id).get()).data();
    return { status: row?.status, resolutionNote: row?.resolutionNote };
  };
  const events = async () =>
    (await moderationEventsCol(db).get()).docs
      .map((doc) => doc.data())
      .sort(
        (a, b) =>
          a.at.getTime() - b.at.getTime() || a.action.localeCompare(b.action),
      );

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    db = createTestDb();
    const deck = {
      title: "시선",
      visibility: "public",
      publishedAt: new Date(1000),
      slides: SLIDES,
    } as const;
    await seedDocs(db, {
      users: [
        userDoc({ id: A, name: "A" }),
        userDoc({ id: B, name: "B" }),
        userDoc({ id: C, name: "C" }),
      ],
      decks: [
        deckDoc({ ...deck, id: DECK, userId: A }),
        deckDoc({
          ...deck,
          id: FORK,
          userId: B,
          forkedFrom: DECK,
          forkedFromAuthorName: "A",
        }),
      ],
    });
    const legacy = {
      details: null,
      status: "pending",
      resolvedAt: null,
      resolutionNote: null,
    };
    await db
      .collection(COLLECTIONS.reports)
      .doc("r1")
      .set({
        ...legacy,
        id: "r1",
        reporterId: B,
        deckId: DECK,
        reason: "copyright",
        createdAt: new Date(0),
      });
    await db
      .collection(COLLECTIONS.reports)
      .doc("r2")
      .set({
        ...legacy,
        id: "r2",
        reporterId: A,
        deckId: FORK,
        reason: "lyrics_error",
        createdAt: new Date(1),
      });
  });

  it("lists pending reports with the target title and owner", async () => {
    const rows = await listPendingReports(db);
    expect(rows.map((r) => [r.id, r.targetTitle, r.targetUserId])).toEqual([
      ["r1", "시선", A],
      ["r2", "시선", B],
    ]);
  });

  it("지운 곡의 신고는 접수할 때 남긴 제목과 주인으로 보인다", async () => {
    const gone = "c00000000000000000003";
    await seedDocs(db, {
      decks: [
        deckDoc({
          id: gone,
          userId: C,
          title: "지울 곡",
          visibility: "public",
          slides: SLIDES,
        }),
      ],
    });
    const created = await createReport(db, B, {
      targetType: "deck",
      targetId: gone,
      reason: "copyright",
    });
    if (created.status !== "ok") throw new Error(created.status);
    expect(await deleteDeckScoped(db, gone, C)).toBe(true);

    const rows = await listPendingReports(db);
    expect(rows.find((row) => row.id === created.id)).toMatchObject({
      deckId: null,
      targetTitle: "지울 곡",
      targetUserId: C,
    });
  });

  it("takes a deck down, removes it from search and blocks republishing", async () => {
    expect(await takedownDeck(db, DECK)).toBe(true);
    const takenDown = await deckState(DECK);
    expect(takenDown.visibility).toBe("private");
    expect(takenDown.takedownAt).not.toBeNull();
    expect((await searchPublicDecks(db, "시선")).map((d) => d.id)).toEqual([
      FORK,
    ]);
    expect((await setDeckVisibility(db, A, DECK, "public")).status).toBe(
      "taken_down",
    );

    expect((await listDescendants(db, DECK)).map((r) => r.id)).toEqual([FORK]);

    await resolveReportsForTarget(db, DECK, "권리자 요청");
    expect(await report("r1")).toEqual({
      status: "resolved",
      resolutionNote: "권리자 요청",
    });

    await restoreDeck(db, DECK);
    expect(await deckState(DECK)).toEqual({
      visibility: "private",
      takedownAt: null,
    });
    expect((await setDeckVisibility(db, A, DECK, "public")).status).toBe("ok");
  });

  it("게시 중단은 운영 기록으로 남아 곡을 지워도 누구의 무슨 곡이었는지 남는다", async () => {
    const at = new Date("2026-09-23T00:00:00.000Z");
    expect(await takedownDeck(db, DECK, at, "권리자 요청")).toBe(true);
    expect(await deleteDeckScoped(db, DECK, A)).toBe(true);

    expect(await events()).toEqual([
      expect.objectContaining({
        action: "takedown",
        cause: "direct",
        sourceDeckId: null,
        note: "권리자 요청",
        userId: A,
        deckId: DECK,
        title: "시선",
        at,
      }),
    ]);
  });

  it("게시 중단을 풀어도 운영 기록에 남고, 사유가 없으면 null로 남긴다", async () => {
    await takedownDeck(db, DECK, new Date(1));
    await restoreDeck(db, DECK, new Date(2), "권리자 철회");

    expect(
      (await events()).map(({ action, cause, note }) => [action, cause, note]),
    ).toEqual([
      ["takedown", "direct", null],
      ["restore", "direct", "권리자 철회"],
    ]);
  });

  it("resolves or rejects single reports", async () => {
    await rejectReport(db, "r2", "오류 아님");
    expect((await report("r2")).status).toBe("rejected");
    await resolveReport(db, "r1", "처리");
    expect(await listPendingReports(db)).toHaveLength(0);
  });

  describe("가져간 곡", () => {
    const PRIVATE_FORK = "c00000000000000000004";
    const GRANDCHILD = "c00000000000000000005";
    const COPY = "c00000000000000000006";
    const GREAT_GRANDCHILD = "c00000000000000000007";

    async function seedForkTree(): Promise<void> {
      await seedDocs(db, {
        presentations: [presentationDoc({ id: "p1", userId: C })],
        decks: [
          deckDoc({
            id: PRIVATE_FORK,
            userId: C,
            title: "시선",
            slides: SLIDES,
            forkedFrom: DECK,
            forkedFromAuthorName: "A",
          }),
          deckDoc({
            id: GRANDCHILD,
            userId: C,
            title: "시선 (B 편곡)",
            slides: SLIDES,
            forkedFrom: FORK,
            forkedFromAuthorName: "B",
          }),
          deckDoc({
            id: COPY,
            userId: C,
            presentationId: "p1",
            itemId: "i1",
            position: 0,
            slides: SLIDES,
            forkedFrom: GRANDCHILD,
          }),
        ],
      });
    }

    it("원본이 게시 중단되면 가져간 곡을 공개하지 못하고, 원본을 풀면 다시 공개할 수 있다", async () => {
      const fork = await forkPublicDeck(db, C, DECK);
      if (fork.status !== "ok") throw new Error(fork.status);
      await takedownDeck(db, DECK);

      expect(
        (await setDeckVisibility(db, C, fork.deck.id, "public")).status,
      ).toBe("source_taken_down");
      expect((await searchPublicDecks(db, "시선")).map((d) => d.id)).toEqual([
        FORK,
      ]);

      await restoreDeck(db, DECK);
      expect(
        (await setDeckVisibility(db, C, fork.deck.id, "public")).status,
      ).toBe("ok");
    });

    it("원본이 게시 중단되면 가져간 곡을 다시 가져간 곡도 공개하지 못한다", async () => {
      const grandchild = await forkPublicDeck(db, C, FORK);
      if (grandchild.status !== "ok") throw new Error(grandchild.status);
      expect((await setDeckVisibility(db, B, FORK, "private")).status).toBe(
        "ok",
      );
      await takedownDeck(db, DECK);

      expect((await setDeckVisibility(db, B, FORK, "public")).status).toBe(
        "source_taken_down",
      );
      expect(
        (await setDeckVisibility(db, C, grandchild.deck.id, "public")).status,
      ).toBe("source_taken_down");
      expect(await searchPublicDecks(db, "시선")).toEqual([]);

      await restoreDeck(db, DECK);
      expect(
        (await setDeckVisibility(db, C, grandchild.deck.id, "public")).status,
      ).toBe("ok");
    });

    it("가져간 곡을 여러 번 거쳐 가져온 곡도 맨 처음 원본이 게시 중단되면 공개하지 못한다", async () => {
      await seedForkTree();
      await seedDocs(db, {
        decks: [
          deckDoc({
            id: GREAT_GRANDCHILD,
            userId: B,
            slides: SLIDES,
            forkedFrom: GRANDCHILD,
            forkedFromAuthorName: "C",
          }),
        ],
      });
      await takedownDeck(db, DECK);

      expect(
        (await setDeckVisibility(db, B, GREAT_GRANDCHILD, "public")).status,
      ).toBe("source_taken_down");
    });

    it("가져간 곡의 게시 중단만 풀면 원본이 아직 게시 중단돼 있어 공개하지 못하고, 무엇이 막는지 알려 준다", async () => {
      const fork = await forkPublicDeck(db, C, DECK);
      if (fork.status !== "ok") throw new Error(fork.status);
      await takedownDeck(db, DECK);
      await takedownForks(db, DECK);

      expect(await restoreDeck(db, fork.deck.id)).toBe(true);

      expect(await findBlockingSource(db, fork.deck.id)).toBe(DECK);
      expect(
        (await listDescendants(db, DECK)).find(
          (deck) => deck.id === fork.deck.id,
        ),
      ).toMatchObject({ takenDown: false, blockedBy: DECK });
      expect(
        (await setDeckVisibility(db, C, fork.deck.id, "public")).status,
      ).toBe("source_taken_down");
    });

    it("가져간 곡마다 공개를 막는 가장 가까운 게시 중단된 원본을 알려 준다", async () => {
      await seedForkTree();
      await takedownDeck(db, DECK);
      await takedownForks(db, DECK);
      await restoreDeck(db, DECK);
      await restoreDeck(db, PRIVATE_FORK);

      const found = await listDescendants(db, DECK);

      expect(
        Object.fromEntries(
          found.map((deck) => [deck.id, [deck.takenDown, deck.blockedBy]]),
        ),
      ).toEqual({
        [FORK]: [true, null],
        [PRIVATE_FORK]: [false, null],
        [GRANDCHILD]: [true, FORK],
      });
      expect(await findBlockingSource(db, GRANDCHILD)).toBe(FORK);
      expect(await findBlockingSource(db, PRIVATE_FORK)).toBeNull();
      expect(await findBlockingSource(db, NOBODY)).toBeNull();
    });

    it("게시 중단한 곡을 주인이 지워도 가져간 비공개 곡은 공개하지 못하고, 공개 중인 곡은 그대로 둔다", async () => {
      const fork = await forkPublicDeck(db, C, DECK);
      if (fork.status !== "ok") throw new Error(fork.status);
      const at = new Date("2026-09-23T00:00:00.000Z");
      const deletedAt = new Date("2026-09-24T00:00:00.000Z");
      await takedownDeck(db, DECK, at);

      expect(await deleteDeckScoped(db, DECK, A, deletedAt)).toBe(true);

      expect(await deckState(fork.deck.id)).toEqual({
        visibility: "private",
        takedownAt: at,
      });
      expect(
        (await setDeckVisibility(db, C, fork.deck.id, "public")).status,
      ).toBe("taken_down");
      expect((await decksCol(db).doc(FORK).get()).data()).toMatchObject({
        forkedFrom: null,
        listed: true,
        takedownAt: null,
      });
      expect((await events()).filter((event) => event.deckId !== DECK)).toEqual(
        [
          expect.objectContaining({
            action: "takedown",
            cause: "fork",
            sourceDeckId: DECK,
            note: null,
            userId: C,
            deckId: fork.deck.id,
            title: "시선",
            at: deletedAt,
          }),
        ],
      );
    });

    it("가져간 곡을 지우면, 거기서 다시 가져간 비공개 곡이 게시 중단된 맨 처음 원본을 이어받는다", async () => {
      const grandchild = await forkPublicDeck(db, C, FORK);
      if (grandchild.status !== "ok") throw new Error(grandchild.status);
      await setDeckVisibility(db, B, FORK, "private");
      const at = new Date("2026-09-23T00:00:00.000Z");
      await takedownDeck(db, DECK, at);

      expect(await deleteDeckScoped(db, FORK, B)).toBe(true);

      expect(await deckState(grandchild.deck.id)).toEqual({
        visibility: "private",
        takedownAt: at,
      });
      expect(
        (await setDeckVisibility(db, C, grandchild.deck.id, "public")).status,
      ).toBe("taken_down");
      expect(
        (await events()).find((event) => event.deckId === grandchild.deck.id),
      ).toMatchObject({ cause: "fork", sourceDeckId: DECK, userId: C });
    });

    it("게시 중단 시각을 이어받는 곡은 문서를 통째로 다시 쓰지 않고 바뀌는 필드만 고친다", async () => {
      const fork = await forkPublicDeck(db, C, DECK);
      if (fork.status !== "ok") throw new Error(fork.status);
      const at = new Date("2026-09-23T00:00:00.000Z");
      await takedownDeck(db, DECK, at);
      const forkRef = decksCol(db).doc(fork.deck.id);
      const before = (await forkRef.get()).data();
      const set = vi.spyOn(Transaction.prototype, "set");

      expect(await deleteDeckScoped(db, DECK, A)).toBe(true);

      expect(set.mock.calls.map(([ref]) => ref.path)).not.toContain(
        forkRef.path,
      );
      expect((await forkRef.get()).data()).toEqual({
        ...before,
        forkedFrom: null,
        takedownAt: at,
        listed: false,
        searchGrams: [],
      });
    });

    it("게시 중단하지 않은 곡을 지우면 가져간 곡은 그대로 공개할 수 있다", async () => {
      const fork = await forkPublicDeck(db, C, DECK);
      if (fork.status !== "ok") throw new Error(fork.status);

      expect(await deleteDeckScoped(db, DECK, A)).toBe(true);

      expect(
        (await setDeckVisibility(db, C, fork.deck.id, "public")).status,
      ).toBe("ok");
    });

    it("공개 여부와 상관없이 가져간 곡을 다시 가져간 곡까지 찾고 프레젠테이션 사본은 뺀다", async () => {
      await seedForkTree();

      const found = await listDescendants(db, DECK);

      expect([...found].sort((a, b) => a.id.localeCompare(b.id))).toEqual([
        {
          id: FORK,
          userId: B,
          title: "시선",
          forkedFrom: DECK,
          listed: true,
          takenDown: false,
          blockedBy: null,
        },
        {
          id: PRIVATE_FORK,
          userId: C,
          title: "시선",
          forkedFrom: DECK,
          listed: false,
          takenDown: false,
          blockedBy: null,
        },
        {
          id: GRANDCHILD,
          userId: C,
          title: "시선 (B 편곡)",
          forkedFrom: FORK,
          listed: false,
          takenDown: false,
          blockedBy: null,
        },
      ]);
    });

    it("가져간 곡을 모두 게시 중단하고 원본 때문에 막은 곡으로 기록한다", async () => {
      await seedForkTree();

      await takedownForks(db, DECK, new Date(), "권리자 요청");

      expect(
        (await events())
          .map(({ action, deckId, userId, cause, sourceDeckId, note }) => ({
            action,
            deckId,
            userId,
            cause,
            sourceDeckId,
            note,
          }))
          .sort((a, b) => String(a.deckId).localeCompare(String(b.deckId))),
      ).toEqual(
        [
          [FORK, B],
          [PRIVATE_FORK, C],
          [GRANDCHILD, C],
        ].map(([deckId, userId]) => ({
          action: "takedown",
          deckId,
          userId,
          cause: "fork",
          sourceDeckId: DECK,
          note: "권리자 요청",
        })),
      );
    });

    it("가져간 곡을 모두 게시 중단하고 사본은 지우지 않는다", async () => {
      await seedForkTree();

      const ids = await takedownForks(db, DECK);

      expect([...ids].sort()).toEqual([FORK, PRIVATE_FORK, GRANDCHILD].sort());
      for (const id of ids) {
        expect(await deckState(id)).toEqual({
          visibility: "private",
          takedownAt: expect.any(Date),
        });
      }
      expect((await searchPublicDecks(db, "시선")).map((d) => d.id)).toEqual([
        DECK,
      ]);
      expect(
        (await setDeckVisibility(db, C, GRANDCHILD, "public")).status,
      ).toBe("taken_down");
      expect((await decksCol(db).doc(COPY).get()).data()).toMatchObject({
        takedownAt: null,
      });
      expect(await takedownForks(db, DECK)).toEqual([]);
    });
  });

  describe("계정 제한", () => {
    const PRIVATE = "c00000000000000000010";
    const COPY = "c00000000000000000011";

    const session = (id: string, userId: string) =>
      db
        .collection(COLLECTIONS.sessions)
        .doc(id)
        .set({
          id,
          userId,
          token: id,
          expiresAt: new Date(Date.now() + 86_400_000),
        });
    const bannedAt = async (id: string) =>
      (await usersCol(db).doc(id).get()).data()?.bannedAt;

    beforeEach(async () => {
      await seedDocs(db, {
        presentations: [presentationDoc({ id: "p1", userId: A })],
        decks: [
          deckDoc({ id: PRIVATE, userId: A, title: "비공개", slides: SLIDES }),
          deckDoc({
            id: COPY,
            userId: A,
            presentationId: "p1",
            itemId: "i1",
            position: 0,
            slides: SLIDES,
            forkedFrom: DECK,
          }),
        ],
      });
      await Promise.all([session("s1", A), session("s2", A), session("s3", B)]);
    });

    it("공개 중인 곡을 게시 중단하고 세션을 끊으며 공개·가져오기·신고를 막는다", async () => {
      const at = new Date("2026-10-27T00:00:00.000Z");

      expect(await banUser(db, A, at, "같은 곡 반복 게시")).toEqual({
        status: "banned",
        takenDownDeckIds: [DECK],
        revokedSessions: 2,
      });

      expect(await bannedAt(A)).toEqual(at);
      expect(await deckState(DECK)).toEqual({
        visibility: "private",
        takedownAt: at,
      });
      expect(await deckState(PRIVATE)).toEqual({
        visibility: "private",
        takedownAt: null,
      });
      expect((await decksCol(db).doc(FORK).get()).data()?.listed).toBe(true);
      expect(
        (await db.collection(COLLECTIONS.sessions).get()).docs.map(
          (doc) => doc.id,
        ),
      ).toEqual(["s3"]);
      expect((await setDeckVisibility(db, A, PRIVATE, "public")).status).toBe(
        "banned",
      );
      expect((await forkPublicDeck(db, A, FORK)).status).toBe("banned");
      expect(
        (
          await createReport(db, A, {
            targetType: "deck",
            targetId: FORK,
            reason: "inappropriate",
          })
        ).status,
      ).toBe("banned");
      expect(
        (await events()).map(({ action, deckId, cause, note }) => [
          action,
          deckId,
          cause,
          note,
        ]),
      ).toEqual([
        ["ban", null, "direct", "같은 곡 반복 게시"],
        ["takedown", DECK, "ban", "같은 곡 반복 게시"],
      ]);
    });

    it("공식 라이브러리 계정은 제한하지 않는다", async () => {
      const official = "c00000000000000000012";
      await seedDocs(db, {
        users: [
          userDoc({
            id: OFFICIAL_LIBRARY_USER_ID,
            name: OFFICIAL_LIBRARY_NAME,
          }),
        ],
        decks: [
          deckDoc({
            id: official,
            userId: OFFICIAL_LIBRARY_USER_ID,
            visibility: "public",
            slides: SLIDES,
          }),
        ],
      });

      expect(await banUser(db, OFFICIAL_LIBRARY_USER_ID)).toEqual({
        status: "official",
      });

      expect(await bannedAt(OFFICIAL_LIBRARY_USER_ID)).toBeNull();
      expect((await decksCol(db).doc(official).get()).data()?.listed).toBe(
        true,
      );
      expect(await events()).toEqual([]);
    });

    it("다시 제한해도 처음 제한한 시각을 지키고, 없는 사용자는 not_found다", async () => {
      const first = new Date(1000);
      await banUser(db, A, first);

      expect(await banUser(db, A, new Date(2000))).toEqual({
        status: "banned",
        takenDownDeckIds: [],
        revokedSessions: 0,
      });
      expect(await bannedAt(A)).toEqual(first);
      expect(
        (await events()).filter((event) => event.action === "ban"),
      ).toHaveLength(1);
      expect(await banUser(db, NOBODY)).toEqual({ status: "not_found" });
    });

    it("제한을 풀면 다시 공개할 수 있고, 게시 중단한 곡은 그대로 둔다", async () => {
      await banUser(db, A, new Date(1));

      expect(await unbanUser(db, A, new Date(2))).toBe(true);

      expect(await bannedAt(A)).toBeNull();
      expect((await setDeckVisibility(db, A, PRIVATE, "public")).status).toBe(
        "ok",
      );
      expect((await setDeckVisibility(db, A, DECK, "public")).status).toBe(
        "taken_down",
      );
      expect((await events()).map((event) => event.action)).toEqual([
        "ban",
        "takedown",
        "unban",
      ]);
      expect(await unbanUser(db, NOBODY)).toBe(false);
    });
  });
});
