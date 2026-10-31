import { beforeEach, describe, expect, it } from "vitest";
import {
  parseModerationArgs,
  runModeration,
} from "../../../scripts/lib/moderationCli.mjs";
import type { Db } from "../client";
import { presentationMembersCol, presentationsCol } from "../collections";
import { setLinkAccess } from "../queries/presentationSharing";
import { createTestDb, presentationDoc, seedDocs } from "../test/fixtures";
import * as ops from "./moderation";

const A = "00000000000000000000a";
const B = "00000000000000000000b";
const PRESENTATION = "p00000000000000000001";
const OTHER_PRESENTATION = "p00000000000000000002";
const DASHED = `--${"x8Jk".padEnd(19, "0")}`;

describe("moderation 명령줄", () => {
  let db: Db;
  let logs: string[];

  const runWith = (commandOps: typeof ops, ...argv: string[]) =>
    runModeration(parseModerationArgs(argv), {
      db,
      ops: commandOps,
      out: {
        log: (message: string) => logs.push(message),
        warn: (message: string) => logs.push(message),
        table: () => undefined,
      },
    });
  const run = (...argv: string[]) => runWith(ops, ...argv);

  beforeEach(async () => {
    db = createTestDb();
    logs = [];
    await seedDocs(db, {
      presentations: [presentationDoc({ id: PRESENTATION, userId: A })],
    });
  });

  describe("입력 해석", () => {
    it("명령, id, 옵션을 나눈다", () => {
      expect(
        parseModerationArgs(["disable-link", "a", "b", "--target=remote"]),
      ).toEqual({
        command: "disable-link",
        ids: ["a", "b"],
        flags: { target: "remote" },
      });
    });

    it("--로 시작하는 id도 id로 읽고 옵션 오타는 계속 막는다", () => {
      expect(DASHED).toHaveLength(21);
      expect(parseModerationArgs(["disable-link", DASHED, "b"])).toEqual({
        command: "disable-link",
        ids: [DASHED, "b"],
        flags: {},
      });
      expect(() =>
        parseModerationArgs(["disable-link", "a", "--tagret=remote"]),
      ).toThrow("--tagret");
    });

    it("붙여 넣은 id 앞뒤의 공백·줄바꿈·폭 없는 문자를 지우고 빈 인자는 버린다", () => {
      expect(
        parseModerationArgs([
          "disable-link",
          ` ${A}\r`,
          `\u200b${B}\ufeff`,
          `${DASHED}\r`,
          "\r",
          "\u3000",
        ]),
      ).toEqual({
        command: "disable-link",
        ids: [A, B, DASHED],
        flags: {},
      });
      expect(() => parseModerationArgs(["disable-link", " \r"])).toThrow("id");
    });

    it("모르는 명령이나 id 없는 입력은 연결하기 전에 멈춘다", () => {
      expect(() => parseModerationArgs([])).toThrow("명령");
      expect(() => parseModerationArgs(["takedown", "a"])).toThrow("takedown");
      expect(() => parseModerationArgs(["disable-link"])).toThrow("id");
    });

    it("값이 틀린 옵션은 받지 않는다", () => {
      expect(() =>
        parseModerationArgs(["disable-link", "a", "--note=사유"]),
      ).toThrow("--note");
      expect(() =>
        parseModerationArgs(["disable-link", "a", "--target"]),
      ).toThrow("--target");
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
