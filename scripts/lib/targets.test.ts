import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LOCAL_EMULATOR_HOST,
  LOCAL_PROJECT_ID,
  applyTarget,
  describeTarget,
  parseOptions,
} from "./targets.mjs";

const ENV_KEYS = [
  "FIRESTORE_EMULATOR_HOST",
  "GOOGLE_CLOUD_PROJECT",
  "GCLOUD_PROJECT",
  "METADATA_SERVER_DETECTION",
] as const;

describe("운영 스크립트 대상 설정", () => {
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  describe("local", () => {
    it("비어 있는 에뮬레이터 주소는 기본 에뮬레이터로 바꾼다", () => {
      process.env.FIRESTORE_EMULATOR_HOST = "";
      process.env.GOOGLE_CLOUD_PROJECT = "bangsongteam";

      applyTarget("local");

      expect(process.env.FIRESTORE_EMULATOR_HOST).toBe(LOCAL_EMULATOR_HOST);
      expect(LOCAL_EMULATOR_HOST).toBe("127.0.0.1:8080");
    });

    it("비어 있는 프로젝트 id와 메타데이터 설정도 기본값으로 채운다", () => {
      process.env.GOOGLE_CLOUD_PROJECT = "";
      process.env.METADATA_SERVER_DETECTION = "";

      applyTarget("local");

      expect(process.env.GOOGLE_CLOUD_PROJECT).toBe(LOCAL_PROJECT_ID);
      expect(process.env.METADATA_SERVER_DETECTION).toBe("none");
    });

    it("직접 지정한 에뮬레이터 주소는 그대로 둔다", () => {
      process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8085";

      applyTarget("local");

      expect(process.env.FIRESTORE_EMULATOR_HOST).toBe("127.0.0.1:8085");
    });

    it("GCLOUD_PROJECT는 운영 프로젝트로 이어지지 않게 지운다", () => {
      process.env.GCLOUD_PROJECT = "bangsongteam";

      applyTarget("local");

      expect(process.env.GCLOUD_PROJECT).toBeUndefined();
    });
  });

  describe("remote", () => {
    it("에뮬레이터 주소를 지워 운영 Firestore에 붙게 한다", () => {
      process.env.FIRESTORE_EMULATOR_HOST = LOCAL_EMULATOR_HOST;
      process.env.GOOGLE_CLOUD_PROJECT = "bangsongteam";

      applyTarget("remote");

      expect(process.env.FIRESTORE_EMULATOR_HOST).toBeUndefined();
    });

    it("프로젝트 id가 없거나 비어 있으면 멈춘다", () => {
      expect(() => applyTarget("remote")).toThrow("GOOGLE_CLOUD_PROJECT");

      process.env.GOOGLE_CLOUD_PROJECT = "";
      expect(() => applyTarget("remote")).toThrow("GOOGLE_CLOUD_PROJECT");
    });

    it("GCLOUD_PROJECT가 다른 프로젝트를 가리키면 멈춘다", () => {
      process.env.GCLOUD_PROJECT = "a";
      process.env.GOOGLE_CLOUD_PROJECT = "b";

      expect(() => applyTarget("remote")).toThrow("GCLOUD_PROJECT");
    });

    it("GCLOUD_PROJECT가 같은 프로젝트면 통과한다", () => {
      process.env.GCLOUD_PROJECT = "bangsongteam";
      process.env.GOOGLE_CLOUD_PROJECT = "bangsongteam";

      expect(() => applyTarget("remote")).not.toThrow();
    });
  });

  it("local, remote가 아닌 대상은 받지 않는다", () => {
    expect(() => applyTarget("prod")).toThrow("local 또는 remote");
  });

  describe("describeTarget", () => {
    it("로컬은 에뮬레이터 주소와 프로젝트 id를 보여 준다", () => {
      applyTarget("local");

      expect(describeTarget("local")).toBe(
        `로컬 에뮬레이터 ${LOCAL_EMULATOR_HOST} (프로젝트 ${LOCAL_PROJECT_ID})`,
      );
    });

    it("운영은 연결할 프로젝트 id를 보여 준다", () => {
      process.env.GOOGLE_CLOUD_PROJECT = "bangsongteam";
      applyTarget("remote");

      expect(describeTarget("remote")).toBe(
        "운영 Firestore (프로젝트 bangsongteam)",
      );
    });
  });
});

describe("parseOptions", () => {
  const SPEC = { apply: "boolean", email: "string" } as const;

  it("위치 인자와 정해 둔 옵션을 나누고 --target은 언제나 받는다", () => {
    expect(
      parseOptions(
        ["user-1", "--apply", "--email=a=b@example.com", "--target=remote"],
        SPEC,
      ),
    ).toEqual({
      positionals: ["user-1"],
      flags: { apply: true, email: "a=b@example.com", target: "remote" },
    });
  });

  it("모르는 옵션은 오타로 보고 막는다", () => {
    expect(() => parseOptions(["--aply"], SPEC)).toThrow("--aply");
    expect(() => parseOptions(["--tagret=remote"], SPEC)).toThrow("--tagret");
  });

  it("값을 붙이면 안 되는 옵션과 값이 있어야 하는 옵션을 가린다", () => {
    expect(() => parseOptions(["--apply=yes"], SPEC)).toThrow("--apply");
    expect(() => parseOptions(["--email"], SPEC)).toThrow("--email");
  });

  it("--로 시작하는 NanoID는 옵션이 아니라 위치 인자로 읽는다", () => {
    const id = `--${"x8Jk".padEnd(19, "0")}`;

    expect(parseOptions([id, "--apply"], SPEC)).toEqual({
      positionals: [id],
      flags: { apply: true },
    });
  });
});
