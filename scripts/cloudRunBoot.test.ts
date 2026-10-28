import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { missingRuntimeEnv } from "./cloudRunBoot.mjs";

const BOOT_SCRIPT = path.join(__dirname, "cloudRunBoot.mjs");

const REQUIRED = {
  MEDIA_BUCKET: "bangsongteam-media",
  BETTER_AUTH_URL: "https://bangsongteam.siku-labs.com",
  BETTER_AUTH_SECRET: "secret",
  PROXY_SECRET: "proxy-secret",
};

function boot(script: string, env: Record<string, string>) {
  return spawnSync(process.execPath, [script], {
    env: { PATH: process.env.PATH ?? "", NODE_ENV: "production", ...env },
    encoding: "utf-8",
  });
}

describe("Cloud Run 진입점 (boot.mjs)", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("운영 필수 환경 변수 중 비어 있는 이름을 모두 알려 준다", () => {
    expect(missingRuntimeEnv({})).toEqual([
      "MEDIA_BUCKET",
      "BETTER_AUTH_URL",
      "BETTER_AUTH_SECRET",
      "PROXY_SECRET",
    ]);
    expect(missingRuntimeEnv({ ...REQUIRED, PROXY_SECRET: "  " })).toEqual([
      "PROXY_SECRET",
    ]);
    expect(missingRuntimeEnv(REQUIRED)).toEqual([]);
  });

  it("MEDIA_BUCKET이 빠지면 서버를 띄우지 않고 이름을 남긴 채 1로 끝난다", () => {
    const withoutBucket = Object.fromEntries(
      Object.entries(REQUIRED).filter(([name]) => name !== "MEDIA_BUCKET"),
    );

    const result = boot(BOOT_SCRIPT, withoutBucket);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("MEDIA_BUCKET");
    expect(result.stderr).not.toContain(REQUIRED.BETTER_AUTH_SECRET);
  });

  it("모두 있으면 옆에 놓인 Next.js 서버(server.js)를 띄운다", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boot-"));
    tempDirs.push(dir);
    fs.copyFileSync(BOOT_SCRIPT, path.join(dir, "boot.mjs"));
    fs.writeFileSync(
      path.join(dir, "server.js"),
      'console.log("next server started");\n',
    );

    const result = boot(path.join(dir, "boot.mjs"), REQUIRED);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("next server started");
  });
});
