import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT_DIR = path.resolve(import.meta.dirname, "..", "..", "..");
const SCRIPT = path.join(ROOT_DIR, "scripts", "reindexDecks.mjs");

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

describe("scripts/reindexDecks.mjs", () => {
  const run = (projectId: string): Promise<RunResult> =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [SCRIPT], {
        cwd: ROOT_DIR,
        env: { ...process.env, GOOGLE_CLOUD_PROJECT: projectId },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });

  it("색인을 다시 만들기 전에 어느 데이터베이스에 쓰는지 첫 줄로 보여 준다", async () => {
    const projectId = `test-${randomUUID()}`;

    const result = await run(projectId);

    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    const [target, summary] = result.stdout.trim().split("\n");
    expect(target).toBe(
      `대상: 로컬 에뮬레이터 ${process.env.FIRESTORE_EMULATOR_HOST} (프로젝트 ${projectId})`,
    );
    expect(summary).toContain("곡 0개를 확인하고");
  }, 60_000);
});
