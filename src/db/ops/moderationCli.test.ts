import { beforeEach, describe, expect, it } from "vitest";
import { API_ERRORS, OPS_ERRORS } from "#shared";
import {
  parseModerationArgs,
  runModeration,
} from "../../../scripts/lib/moderationCli.mjs";
import type { Db } from "../client";
import {
  COLLECTIONS,
  decksCol,
  moderationEventsCol,
  presentationsCol,
  reportsCol,
  usersCol,
} from "../collections";
import { setLinkAccess } from "../queries/presentationSharing";
import {
  createTestDb,
  deckDoc,
  presentationDoc,
  seedDocs,
  userDoc,
} from "../test/fixtures";
import * as ops from "./moderation";

const A = "00000000000000000000a";
const B = "00000000000000000000b";
const DECK = "c00000000000000000001";
const OTHER = "c00000000000000000002";
const B_DECK = "c00000000000000000003";
const PRESENTATION = "p00000000000000000001";

const SLIDES = JSON.stringify([{ id: "s", order: 0, lines: ["시선"] }]);

describe("moderation 명령줄", () => {
  let db: Db;
  let logs: string[];
  let warnings: string[];
  let tables: unknown[];

  const run = (...argv: string[]) =>
    runModeration(parseModerationArgs(argv), {
      db,
      ops,
      out: {
        log: (message: string) => logs.push(message),
        warn: (message: string) => warnings.push(message),
        table: (rows: unknown) => tables.push(rows),
      },
    });

  const report = async (id: string) => {
    const row = (await reportsCol(db).doc(id).get()).data();
    return { status: row?.status, resolutionNote: row?.resolutionNote };
  };
  const addReport = async (id: string, reporterId: string, deckId: string) => {
    await reportsCol(db)
      .doc(id)
      .set({
        id,
        reporterId,
        deckId,
        reason: "copyright",
        details: null,
        status: "pending",
        resolvedAt: null,
        resolutionNote: null,
        targetUserId: null,
        targetTitle: null,
        createdAt: new Date(0),
      });
  };
  const events = async () =>
    (await moderationEventsCol(db).get()).docs.map((doc) => doc.data());

  beforeEach(async () => {
    db = createTestDb();
    logs = [];
    warnings = [];
    tables = [];
    await seedDocs(db, {
      users: [userDoc({ id: A, name: "A" }), userDoc({ id: B, name: "B" })],
      decks: [
        deckDoc({
          id: DECK,
          userId: A,
          title: "시선",
          visibility: "public",
          slides: SLIDES,
        }),
        deckDoc({ id: OTHER, userId: A, title: "다른 곡", slides: SLIDES }),
        deckDoc({
          id: B_DECK,
          userId: B,
          title: "시선",
          visibility: "public",
          slides: SLIDES,
        }),
      ],
      presentations: [presentationDoc({ id: PRESENTATION, userId: A })],
    });
  });

  describe("입력 해석", () => {
    it("명령, id, 옵션을 나눈다", () => {
      expect(
        parseModerationArgs([
          "takedown",
          "a",
          "b",
          "--note=사유",
          "--target=remote",
        ]),
      ).toEqual({
        command: "takedown",
        ids: ["a", "b"],
        flags: { note: "사유", target: "remote" },
      });
    });

    it("모르는 명령이나 id 개수가 맞지 않는 입력은 연결하기 전에 멈춘다", () => {
      expect(() => parseModerationArgs([])).toThrow("명령");
      expect(() => parseModerationArgs(["purge", "a"])).toThrow("purge");
      expect(() => parseModerationArgs(["takedown"])).toThrow("id");
      expect(() => parseModerationArgs(["restore", "a", "b"])).toThrow("하나");
      expect(() => parseModerationArgs(["list", "a"])).toThrow("list");
    });

    it("명령에 맞지 않거나 값이 틀린 옵션은 받지 않는다", () => {
      expect(() => parseModerationArgs(["takedown", "a", "--force"])).toThrow(
        "--force",
      );
      expect(() => parseModerationArgs(["reject", "r", "--note"])).toThrow(
        "--note",
      );
      expect(() =>
        parseModerationArgs(["restore", "a", "--republish=yes"]),
      ).toThrow("--republish");
      expect(() => parseModerationArgs(["list", "--limit=0"])).toThrow(
        "--limit",
      );
      expect(() => parseModerationArgs(["list", "--limit=abc"])).toThrow(
        "--limit",
      );
      expect(() => parseModerationArgs(["list", "--tagret=remote"])).toThrow(
        "--tagret",
      );
    });
  });

  describe("list", () => {
    it("신고자와 곡 주인을 보여 주고 일부만 보이면 전체 수를 알려 준다", async () => {
      await addReport("r1", B, DECK);
      await addReport("r2", A, B_DECK);

      await run("list", "--limit=1");

      expect(logs[0]).toContain("2건 중");
      expect(tables).toEqual([
        [expect.objectContaining({ id: "r1", reporterId: B, targetUserId: A })],
      ]);
    });

    it("신고가 없으면 표 대신 안내한다", async () => {
      await run("list");

      expect(logs).toEqual(["처리 대기 신고가 없어요."]);
      expect(tables).toEqual([]);
    });
  });

  describe("takedown", () => {
    it("곡 여러 개를 한 번에 중단하고 걸린 신고를 닫는다", async () => {
      await addReport("r1", B, DECK);
      await addReport("r2", B, OTHER);

      await run("takedown", DECK, OTHER, "--note=권리자 요청");

      for (const id of [DECK, OTHER]) {
        const deck = (await decksCol(db).doc(id).get()).data();
        expect(deck).toMatchObject({ visibility: "private", listed: false });
        expect(deck?.takedownAt).not.toBeNull();
      }
      expect(await report("r1")).toEqual({
        status: "resolved",
        resolutionNote: "권리자 요청",
      });
      expect(logs.join("\n")).toContain("곡 2개");
      expect(logs.join("\n")).toContain("신고 2건");
      expect(warnings).toEqual([]);
    });

    it("닫을 신고가 없어도 사유를 운영 기록에 남긴다", async () => {
      await run("takedown", DECK, "--note=권리자 요청");

      expect(await events()).toEqual([
        expect.objectContaining({
          action: "takedown",
          deckId: DECK,
          cause: "direct",
          note: "권리자 요청",
        }),
      ]);
      expect(warnings).toEqual([]);
    });

    it("--with-forks면 가져간 곡도 중단하고 그 곡에 걸린 신고도 닫는다", async () => {
      const fork = "c00000000000000000009";
      await seedDocs(db, {
        decks: [
          deckDoc({
            id: fork,
            userId: B,
            visibility: "public",
            slides: SLIDES,
            forkedFrom: DECK,
            forkedFromAuthorName: "A",
          }),
        ],
      });
      await addReport("r1", A, fork);

      await run("takedown", DECK, "--with-forks", "--note=권리자 요청");

      expect((await decksCol(db).doc(fork).get()).data()).toMatchObject({
        listed: false,
      });
      expect(await report("r1")).toEqual({
        status: "resolved",
        resolutionNote: "권리자 요청",
      });
      expect(
        (await events()).find((event) => event.deckId === fork),
      ).toMatchObject({
        cause: "fork",
        sourceDeckId: DECK,
        note: "권리자 요청",
      });
      expect(logs.join("\n")).toContain("가져간 곡 1개");
    });

    it("보관함 곡이 아닌 id는 나머지를 처리한 뒤 실패로 알린다", async () => {
      await expect(run("takedown", "nope", DECK)).rejects.toThrow("nope");

      expect((await decksCol(db).doc(DECK).get()).data()?.listed).toBe(false);
    });
  });

  describe("계정 정리", () => {
    it("계정의 보관함 곡을 보여 준다", async () => {
      await run("user-decks", A);

      expect(tables).toEqual([
        expect.arrayContaining([
          expect.objectContaining({ id: DECK, listed: true }),
          expect.objectContaining({ id: OTHER, listed: false }),
        ]),
      ]);
    });

    it("계정마다 곡을 모두 중단하고 걸린 신고를 닫는다", async () => {
      await addReport("r1", B, DECK);

      await run("takedown-user", A, B, "--note=계정 정리");

      for (const id of [DECK, OTHER, B_DECK]) {
        const deck = (await decksCol(db).doc(id).get()).data();
        expect(deck?.takedownAt).not.toBeNull();
        expect(deck?.listed).toBe(false);
      }
      expect(await report("r1")).toEqual({
        status: "resolved",
        resolutionNote: "계정 정리",
      });
      expect(logs).toHaveLength(2);
      expect(warnings).toEqual([]);
    });

    it("계정마다 세션을 지운다", async () => {
      const sessions = db.collection(COLLECTIONS.sessions);
      await sessions.doc("sa").set({ id: "sa", userId: A });
      await sessions.doc("sb").set({ id: "sb", userId: B });

      await run("revoke-sessions", A);

      expect((await sessions.get()).docs.map((doc) => doc.id)).toEqual(["sb"]);
      expect(logs[0]).toContain("1개");
    });
  });

  describe("계정 제한", () => {
    it("계정을 제한하고 공개 중이던 곡의 신고를 닫는다", async () => {
      await addReport("r1", B, DECK);

      await run("ban", A, "--note=같은 곡 반복 게시");

      expect((await usersCol(db).doc(A).get()).data()?.bannedAt).toBeInstanceOf(
        Date,
      );
      expect((await decksCol(db).doc(DECK).get()).data()?.listed).toBe(false);
      expect(await report("r1")).toEqual({
        status: "resolved",
        resolutionNote: "같은 곡 반복 게시",
      });
      expect(tables).toEqual([[{ deckId: DECK }]]);
    });

    it("제한을 풀고, 없는 사용자는 실패로 알린다", async () => {
      await run("ban", A);

      await run("unban", A);

      expect((await usersCol(db).doc(A).get()).data()?.bannedAt).toBeNull();
      await expect(run("ban", "nobody")).rejects.toThrow("nobody");
      await expect(run("unban", "nobody")).rejects.toThrow("nobody");
    });
  });

  describe("restore", () => {
    it("--republish가 없으면 비공개로 남긴다", async () => {
      await run("takedown", DECK);

      await run("restore", DECK);

      const deck = (await decksCol(db).doc(DECK).get()).data();
      expect(deck).toMatchObject({ visibility: "private", listed: false });
      expect(deck?.takedownAt).toBeNull();
    });

    it("--republish면 다시 공개한다", async () => {
      await run("takedown", DECK);

      await run("restore", DECK, "--republish");

      expect((await decksCol(db).doc(DECK).get()).data()).toMatchObject({
        visibility: "public",
        listed: true,
        takedownAt: null,
      });
    });

    it("슬라이드가 없는 곡은 다시 공개하지 않는다", async () => {
      await seedDocs(db, {
        decks: [deckDoc({ id: "empty", userId: A, takedownAt: new Date(1) })],
      });

      await expect(run("restore", "empty", "--republish")).rejects.toThrow(
        API_ERRORS.deck.noSlides,
      );
    });

    it("보관함 곡이 아니면 실패한다", async () => {
      await expect(run("restore", "nope")).rejects.toThrow("nope");
    });

    describe("가져간 곡", () => {
      const FORK = "c00000000000000000004";

      beforeEach(async () => {
        await seedDocs(db, {
          decks: [
            deckDoc({
              id: FORK,
              userId: B,
              title: "시선",
              slides: SLIDES,
              forkedFrom: DECK,
            }),
          ],
        });
        await run("takedown", DECK, "--with-forks");
        logs = [];
      });

      it("원곡을 풀면 아직 게시 중단된 가져간 곡을 하나씩 풀라고 알린다", async () => {
        await run("restore", DECK);

        expect(logs.join("\n")).toContain("가져간 곡 1개는 아직 게시 중단돼");
        expect(logs.join("\n")).toContain(`descendants ${DECK}`);
        expect(warnings).toEqual([]);
      });

      it("가져간 곡만 풀면 원곡 때문에 공개하지 못한다고 알린다", async () => {
        await run("restore", FORK);

        expect(warnings).toEqual([expect.stringContaining(DECK)]);
        expect(
          (await decksCol(db).doc(FORK).get()).data()?.takedownAt,
        ).toBeNull();
      });

      it("원곡이 아직 게시 중단돼 있으면 --republish로도 공개하지 않는다", async () => {
        await expect(run("restore", FORK, "--republish")).rejects.toThrow(
          OPS_ERRORS.restore.sourceTakenDown,
        );

        expect((await decksCol(db).doc(FORK).get()).data()).toMatchObject({
          visibility: "private",
          listed: false,
        });
        expect(
          (await decksCol(db).doc(FORK).get()).data()?.takedownAt,
        ).not.toBeNull();
      });
    });
  });

  describe("신고 닫기", () => {
    it("이미 닫은 신고는 --force가 있어야 바로잡는다", async () => {
      await addReport("r1", B, DECK);
      await run("resolve", "r1", "--note=권리자 요청");

      await expect(run("reject", "r1", "--note=오타")).rejects.toThrow(
        OPS_ERRORS.report.alreadyResolved,
      );
      expect(await report("r1")).toEqual({
        status: "resolved",
        resolutionNote: "권리자 요청",
      });

      await run("reject", "r1", "--note=오타", "--force");
      expect(await report("r1")).toEqual({
        status: "rejected",
        resolutionNote: "오타",
      });
    });

    it("신고자 한 명의 대기 신고를 한 번에 기각한다", async () => {
      await addReport("r1", B, DECK);
      await addReport("r2", B, OTHER);
      await addReport("r3", A, B_DECK);

      await run("reject-by-reporter", B, "--note=도배");

      expect(await report("r1")).toEqual({
        status: "rejected",
        resolutionNote: "도배",
      });
      expect(await report("r2")).toEqual({
        status: "rejected",
        resolutionNote: "도배",
      });
      expect((await report("r3")).status).toBe("pending");
      expect(logs[0]).toContain("2건");
    });
  });

  describe("disable-link", () => {
    const share = async (): Promise<string> =>
      (await setLinkAccess(db, PRESENTATION, A, "view"))?.token as string;
    const linkOf = async () =>
      (await presentationsCol(db).doc(PRESENTATION).get()).data();

    it("프레젠테이션 id로 링크를 막는다", async () => {
      await share();

      await run("disable-link", PRESENTATION);

      expect(await linkOf()).toMatchObject({
        linkAccess: "off",
        linkToken: null,
      });
    });

    it("퍼진 /s/ 주소나 토큰만 있어도 링크를 막는다", async () => {
      const token = await share();
      await run("disable-link", `https://bangsongteam.example/s/${token}?a=1`);
      expect(await linkOf()).toMatchObject({ linkToken: null });

      const again = await share();
      await run("disable-link", again);
      expect(await linkOf()).toMatchObject({ linkToken: null });
    });

    it("없는 프레젠테이션은 나머지를 처리한 뒤 실패로 알린다", async () => {
      await share();

      await expect(run("disable-link", "nope", PRESENTATION)).rejects.toThrow(
        "nope",
      );
      expect(await linkOf()).toMatchObject({ linkToken: null });
    });
  });
});
