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
  presentationMembersCol,
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
const BOT = "bot-seed-official-lib";
const DECK = "c00000000000000000001";
const OTHER = "c00000000000000000002";
const B_DECK = "c00000000000000000003";
const PUBLIC_TAKEN_DOWN = "c00000000000000000004";
const PRESENTATION = "p00000000000000000001";
const OTHER_PRESENTATION = "p00000000000000000002";
const DASHED = `--${"x8Jk".padEnd(19, "0")}`;

const SLIDES = JSON.stringify([{ id: "s", order: 0, lines: ["시선"] }]);

describe("moderation 명령줄", () => {
  let db: Db;
  let logs: string[];
  let warnings: string[];
  let tables: unknown[];

  const runWith = (commandOps: typeof ops, ...argv: string[]) =>
    runModeration(parseModerationArgs(argv), {
      db,
      ops: commandOps,
      out: {
        log: (message: string) => logs.push(message),
        warn: (message: string) => warnings.push(message),
        table: (rows: unknown) => tables.push(rows),
      },
    });
  const run = (...argv: string[]) => runWith(ops, ...argv);

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

    it("--로 시작하는 id도 id로 읽고 옵션 오타는 계속 막는다", () => {
      expect(DASHED).toHaveLength(21);
      expect(
        parseModerationArgs(["takedown", DASHED, "b", "--note=사유"]),
      ).toEqual({
        command: "takedown",
        ids: [DASHED, "b"],
        flags: { note: "사유" },
      });
      expect(() => parseModerationArgs(["takedown", "a", "--forse"])).toThrow(
        "--forse",
      );
    });

    it("붙여 넣은 id 앞뒤의 공백·줄바꿈·폭 없는 문자를 지우고 빈 인자는 버린다", () => {
      expect(
        parseModerationArgs([
          "takedown-user",
          ` ${A}\r`,
          `\u200b${B}\ufeff`,
          `${DASHED}\r`,
          "\r",
          "\u3000",
          "--note=계정 정리\r",
        ]),
      ).toEqual({
        command: "takedown-user",
        ids: [A, B, DASHED],
        flags: { note: "계정 정리" },
      });
      expect(() => parseModerationArgs(["restore", " \r"])).toThrow("id");
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

    it("주소를 붙여 넣는 등 곡 id가 아닌 값이 섞여도 나머지를 처리하고 그 값을 알린다", async () => {
      const pasted = "https://bangsongteam.example/library/songs/abc";

      await expect(run("takedown", pasted, "", DECK)).rejects.toThrow(pasted);

      expect((await decksCol(db).doc(DECK).get()).data()?.listed).toBe(false);
    });

    it("--로 시작하는 id의 곡도 중단한다", async () => {
      await seedDocs(db, {
        decks: [
          deckDoc({
            id: DASHED,
            userId: A,
            visibility: "public",
            slides: SLIDES,
          }),
        ],
      });

      await run("takedown", DECK, DASHED);

      expect((await decksCol(db).doc(DASHED).get()).data()).toMatchObject({
        listed: false,
      });
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

    it("멈춘 실행을 이어 갈 때 먼저 중단된 곡에 걸린 신고도 닫는다", async () => {
      await ops.takedownDeck(db, DECK);
      await addReport("r1", B, DECK);

      await run("takedown-user", A, "--note=계정 정리");

      expect(await report("r1")).toEqual({
        status: "resolved",
        resolutionNote: "계정 정리",
      });
      expect(
        (await decksCol(db).doc(OTHER).get()).data()?.takedownAt,
      ).not.toBeNull();
      expect(logs[0]).toContain("곡 1개");
    });

    it("공식 라이브러리 계정은 한꺼번에 중단하지 않고 나머지 계정을 처리한 뒤 실패로 알린다", async () => {
      const botDecks = Array.from({ length: 30 }, (_, i) => `bot-deck-${i}`);
      await seedDocs(db, {
        users: [userDoc({ id: BOT, name: "공식 찬양 라이브러리" })],
        decks: botDecks.map((id) =>
          deckDoc({ id, userId: BOT, visibility: "public", slides: SLIDES }),
        ),
      });
      await addReport("r1", B, "bot-deck-0");

      const error = await run("takedown-user", BOT, A, "--note=x").catch(
        (e: Error) => e,
      );

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(BOT);
      expect((error as Error).message).toContain("takedown");
      const listed = await decksCol(db)
        .where("userId", "==", BOT)
        .where("listed", "==", true)
        .get();
      expect(listed.size).toBe(botDecks.length);
      expect((await report("r1")).status).toBe("pending");
      expect((await decksCol(db).doc(DECK).get()).data()?.listed).toBe(false);
    });

    it("없는 계정 id는 나머지를 처리한 뒤 실패로 알린다", async () => {
      const typo = "nobody-xxxxxxxxxxxxxx";

      await expect(run("takedown-user", typo, A)).rejects.toThrow(typo);

      expect((await decksCol(db).doc(DECK).get()).data()?.listed).toBe(false);
      expect(logs.join("\n")).not.toContain(typo);
    });

    it("줄 끝에 \\r이나 공백이 붙은 계정 id도 그 계정으로 처리한다", async () => {
      await run("takedown-user", `${A}\r`, `${B} `);

      expect((await decksCol(db).doc(DECK).get()).data()?.listed).toBe(false);
      expect((await decksCol(db).doc(B_DECK).get()).data()?.listed).toBe(false);
    });

    it("없는 계정 id는 세션을 지운 것처럼 알리지 않고 나머지를 처리한다", async () => {
      const sessions = db.collection(COLLECTIONS.sessions);
      await sessions.doc("sa").set({ id: "sa", userId: A });
      const typo = "nobody-xxxxxxxxxxxxxx";

      await expect(run("revoke-sessions", typo, `${A} `)).rejects.toThrow(typo);

      expect((await sessions.get()).size).toBe(0);
      expect(logs.join("\n")).not.toContain(typo);
    });

    it("계정마다 세션을 지운다", async () => {
      const sessions = db.collection(COLLECTIONS.sessions);
      await sessions.doc("sa").set({ id: "sa", userId: A });
      await sessions.doc("sb").set({ id: "sb", userId: B });

      await run("revoke-sessions", A);

      expect((await sessions.get()).docs.map((doc) => doc.id)).toEqual(["sb"]);
      expect(logs[0]).toContain("1개");
    });

    it("세션을 지워도 로그인한 기기는 몇 분 더 쓸 수 있고 다시 로그인할 수 있다고 알린다", async () => {
      await run("revoke-sessions", A);

      expect(logs[0]).toContain("5분");
      expect(logs[0]).toContain("takedown-user");
      expect(logs[0]).toContain("다시 로그인");
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
      expect(logs.at(-1)).toContain("비공개");
    });

    it("게시 중단되지 않은 곡은 푼 것처럼 알리지 않는다", async () => {
      await expect(run("restore", DECK)).rejects.toThrow(
        OPS_ERRORS.deck.nothingToRestore,
      );

      expect((await decksCol(db).doc(DECK).get()).data()).toMatchObject({
        visibility: "public",
        listed: true,
      });
      expect(logs).toEqual([]);
    });

    it("풀고 나서 곡이 공유 라이브러리에 다시 보이면 그렇게 알린다", async () => {
      await seedDocs(db, {
        decks: [
          deckDoc({
            id: PUBLIC_TAKEN_DOWN,
            userId: A,
            visibility: "public",
            takedownAt: new Date(1),
            slides: SLIDES,
          }),
        ],
      });

      await run("restore", PUBLIC_TAKEN_DOWN);

      expect(
        (await decksCol(db).doc(PUBLIC_TAKEN_DOWN).get()).data(),
      ).toMatchObject({ visibility: "public", listed: true });
      expect(logs.at(-1)).toContain("공유 라이브러리");
      expect(logs.at(-1)).not.toContain("비공개");
    });

    it("--republish로 풀면 공유 라이브러리에 다시 보인다고 알린다", async () => {
      await run("takedown", DECK);

      await run("restore", DECK, "--republish");

      expect(logs.at(-1)).toContain("공유 라이브러리");
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

    it("게시를 중단한 적 없는 곡은 --republish로 공개하지 않는다", async () => {
      await expect(run("restore", OTHER, "--republish")).rejects.toThrow(
        OPS_ERRORS.deck.notTakenDown,
      );

      expect((await decksCol(db).doc(OTHER).get()).data()).toMatchObject({
        visibility: "private",
        listed: false,
      });
    });

    it("보관함 곡이 아니면 실패한다", async () => {
      await expect(run("restore", "nope")).rejects.toThrow("nope");
      await expect(run("restore", "a/b")).rejects.toThrow("a/b");
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
          OPS_ERRORS.deck.sourceTakenDown,
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

    it("찾지 못한 /s/ 주소가 있어도 나머지 링크는 막고 그 주소를 알린다", async () => {
      await share();
      const unknown = "https://bangsongteam.example/s/unknownTokenXYZ";

      await expect(run("disable-link", unknown, PRESENTATION)).rejects.toThrow(
        unknown,
      );

      expect(await linkOf()).toMatchObject({
        linkAccess: "off",
        linkToken: null,
      });
    });

    it("프레젠테이션 id로 쓸 수 없는 값도 찾을 수 없다고 알리고 나머지를 처리한다", async () => {
      await share();

      await expect(run("disable-link", "a/b", PRESENTATION)).rejects.toThrow(
        "a/b",
      );

      expect(await linkOf()).toMatchObject({ linkToken: null });
    });

    it("이미 막은 주소를 다시 넣으면 Firestore 오류 대신 찾을 수 없다고 알린다", async () => {
      const url = `https://bangsongteam.example/s/${await share()}`;
      await run("disable-link", url);

      const error = await run("disable-link", url).catch((e: Error) => e);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("찾을 수 없어요");
      expect((error as Error).message).toContain(url);
      expect((error as Error).message).not.toContain("documentPath");
    });

    it("같은 링크를 주소와 id로 여러 번 적어도 한 번만 막고 실패로 알리지 않는다", async () => {
      const url = `https://bangsongteam.example/s/${await share()}`;

      await run("disable-link", url, url, PRESENTATION);

      expect(await linkOf()).toMatchObject({
        linkAccess: "off",
        linkToken: null,
      });
      expect(logs.filter((line) => line.includes("공유 링크를 막고"))).toEqual([
        expect.stringContaining(PRESENTATION),
      ]);
    });

    it("토큰이나 주소로 막으면 어느 프레젠테이션인지 id를 보여 준다", async () => {
      const token = await share();

      await run("disable-link", `https://bangsongteam.example/s/${token}`);

      expect(logs.join("\n")).toContain(PRESENTATION);
    });

    it("링크를 막다 멈춘 프레젠테이션은 id로 다시 실행해 남은 멤버를 지운다", async () => {
      await seedDocs(db, {
        members: [{ presentationId: PRESENTATION, userId: B }],
      });

      await run("disable-link", PRESENTATION);

      expect((await presentationMembersCol(db).get()).size).toBe(0);
    });

    it("한 링크를 막다 실패해도 나머지를 처리하고 다시 실행할 id를 알린다", async () => {
      await seedDocs(db, {
        presentations: [presentationDoc({ id: OTHER_PRESENTATION, userId: A })],
      });
      await setLinkAccess(db, OTHER_PRESENTATION, A, "view");
      const failing = {
        ...ops,
        disableShareLink: (database: Db, id: string) =>
          id === PRESENTATION
            ? Promise.reject(new Error("멤버를 지우지 못했어요"))
            : ops.disableShareLink(database, id),
      };

      await expect(
        runWith(failing, "disable-link", PRESENTATION, OTHER_PRESENTATION),
      ).rejects.toThrow(PRESENTATION);

      expect(
        (await presentationsCol(db).doc(OTHER_PRESENTATION).get()).data(),
      ).toMatchObject({ linkAccess: "off", linkToken: null });
    });
  });
});
