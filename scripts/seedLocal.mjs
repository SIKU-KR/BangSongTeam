/**
 * `pnpm dev`에서 바로 작업할 수 있게 로컬 D1·R2를 채운다. 운영 D1·R2는 건드리지 않는다.
 *
 * 사용법:
 *   pnpm db:seed:local
 *   pnpm db:seed:local --songs=200   # 공유 라이브러리 곡 수를 줄인다 (기본: 전체)
 *
 * 순서:
 *   1. `.dev.vars`가 없으면 `config/dev.vars.example`로 만들고 시드 계정을 배경 관리자로 둔다.
 *   2. 로컬 D1 마이그레이션을 적용한다.
 *   3. `data/backgrounds/dev/`의 이미지 배경을 로컬 R2에 올린다. 운영 배경 영상은 수 GB라
 *      올리지 않는다.
 *   4. `src/db/seed/devSeed.ts`로 배경 행과 시드 계정·공유 라이브러리·폴더·세트를 다시
 *      만든다. 시드 계정의 데이터만 지우고 다시 만드므로 여러 번 돌려도 된다.
 *
 * `pnpm dev`가 떠 있어도 돌릴 수 있다. 시드 계정은 새로 만들어지므로 다시 로그인한다.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";
import { getPlatformProxy } from "wrangler";

const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const DEV_VARS = path.join(ROOT_DIR, ".dev.vars");
const DEV_VARS_EXAMPLE = path.join(ROOT_DIR, "config", "dev.vars.example");
const SONGS_JSON = path.join(ROOT_DIR, "data", "cleaned", "songs.json");
const DEV_BACKGROUNDS_DIR = path.join(ROOT_DIR, "data", "backgrounds", "dev");
const DEV_ORIGIN = "http://localhost:5173";

function parseArgs(argv) {
  const args = Object.fromEntries(
    argv.map((arg) => {
      const [key, ...rest] = arg.replace(/^--/, "").split("=");
      return [key, rest.length > 0 ? rest.join("=") : true];
    }),
  );
  const songs = args.songs === undefined ? undefined : Number(args.songs);
  if (songs !== undefined && !(Number.isInteger(songs) && songs > 0)) {
    throw new Error(`--songs는 1 이상의 정수여야 합니다: ${args.songs}`);
  }
  return { songs };
}

function run(command, args) {
  execFileSync(command, args, { cwd: ROOT_DIR, stdio: "inherit" });
}

function ensureDevVars(adminUserId) {
  if (fs.existsSync(DEV_VARS)) return;
  const example = fs.readFileSync(DEV_VARS_EXAMPLE, "utf-8");
  fs.writeFileSync(
    DEV_VARS,
    example.replace(/^ADMIN_USER_IDS=.*$/m, `ADMIN_USER_IDS=${adminUserId}`),
  );
  console.log(`.dev.vars를 만들었습니다 (배경 관리자: ${adminUserId}).`);
}

async function uploadDevBackgrounds(bucket) {
  const { items } = JSON.parse(
    fs.readFileSync(path.join(DEV_BACKGROUNDS_DIR, "manifest.json"), "utf-8"),
  );
  return Promise.all(
    items.map(async ({ file, ...meta }) => {
      const key = `images/dev/${file}`;
      const bytes = fs.readFileSync(path.join(DEV_BACKGROUNDS_DIR, file));
      await bucket.put(key, bytes, {
        httpMetadata: { contentType: "image/webp" },
      });
      return { ...meta, key, sizeBytes: bytes.byteLength };
    }),
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const [{ module: seed }, { module: devUsers }, { module: db }] =
    await Promise.all([
      runnerImport(path.join(ROOT_DIR, "src/db/seed/devSeed.ts")),
      runnerImport(path.join(ROOT_DIR, "src/shared/constants/devUsers.ts")),
      runnerImport(path.join(ROOT_DIR, "src/db/client.ts")),
    ]);
  const { DEV_USERS } = devUsers;

  ensureDevVars(DEV_USERS[0].id);
  run("pnpm", [
    "exec",
    "wrangler",
    "d1",
    "migrations",
    "apply",
    "DB",
    "--local",
  ]);

  const allSongs = JSON.parse(fs.readFileSync(SONGS_JSON, "utf-8"));
  const songs = allSongs.slice(0, options.songs ?? allSongs.length);

  const proxy = await getPlatformProxy({
    configPath: path.join(ROOT_DIR, "wrangler.jsonc"),
    persist: true,
    remoteBindings: false,
  });
  try {
    const backgrounds = await uploadDevBackgrounds(proxy.env.MEDIA_BUCKET);
    const summary = await seed.seedDevData(db.createD1Client(proxy.env.DB), {
      songs,
      backgrounds,
    });
    console.log(
      [
        "",
        "로컬 시드를 마쳤습니다.",
        `  공유 라이브러리 ${summary.libraryDecks}곡, 폴더 ${summary.folders}개, 프레젠테이션 ${summary.presentations}개`,
        `  이미지 배경 ${summary.backgrounds}개`,
        "",
        "pnpm dev 뒤 로그인 화면의 개발용 계정 버튼이나 아래 주소로 로그인합니다:",
        ...DEV_USERS.map(
          (dev) =>
            `  ${dev.name}${dev.termsAgreed ? "" : " (약관 동의 전)"}: ${DEV_ORIGIN}/api/auth/dev/sign-in?userId=${dev.id}`,
        ),
        summary.shareToken
          ? `  공유 링크(보기 전용): ${DEV_ORIGIN}/s/${summary.shareToken}`
          : "",
      ].join("\n"),
    );
  } finally {
    await proxy.dispose();
  }
}

main().catch((error) => {
  console.error(error.stderr?.toString().trim() || error.message);
  process.exit(1);
});
