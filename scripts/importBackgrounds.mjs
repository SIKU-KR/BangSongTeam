/**
 * 배경 매니페스트(`data/backgrounds/*.json`)로 배경 라이브러리를 맞추는 스크립트.
 * 앱에는 배경 업로드가 없다 — 배경 영상은 수백 MB라 API 요청 본문으로 받지 않는다.
 *
 * 매니페스트의 `id`를 기준으로 Firestore의 `backgrounds`와 비교해:
 *   - 새 id: ffprobe로 브라우저가 재생할 수 있는 H.264(8비트 4:2:0)인지와 길이를 확인하고
 *     포스터(960px WebP)를 만든 뒤, 미디어 저장소에 영상·포스터를 먼저 올리고 배경 문서를
 *     만든다. 한 건씩 넣으므로 중간에 멈춰도 다시 돌리면 이어서 한다.
 *   - 있는 id: 파일은 그대로 두고 제목·설명·검색어만 고친다. 영상 파일이 없어도 된다.
 *   - 매니페스트에 없는 문서: 새 등록이 모두 성공했을 때만 문서를 지우고 미디어 객체를
 *     지운다. 그 배경을 쓰던 곡은 같은 트랜잭션에서 배경 없음이 되고, 같은 id로 다시 등록해도
 *     배경을 되찾지 않는다. 실수로 지웠을 때 어느 곡을 되돌려야 하는지 알 수 있게 지운 배경마다
 *     쓰던 곡 id를 `--links-file`에 남긴다.
 *
 * 필요한 도구: ffmpeg·ffprobe, cwebp (`brew install ffmpeg webp`). ffmpeg 빌드에 WebP 인코더가
 * 없는 경우가 많아 포스터는 PNG로 뽑아 cwebp로 바꾼다. 대상별 준비는 `lib/targets.mjs`.
 *
 * 사용법:
 *   node scripts/importBackgrounds.mjs --dir=<영상 폴더> --dry-run
 *   node scripts/importBackgrounds.mjs --dir=<영상 폴더>                  # 로컬 에뮬레이터·폴더
 *   node scripts/importBackgrounds.mjs --dir=<영상 폴더> --target=remote --dry-run
 *   node scripts/importBackgrounds.mjs --dir=<영상 폴더> --target=remote --confirm
 *
 * `--target=remote`는 운영 Firestore·GCS를 쓰고 지운다. 먼저 `--dry-run` 결과(지울 개수,
 * 배경이 사라질 곡 수)를 확인받은 뒤에만 `--confirm`으로 실행한다.
 *
 * 옵션:
 *   --manifest=<경로>    매니페스트 JSON (기본값: data/backgrounds/storyloop.json)
 *   --dir=<경로>         매니페스트의 `file`이 들어 있는 영상 폴더 (필수). 새로 등록할 배경의
 *                        영상만 있으면 된다
 *   --links-file=<경로>  지운 배경과 그 배경을 쓰던 곡 id 기록
 *                        (기본값: .data/removed-background-links-<시각>.json)
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  ROOT_DIR,
  assertEmulatorUp,
  describeTarget,
  importSource,
  mediaTarget,
  parseFlags,
  applyTarget,
} from "./lib/targets.mjs";
import { PROBE_ENTRIES, checkProbedVideo } from "./lib/videoProbe.mjs";

const DEFAULT_MANIFEST = path.join(
  ROOT_DIR,
  "data",
  "backgrounds",
  "storyloop.json",
);
const ID_PATTERN = /^[A-Za-z0-9_-]{21}$/;
const POSTER_WIDTH = 960;
const POSTER_SEEK_SEC = 1;
const MAX_POSTER_BYTES = 2 * 1024 * 1024;

function parseArgs(argv) {
  const args = parseFlags(argv);
  const target = args.target ?? "local";
  if (!args.dir) throw new Error("--dir=<영상 폴더>가 필요합니다");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return {
    manifestPath: path.resolve(args.manifest ?? DEFAULT_MANIFEST),
    dir: path.resolve(args.dir.replace(/^~(?=\/)/, os.homedir())),
    linksFile: path.resolve(
      args["links-file"] ??
        path.join(ROOT_DIR, ".data", `removed-background-links-${stamp}.json`),
    ),
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

/**
 * 매니페스트를 읽고 올리기 전에 항목을 확인한다. 앱은 배경 목록을 행마다 검증하므로 형식을
 * 어긴 배경(숫자 검색어, 문자열이 아닌 제목·설명)은 갤러리와 송출에서 빠진다. 손으로 고친
 * 매니페스트의 실수를 여기서 막는다.
 *
 * 영상 파일은 확인하지 않는다. 이미 등록한 배경의 제목·설명·검색어는 영상 파일 없이 고칠 수
 * 있어야 하므로, 새로 등록할 항목의 파일만 따로 확인한다.
 */
export function loadManifest(manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const ids = new Set();
  for (const item of manifest.items) {
    if (!ID_PATTERN.test(item.id)) throw new Error(`잘못된 id: ${item.file}`);
    if (ids.has(item.id)) throw new Error(`중복 id: ${item.id}`);
    ids.add(item.id);
    if (typeof item.title !== "string" || !item.title.trim())
      throw new Error(`제목 없음: ${item.file}`);
    if (!Array.isArray(item.keywords))
      throw new Error(`keywords 없음: ${item.file}`);
    if (item.keywords.some((keyword) => typeof keyword !== "string"))
      throw new Error(`keywords에 문자열이 아닌 값: ${item.file}`);
    if (item.description != null && typeof item.description !== "string")
      throw new Error(`description이 문자열이 아님: ${item.file}`);
  }
  return manifest;
}

function assertVideosExist(items, dir) {
  const missing = items
    .map((item) => path.join(dir, item.file))
    .filter((file) => !fs.existsSync(file));
  if (missing.length > 0) {
    throw new Error(`영상 파일 없음: ${missing.join(", ")}`);
  }
}

function probeVideo(file) {
  const output = run("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    PROBE_ENTRIES,
    "-of",
    "json",
    file,
  ]);
  return checkProbedVideo(JSON.parse(output), file);
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

function metadata(item) {
  return {
    title: item.title.trim(),
    description: item.description ?? "",
    keywords: item.keywords,
  };
}

async function registerOne(ops, db, media, item, dir, tmpDir) {
  const videoFile = path.join(dir, item.file);
  const durationSec = probeVideo(videoFile);
  const posterFile = path.join(tmpDir, `${item.id}.webp`);
  const posterBytes = makePoster(videoFile, durationSec, posterFile);
  const mediaKey = `loops/${item.id}.mp4`;
  const posterKey = `posters/${item.id}.webp`;

  await media.put(mediaKey, videoFile, "video/mp4");
  await media.put(posterKey, posterFile, "image/webp");
  fs.rmSync(posterFile, { force: true });

  await ops.registerBackground(db, {
    id: item.id,
    ...metadata(item),
    mediaKey,
    posterKey,
    durationSec,
    sizeBytes: fs.statSync(videoFile).size + posterBytes,
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { target, dir } = options;
  applyTarget(target);
  await assertEmulatorUp();
  const manifest = loadManifest(options.manifestPath);
  const manifestIds = new Set(manifest.items.map((item) => item.id));

  const [{ getFirestore }, ops] = await Promise.all([
    importSource("src/db/client.ts"),
    importSource("src/db/ops/backgrounds.ts"),
  ]);
  const db = getFirestore();
  const media = await mediaTarget(target);

  const existing = await ops.listBackgroundFiles(db);
  const existingIds = new Set(existing.map((row) => row.id));
  const toRegister = manifest.items.filter((item) => !existingIds.has(item.id));
  const toUpdate = manifest.items.filter((item) => existingIds.has(item.id));
  assertVideosExist(toRegister, dir);
  const toDelete = existing.filter((row) => !manifestIds.has(row.id));
  const usage = await ops.countDecksByBackground(
    db,
    toDelete.map((row) => row.id),
  );
  const affectedDecks = [...usage.values()].reduce((sum, n) => sum + n, 0);

  console.log(`대상: ${describeTarget(target)} · ${media.label}`);
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
      "운영 Firestore·GCS를 바꾸려면 --dry-run 결과를 확인한 뒤 --confirm을 붙여 주세요",
    );
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bangsong-posters-"));
  const failed = [];
  for (const [index, item] of toRegister.entries()) {
    process.stdout.write(`[${index + 1}/${toRegister.length}] ${item.file} … `);
    try {
      await registerOne(ops, db, media, item, dir, tmpDir);
      console.log("완료");
    } catch (error) {
      failed.push(item.file);
      console.log(`실패\n  ${error.stderr?.trim() || error.message}`);
    }
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });

  for (const item of toUpdate) {
    await ops.updateBackgroundMetadata(db, item.id, metadata(item));
  }
  console.log(`메타데이터 ${toUpdate.length}개를 갱신했습니다.`);

  if (failed.length > 0) {
    console.error(
      `등록 실패 ${failed.length}개 — 기존 배경은 지우지 않았습니다. 다시 실행하면 이어서 합니다.`,
    );
    process.exitCode = 1;
    return;
  }

  const removedLinks = {};
  for (const row of toDelete) {
    removedLinks[row.id] = await ops.deleteBackground(db, row.id);
    fs.mkdirSync(path.dirname(options.linksFile), { recursive: true });
    fs.writeFileSync(options.linksFile, JSON.stringify(removedLinks, null, 2));
  }
  if (toDelete.length > 0) {
    console.log(`지운 배경을 쓰던 곡 id를 남겼어요: ${options.linksFile}`);
  }
  for (const key of new Set(
    toDelete.flatMap((row) => [row.mediaKey, row.posterKey]),
  )) {
    try {
      await media.remove(key);
    } catch (error) {
      console.warn(
        `미디어 객체 삭제 실패 (문서는 이미 지움): ${key}\n  ${error.message}`,
      );
    }
  }
  console.log(`기존 배경 ${toDelete.length}개를 지웠습니다.`);
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await main();
    process.exit(process.exitCode ?? 0);
  } catch (error) {
    console.error(error.stderr?.trim() || error.message);
    process.exit(1);
  }
}
