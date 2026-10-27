import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createId } from "#shared";
import { createFirestore, type Db } from "../client";
import { backgroundsCol, decksCol } from "../collections";
import { deckDoc, seedDocs, userDoc } from "../test/fixtures";
import { registerBackground } from "./backgrounds";

const ROOT_DIR = path.resolve(import.meta.dirname, "..", "..", "..");
const SCRIPT = path.join(ROOT_DIR, "scripts", "importBackgrounds.mjs");
const OWNER = "00000000000000000000a";
const DECK = "c00000000000000000001";

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

describe("scripts/importBackgrounds.mjs", () => {
  let projectId: string;
  let db: Db;
  let workDir: string;
  let videoDir: string;
  let existing: string;

  const run = (...args: string[]): Promise<RunResult> =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [SCRIPT, ...args], {
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

  const writeManifest = (items: unknown[]): string => {
    const file = path.join(workDir, "manifest.json");
    fs.writeFileSync(file, JSON.stringify({ items }));
    return file;
  };

  const item = (id: string, title: string) => ({
    id,
    file: `${id}.mp4`,
    title,
    description: "",
    keywords: ["빛"],
  });

  beforeEach(async () => {
    projectId = `test-${randomUUID()}`;
    db = createFirestore({ projectId });
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "import-backgrounds-"));
    videoDir = path.join(workDir, "videos");
    fs.mkdirSync(videoDir);
    existing = createId();
    await registerBackground(db, {
      id: existing,
      title: "은은한 빛의 흐름",
      mediaKey: `loops/${existing}.mp4`,
      posterKey: `posters/${existing}.webp`,
      durationSec: 20,
      sizeBytes: 18_000_000,
      description: "",
      keywords: ["빛"],
    });
  });

  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it("이미 등록한 배경의 제목만 고칠 때는 영상 파일이 없어도 된다", async () => {
    const manifest = writeManifest([item(existing, "노을빛 흐름")]);

    const result = await run(`--manifest=${manifest}`, `--dir=${videoDir}`);

    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("메타데이터 갱신: 1개");
    expect((await backgroundsCol(db).doc(existing).get()).data()?.title).toBe(
      "노을빛 흐름",
    );
  }, 60_000);

  it("새로 등록할 배경의 영상 파일이 없으면 미리보기에서도 멈추고 아무것도 바꾸지 않는다", async () => {
    const added = createId();
    const manifest = writeManifest([
      item(existing, "노을빛 흐름"),
      item(added, "새 배경"),
    ]);

    const result = await run(
      `--manifest=${manifest}`,
      `--dir=${videoDir}`,
      "--dry-run",
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("영상 파일 없음");
    expect(result.stderr).toContain(`${added}.mp4`);
    expect(result.stderr).not.toContain(`${existing}.mp4`);
    expect((await backgroundsCol(db).doc(existing).get()).data()?.title).toBe(
      "은은한 빛의 흐름",
    );
  }, 60_000);

  it("매니페스트에서 뺀 배경을 지우면 그 배경을 쓰던 곡을 기록으로 남긴다", async () => {
    await seedDocs(db, {
      users: [userDoc({ id: OWNER })],
      decks: [deckDoc({ id: DECK, userId: OWNER, backgroundId: existing })],
    });
    const manifest = writeManifest([]);
    const linksFile = path.join(workDir, "links.json");

    const result = await run(
      `--manifest=${manifest}`,
      `--dir=${videoDir}`,
      `--links-file=${linksFile}`,
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(linksFile);
    expect(JSON.parse(fs.readFileSync(linksFile, "utf-8"))).toEqual({
      [existing]: [DECK],
    });
    expect(
      (await decksCol(db).doc(DECK).get()).data()?.backgroundId,
    ).toBeNull();
    expect((await backgroundsCol(db).doc(existing).get()).exists).toBe(false);
  }, 60_000);
});
