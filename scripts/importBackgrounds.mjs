/**
 * 배경 매니페스트(`data/backgrounds/*.json`)로 배경 라이브러리를 맞추는 스크립트.
 * 앱에는 배경 업로드가 없다 — 배경 영상은 수백 MB라 Worker 요청 본문 한도를 넘는다.
 *
 * 매니페스트의 `id`를 기준으로 D1의 `backgrounds`와 비교해:
 *   - 새 id: ffprobe로 H.264·길이를 확인하고 포스터(960px WebP)를 만든 뒤, R2에 영상·포스터를
 *     먼저 올리고 D1 행을 넣는다. 한 건씩 넣으므로 중간에 멈춰도 다시 돌리면 이어서 한다.
 *   - 있는 id: 파일은 그대로 두고 제목·설명·검색어·라이선스만 고친다.
 *   - 매니페스트에 없는 행: 새 등록이 모두 성공했을 때만 D1 행을 지우고 R2 객체를 지운다.
 *     그 배경을 쓰던 곡은 `ON DELETE SET NULL`로 배경 없음이 된다.
 *
 * 필요한 도구: Node 22.18+ (`backgroundSql.ts`를 타입 제거로 바로 불러온다), ffmpeg·ffprobe,
 * cwebp (`brew install ffmpeg webp`). ffmpeg 빌드에 WebP 인코더가 없는 경우가 많아 포스터는
 * PNG로 뽑아 cwebp로 바꾼다.
 *
 * 사용법:
 *   node scripts/importBackgrounds.mjs --dir=<영상 폴더> --dry-run
 *   node scripts/importBackgrounds.mjs --dir=<영상 폴더>                  # 로컬 D1·R2
 *   node scripts/importBackgrounds.mjs --dir=<영상 폴더> --target=remote --dry-run
 *   node scripts/importBackgrounds.mjs --dir=<영상 폴더> --target=remote --confirm
 *
 * `--target=remote`는 운영 D1·R2를 쓰고 지운다. 먼저 `--dry-run` 결과(지울 개수, 배경이
 * 사라질 곡 수)를 확인받은 뒤에만 `--confirm`으로 실행한다.
 *
 * 옵션:
 *   --manifest=<경로>  매니페스트 JSON (기본값: data/backgrounds/storyloop.json)
 *   --dir=<경로>       매니페스트의 `file`이 들어 있는 영상 폴더 (필수)
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { BACKGROUND_SQL } from "../src/db/ops/backgroundSql.ts";

const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const DEFAULT_MANIFEST = path.join(
  ROOT_DIR,
  "data",
  "backgrounds",
  "storyloop.json",
);
const MEDIA_BUCKET = "bangsongteam-media";
const ID_PATTERN = /^[A-Za-z0-9_-]{21}$/;
const POSTER_WIDTH = 960;
const POSTER_SEEK_SEC = 1;
const MAX_POSTER_BYTES = 2 * 1024 * 1024;

function parseArgs(argv) {
  const args = Object.fromEntries(
    argv.map((arg) => {
      const [key, value] = arg.replace(/^--/, "").split("=");
      return [key, value ?? true];
    }),
  );
  const target = args.target ?? "local";
  if (target !== "local" && target !== "remote") {
    throw new Error(`--target은 local 또는 remote여야 합니다: ${target}`);
  }
  if (!args.dir) throw new Error("--dir=<영상 폴더>가 필요합니다");
  return {
    manifestPath: path.resolve(args.manifest ?? DEFAULT_MANIFEST),
    dir: path.resolve(args.dir.replace(/^~(?=\/)/, os.homedir())),
    target,
    dryRun: args["dry-run"] === true,
    confirmed: args.confirm === true,
  };
}

function run(command, args) {
  return execFileSync(command, args, {
    cwd: ROOT_DIR,
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function wrangler(args) {
  return run("pnpm", ["exec", "wrangler", ...args]);
}

function sqlLiteral(value) {
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

/** `BACKGROUND_SQL`의 `:name` 자리에 값을 채운다. wrangler는 바인딩 파라미터를 받지 않는다 */
function fillSql(template, params) {
  return template.replace(/:([a-z0-9_]+)/g, (match, name) => {
    if (!(name in params)) throw new Error(`SQL 파라미터 없음: ${name}`);
    return sqlLiteral(params[name]);
  });
}

function query(target, sql) {
  const output = wrangler([
    "d1",
    "execute",
    "DB",
    `--${target}`,
    "--json",
    "--command",
    sql,
  ]);
  const [result] = JSON.parse(output);
  return result.results;
}

function execute(target, statements) {
  if (statements.length === 0) return;
  const file = path.join(
    os.tmpdir(),
    `bangsong-backgrounds-${process.pid}.sql`,
  );
  fs.writeFileSync(file, statements.join("\n"), "utf-8");
  try {
    wrangler(["d1", "execute", "DB", `--${target}`, `--file=${file}`]);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

function putObject(target, key, file, contentType) {
  wrangler([
    "r2",
    "object",
    "put",
    `${MEDIA_BUCKET}/${key}`,
    `--file=${file}`,
    `--content-type=${contentType}`,
    `--${target}`,
  ]);
}

function deleteObject(target, key) {
  wrangler(["r2", "object", "delete", `${MEDIA_BUCKET}/${key}`, `--${target}`]);
}

function loadManifest(manifestPath, dir) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  if (!manifest.license) throw new Error("매니페스트에 license가 없습니다");
  const ids = new Set();
  for (const item of manifest.items) {
    if (!ID_PATTERN.test(item.id)) throw new Error(`잘못된 id: ${item.file}`);
    if (ids.has(item.id)) throw new Error(`중복 id: ${item.id}`);
    ids.add(item.id);
    if (!item.title?.trim()) throw new Error(`제목 없음: ${item.file}`);
    if (!Array.isArray(item.keywords))
      throw new Error(`keywords 없음: ${item.file}`);
    if (!fs.existsSync(path.join(dir, item.file))) {
      throw new Error(`영상 파일 없음: ${path.join(dir, item.file)}`);
    }
  }
  return manifest;
}

function probeVideo(file) {
  const output = run("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=codec_name:format=duration",
    "-of",
    "json",
    file,
  ]);
  const probed = JSON.parse(output);
  const codec = probed.streams?.[0]?.codec_name;
  if (codec !== "h264") throw new Error(`H.264가 아닙니다 (${codec}): ${file}`);
  return Math.round(Number(probed.format.duration));
}

function makePoster(file, durationSec, outFile) {
  const seek = Math.min(POSTER_SEEK_SEC, durationSec / 2);
  const frameFile = outFile.replace(/\.webp$/, ".png");
  run("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-ss",
    String(seek),
    "-i",
    file,
    "-frames:v",
    "1",
    "-vf",
    `scale=${POSTER_WIDTH}:-2`,
    frameFile,
  ]);
  run("cwebp", ["-quiet", "-q", "80", frameFile, "-o", outFile]);
  fs.rmSync(frameFile, { force: true });
  const size = fs.statSync(outFile).size;
  if (size > MAX_POSTER_BYTES)
    throw new Error(`포스터가 2MB를 넘습니다: ${file}`);
  return size;
}

function metadataParams(item, license) {
  return {
    id: item.id,
    title: item.title.trim(),
    license,
    description: item.description ?? "",
    keywords: JSON.stringify(item.keywords),
  };
}

function registerBackground(target, item, dir, license, tmpDir) {
  const videoFile = path.join(dir, item.file);
  const durationSec = probeVideo(videoFile);
  const posterFile = path.join(tmpDir, `${item.id}.webp`);
  const posterBytes = makePoster(videoFile, durationSec, posterFile);
  const mediaKey = `loops/${item.id}.mp4`;
  const posterKey = `posters/${item.id}.webp`;

  putObject(target, mediaKey, videoFile, "video/mp4");
  putObject(target, posterKey, posterFile, "image/webp");
  fs.rmSync(posterFile, { force: true });

  execute(target, [
    fillSql(BACKGROUND_SQL.REGISTER_SERVICE_BACKGROUND, {
      ...metadataParams(item, license),
      r2_key: mediaKey,
      poster_key: posterKey,
      duration_sec: durationSec,
      size_bytes: fs.statSync(videoFile).size + posterBytes,
    }),
  ]);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const { target, dir } = options;
  const manifest = loadManifest(options.manifestPath, dir);
  const manifestIds = new Set(manifest.items.map((item) => item.id));

  const existing = query(target, BACKGROUND_SQL.LIST_BACKGROUNDS);
  const existingIds = new Set(existing.map((row) => row.id));
  const toRegister = manifest.items.filter((item) => !existingIds.has(item.id));
  const toUpdate = manifest.items.filter((item) => existingIds.has(item.id));
  const toDelete = existing.filter((row) => !manifestIds.has(row.id));
  const deleteIds = new Set(toDelete.map((row) => row.id));
  const affectedDecks = query(target, BACKGROUND_SQL.COUNT_DECKS_BY_BACKGROUND)
    .filter((row) => deleteIds.has(row.background_id))
    .reduce((sum, row) => sum + row.decks, 0);

  console.log(`대상: ${target} D1·R2`);
  console.log(`  새로 등록: ${toRegister.length}개`);
  console.log(`  메타데이터 갱신: ${toUpdate.length}개`);
  console.log(
    `  삭제: ${toDelete.length}개 (배경이 사라질 곡 ${affectedDecks}곡)`,
  );

  if (options.dryRun) {
    console.log("--dry-run이므로 아무것도 바꾸지 않았습니다.");
    return;
  }
  if (target === "remote" && !options.confirmed) {
    throw new Error(
      "운영 D1·R2를 바꾸려면 --dry-run 결과를 확인한 뒤 --confirm을 붙여 주세요",
    );
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bangsong-posters-"));
  const failed = [];
  toRegister.forEach((item, index) => {
    process.stdout.write(`[${index + 1}/${toRegister.length}] ${item.file} … `);
    try {
      registerBackground(target, item, dir, manifest.license, tmpDir);
      console.log("완료");
    } catch (error) {
      failed.push(item.file);
      console.log(`실패\n  ${error.stderr?.trim() || error.message}`);
    }
  });
  fs.rmSync(tmpDir, { recursive: true, force: true });

  execute(
    target,
    toUpdate.map((item) =>
      fillSql(
        BACKGROUND_SQL.UPDATE_BACKGROUND_METADATA,
        metadataParams(item, manifest.license),
      ),
    ),
  );
  console.log(`메타데이터 ${toUpdate.length}개를 갱신했습니다.`);

  if (failed.length > 0) {
    console.error(
      `등록 실패 ${failed.length}개 — 기존 배경은 지우지 않았습니다. 다시 실행하면 이어서 합니다.`,
    );
    process.exitCode = 1;
    return;
  }

  execute(
    target,
    toDelete.map((row) =>
      fillSql(BACKGROUND_SQL.DELETE_BACKGROUND, { id: row.id }),
    ),
  );
  for (const key of new Set(
    toDelete.flatMap((row) => [row.r2_key, row.poster_key]),
  )) {
    try {
      deleteObject(target, key);
    } catch (error) {
      console.warn(
        `R2 객체 삭제 실패 (행은 이미 지움): ${key}\n  ${error.stderr?.trim() || error.message}`,
      );
    }
  }
  console.log(`기존 배경 ${toDelete.length}개를 지웠습니다.`);
}

try {
  main();
} catch (error) {
  console.error(error.stderr?.trim() || error.message);
  process.exit(1);
}
