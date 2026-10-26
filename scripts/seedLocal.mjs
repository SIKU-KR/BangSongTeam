/**
 * `pnpm dev`에서 바로 작업할 수 있게 로컬 Firestore 에뮬레이터와 미디어 폴더를 채운다.
 * 운영 Firestore·GCS는 건드리지 않는다.
 *
 * 사용법 (다른 터미널에서 `pnpm emulators`를 먼저 띄운다):
 *   pnpm db:seed:local
 *   pnpm db:seed:local --songs=200   # 공유 라이브러리 곡 수를 줄인다 (기본: 전체)
 *
 * 순서:
 *   1. `.env.local`이 없으면 `config/env.example`로 만든다.
 *   2. `data/backgrounds/dev/`의 이미지 배경을 `.data/media`에 복사한다. 운영 배경 영상은
 *      수 GB라 넣지 않는다.
 *   3. `src/db/seed/devSeed.ts`로 배경 문서와 시드 계정·공유 라이브러리·폴더·세트를 다시
 *      만든다. 시드 계정의 데이터만 지우고 다시 만드므로 여러 번 돌려도 된다.
 *
 * 에뮬레이터 데이터는 `pnpm emulators`가 끝날 때 `.data/firestore`에 저장되고 다음 실행에
 * 다시 불러온다. `pnpm dev`가 떠 있어도 돌릴 수 있다. 시드 계정은 새로 만들어지므로 다시
 * 로그인한다.
 */

import fs from "node:fs";
import path from "node:path";
import {
  LOCAL_MEDIA_DIR,
  ROOT_DIR,
  assertEmulatorUp,
  importSource,
  parseFlags,
  applyTarget,
} from "./lib/targets.mjs";

const ENV_FILE = path.join(ROOT_DIR, ".env.local");
const ENV_EXAMPLE = path.join(ROOT_DIR, "config", "env.example");
const SONGS_JSON = path.join(ROOT_DIR, "data", "cleaned", "songs.json");
const DEV_BACKGROUNDS_DIR = path.join(ROOT_DIR, "data", "backgrounds", "dev");
const DEV_ORIGIN = "http://localhost:5173";

function parseArgs(argv) {
  const args = parseFlags(argv);
  const songs = args.songs === undefined ? undefined : Number(args.songs);
  if (songs !== undefined && !(Number.isInteger(songs) && songs > 0)) {
    throw new Error(`--songs는 1 이상의 정수여야 합니다: ${args.songs}`);
  }
  return { songs };
}

function ensureEnvFile() {
  if (fs.existsSync(ENV_FILE)) return;
  fs.copyFileSync(ENV_EXAMPLE, ENV_FILE);
  console.log(".env.local을 만들었습니다.");
}

function copyDevBackgrounds() {
  const { items } = JSON.parse(
    fs.readFileSync(path.join(DEV_BACKGROUNDS_DIR, "manifest.json"), "utf-8"),
  );
  return items.map(({ file, ...meta }) => {
    const key = `images/dev/${file}`;
    const source = path.join(DEV_BACKGROUNDS_DIR, file);
    const out = path.join(LOCAL_MEDIA_DIR, key);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(source, out);
    return { ...meta, key, sizeBytes: fs.statSync(source).size };
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  ensureEnvFile();
  applyTarget("local");
  await assertEmulatorUp();

  const [seed, devUsers, client] = await Promise.all([
    importSource("src/db/seed/devSeed.ts"),
    importSource("src/shared/constants/devUsers.ts"),
    importSource("src/db/client.ts"),
  ]);
  const { DEV_USERS } = devUsers;

  const allSongs = JSON.parse(fs.readFileSync(SONGS_JSON, "utf-8"));
  const songs = allSongs.slice(0, options.songs ?? allSongs.length);

  const backgrounds = copyDevBackgrounds();
  const summary = await seed.seedDevData(client.getFirestore(), {
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
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.stderr?.toString().trim() || error.message);
    process.exit(1);
  });
