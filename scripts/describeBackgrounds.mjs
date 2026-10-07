/**
 * 배경 매니페스트의 각 항목에 벡터 검색용 긴 설명(`searchText`)을 채우는 스크립트.
 * 영상·이미지를 MiniMax 멀티모달 모델에 보여 주고 받은 설명을 매니페스트에 바로 써 넣는다.
 * 한 건씩 저장하므로 중간에 멈춰도 다시 돌리면 빈 항목만 이어서 한다.
 *
 * 영상은 base64 data URI 한도(50MB)를 넘는 경우가 많아, ffmpeg로 480p·무음 사본을 만들어
 * 보낸다. 길이와 상관없이 전체에서 프레임 24장 안팎을 고르게 뽑아(초당 2장 이하) 뒷부분
 * 장면과 움직임은 남기고 입력 토큰은 줄인다.
 *
 * 필요한 것: Node 22.18+, ffmpeg (`brew install ffmpeg`), `MINIMAX_API_KEY` 환경 변수.
 *
 * 사용법:
 *   MINIMAX_API_KEY=... node scripts/describeBackgrounds.mjs --dir=<영상 폴더> --limit=3
 *   MINIMAX_API_KEY=... node scripts/describeBackgrounds.mjs --dir=<영상 폴더>
 *   MINIMAX_API_KEY=... node scripts/describeBackgrounds.mjs \
 *     --manifest=data/backgrounds/dev/manifest.json --dir=data/backgrounds/dev
 *
 * 옵션:
 *   --manifest=<경로>  매니페스트 JSON (기본값: data/backgrounds/storyloop.json)
 *   --dir=<경로>       매니페스트의 `file`이 들어 있는 폴더 (필수)
 *   --model=<id>       MiniMax 모델 (기본값: MiniMax-M3)
 *   --limit=<n>        처음 n개만 만든다 (품질 확인용)
 *   --force            이미 `searchText`가 있는 항목도 다시 만든다
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

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
const API_URL = "https://api.minimax.io/v1/chat/completions";
const DEFAULT_MODEL = "MiniMax-M3";
const CONCURRENCY = 4;
const MAX_ATTEMPTS = 3;
const PREVIEW_HEIGHT = 480;
const PREVIEW_MAX_FPS = 2;
const PREVIEW_FRAMES = 24;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const IMAGE_TYPES = {
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

const SYSTEM_PROMPT = `너는 교회 예배 찬양 가사 뒤에 까는 배경 영상·이미지를 검색할 수 있게 묘사하는 사람이다.
사람들은 "잔잔한 파란 물결", "따뜻한 금빛 불빛이 반짝이는 배경"처럼 자연어로 검색한다.
화면에 보이는 것만 근거로, 검색에 걸릴 만한 구체적인 단어를 많이 쓴 한국어 한 문단(200~400자)을 쓴다.
보이지 않는 쓰임새나 의미는 추측해 쓰지 않는다.

다음을 빠짐없이 담는다.
- 주된 색과 밝기, 빛의 느낌 (예: 짙은 남색, 금빛 보케, 역광)
- 보이는 사물·장면·자연물·도형 (예: 낙엽, 십자가, 구름, 입자, 곡선)
- 움직임의 속도와 방향 (예: 천천히 위로 떠오른다, 빠르게 회전한다, 거의 멈춰 있다)
- 분위기와 감정 (예: 차분한, 웅장한, 따뜻한, 몽환적인)

머리말, 목록, 따옴표 없이 설명 문단만 출력한다.`;

const run = promisify(execFile);

function parseArgs(argv) {
  const args = Object.fromEntries(
    argv.map((arg) => {
      const [key, ...rest] = arg.replace(/^--/, "").split("=");
      return [key, rest.length > 0 ? rest.join("=") : true];
    }),
  );
  if (!args.dir) throw new Error("--dir=<영상 폴더>가 필요합니다");
  const limit = args.limit === undefined ? Infinity : Number(args.limit);
  if (!(limit === Infinity || (Number.isInteger(limit) && limit > 0))) {
    throw new Error(`--limit은 1 이상의 정수여야 합니다: ${args.limit}`);
  }
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) throw new Error("MINIMAX_API_KEY 환경 변수가 필요합니다");
  return {
    manifestPath: path.resolve(args.manifest ?? DEFAULT_MANIFEST),
    dir: path.resolve(args.dir.replace(/^~(?=\/)/, os.homedir())),
    model: args.model ?? DEFAULT_MODEL,
    limit,
    force: args.force === true,
    apiKey,
  };
}

async function probeDuration(file) {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "csv=p=0",
    file,
  ]);
  return Number(stdout.trim());
}

async function makeVideoPreview(file, tmpDir) {
  const durationSec = await probeDuration(file);
  const fps = Math.min(PREVIEW_MAX_FPS, PREVIEW_FRAMES / durationSec);
  const outFile = path.join(
    tmpDir,
    `${path.basename(file, path.extname(file))}.mp4`,
  );
  await run("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-i",
    file,
    "-an",
    "-vf",
    `scale=-2:${PREVIEW_HEIGHT},fps=${fps.toFixed(3)}`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "30",
    "-pix_fmt",
    "yuv420p",
    outFile,
  ]);
  const bytes = fs.readFileSync(outFile);
  fs.rmSync(outFile, { force: true });
  if (bytes.byteLength > MAX_VIDEO_BYTES) {
    throw new Error(`미리보기 영상이 50MB를 넘습니다: ${file}`);
  }
  return bytes;
}

async function mediaPart(file, tmpDir) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".mp4") {
    const bytes = await makeVideoPreview(file, tmpDir);
    return {
      type: "video_url",
      video_url: { url: `data:video/mp4;base64,${bytes.toString("base64")}` },
    };
  }
  const mime = IMAGE_TYPES[ext];
  if (!mime) throw new Error(`지원하지 않는 형식입니다: ${file}`);
  const bytes = fs.readFileSync(file);
  return {
    type: "image_url",
    image_url: { url: `data:${mime};base64,${bytes.toString("base64")}` },
  };
}

function userPrompt(item) {
  return [
    `제목: ${item.title}`,
    `짧은 설명: ${item.description ?? ""}`,
    `기존 키워드: ${item.keywords.join(", ")}`,
    "",
    "위 정보는 참고만 하고, 실제로 보이는 장면을 기준으로 검색용 설명 문단을 써 줘.",
  ].join("\n");
}

function cleanText(content) {
  return content
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function describe(item, options, tmpDir) {
  const media = await mediaPart(path.join(options.dir, item.file), tmpDir);
  const body = JSON.stringify({
    model: options.model,
    reasoning_split: true,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [media, { type: "text", text: userPrompt(item) }],
      },
    ],
  });

  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        "content-type": "application/json",
      },
      body,
    });
    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 5000));
      continue;
    }
    const json = await response.json().catch(() => null);
    if (!response.ok || json?.base_resp?.status_code) {
      throw new Error(
        `MiniMax 요청 실패 (${response.status}): ${JSON.stringify(json?.base_resp ?? json)}`,
      );
    }
    const text = cleanText(json?.choices?.[0]?.message?.content ?? "");
    if (!text) throw new Error("빈 설명을 받았습니다");
    return text;
  }
}

function saveManifest(manifestPath, manifest) {
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf-8",
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(fs.readFileSync(options.manifestPath, "utf-8"));
  const todo = manifest.items
    .filter((item) => options.force || !item.searchText)
    .slice(0, options.limit);
  for (const item of todo) {
    const file = path.join(options.dir, item.file);
    if (!fs.existsSync(file)) throw new Error(`파일 없음: ${file}`);
  }
  console.log(`설명 만들 항목: ${todo.length}개 (모델: ${options.model})`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bangsong-describe-"));
  const failed = [];
  let done = 0;
  const queue = [...todo];
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      try {
        item.searchText = await describe(item, options, tmpDir);
        saveManifest(options.manifestPath, manifest);
        done += 1;
        console.log(`[${done}/${todo.length}] ${item.file} 완료`);
      } catch (error) {
        failed.push(item.file);
        console.log(
          `${item.file} 실패\n  ${error.stderr?.trim() || error.message}`,
        );
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  if (failed.length > 0) {
    console.error(
      `실패 ${failed.length}개 — 다시 실행하면 빈 항목만 이어서 합니다.`,
    );
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (error) {
  console.error(error.stderr?.trim() || error.message);
  process.exit(1);
}
