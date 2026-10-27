/**
 * 선별된 가사를 BangSongTeam 공유 라이브러리(Firestore)에 공식 봇 계정의 공개 곡으로 넣는다.
 *
 * 사용법:
 *   1. data/cleaned/selected/ 폴더에 올리고 싶은 .txt 파일들을 복사합니다.
 *   2. 로컬 에뮬레이터에 넣기 (다른 터미널에서 `pnpm emulators`):
 *      node scripts/seedSelected.mjs --target=local
 *   3. 운영 Firestore에 넣기 (운영 데이터를 쓰므로 실행 전에 확인받는다):
 *      GOOGLE_CLOUD_PROJECT=... node scripts/seedSelected.mjs --target=remote
 *
 * 옵션:
 *   --dir=<경로>    지정한 디렉터리의 txt 파일들을 읽어옵니다. (기본값: data/cleaned/selected)
 *   --json=<경로>   txt 폴더 대신 `{ title, artist, lyrics }` 배열 JSON(예: data/cleaned/songs.json)을 읽어옵니다.
 *   --dry-run       Firestore에 쓰지 않고 넣을 곡 수만 셉니다.
 *
 * 봇 계정에 같은 제목·아티스트 곡이 이미 있으면 건너뛰므로 여러 번 돌려도 겹치지 않는다.
 * 제목은 고칠 목록(`data/officialLibraryFixes.json`)의 고친 제목으로 견주고 넣으므로, 원본에서 고친
 * 곡을 `fixLibraryText.mjs`보다 먼저 시드해도 운영에 남은 옛 제목의 곡과 겹치지 않는다.
 * 슬라이드 나누기와 기본 스타일은 앱과 같은 `#shared` 규칙을 쓴다.
 * 제목·아티스트는 개발용 시드(`devSeed.ts`)처럼 곡 스키마 한도(100자)로 줄여 넣는다. 원본에는
 * 100자를 넘는 메들리 제목이 있다. 이미 들어간 곡과도 줄인 값끼리 비교해, 예전에 줄이지 않고
 * 넣은 곡을 줄인 사본으로 다시 넣지 않는다.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import {
  ROOT_DIR,
  assertEmulatorUp,
  describeTarget,
  importSource,
  parseFlags,
  applyTarget,
} from "./lib/targets.mjs";

const SELECTED_DIR = path.join(ROOT_DIR, "data", "cleaned", "selected");
const FIXES_JSON = path.join(ROOT_DIR, "data", "officialLibraryFixes.json");

/**
 * 텍스트 파일 파싱 (헤더 메타데이터 또는 파일명에서 곡 정보 추출)
 */
function parseTextFile(content, fileName = "") {
  const delimiterIndex = content.indexOf(
    "--------------------------------------------------",
  );
  let header = "";
  let body = "";

  if (delimiterIndex !== -1) {
    header = content.slice(0, delimiterIndex);
    body = content.slice(delimiterIndex + 50).trim();
  } else {
    body = content.trim();
  }

  const titleMatch = header.match(/제목:\s*(.+)/);
  const artistMatch = header.match(/아티스트:\s*(.+)/);
  const numberMatch = header.match(/장수:\s*(.+)/);

  let title = titleMatch ? titleMatch[1].trim() : "";
  let artist = artistMatch ? artistMatch[1].trim() : "";

  // 헤더가 없는 경우(전처리된 파일) 파일명에서 추출
  if (!title && fileName) {
    const baseName = fileName.replace(/\.txt$/i, "");

    // 찬송가: "008_거룩 거룩 거룩 전능하신 주님"
    const hymnMatch = baseName.match(/^(\d{1,3})_(.+)$/);
    if (hymnMatch) {
      const num = parseInt(hymnMatch[1], 10);
      title = `${num}장 ${hymnMatch[2].trim()}`;
      artist = "새찬송가";
    } else {
      // 워십: "[아티스트] 제목" 또는 "제목"
      const artistTitleMatch = baseName.match(/^\[(.*?)\]\s*(.+)$/);
      if (artistTitleMatch) {
        artist = artistTitleMatch[1].trim();
        title = artistTitleMatch[2].trim();
      } else {
        title = baseName.trim();
      }
    }
  }

  // 찬송가의 경우 번호를 제목 앞에 붙여 검색 편의성 강화 (예: "288장 예수를 나의 구주 삼고")
  if (numberMatch && !title.includes("장")) {
    const num = numberMatch[1].replace(/장/g, "").trim();
    title = `${num}장 ${title}`;
    if (!artist) artist = "새찬송가";
  }

  if (!title) title = "제목 없음";

  return {
    title,
    artist,
    lyricsRaw: body,
  };
}

/**
 * txt 폴더의 파일들을 `{ label, title, artist, lyricsRaw }`로 읽는다. 파일이 없으면 null.
 */
async function loadSongsFromDir(targetDir) {
  await fs.mkdir(targetDir, { recursive: true });

  const files = await fs.readdir(targetDir);
  const txtFiles = files.filter((f) => f.endsWith(".txt"));

  if (txtFiles.length === 0) {
    console.log(`선별된 .txt 파일이 없습니다.`);
    console.log(`경로: ${targetDir}`);
    console.log(
      `\n팁: data/cleaned/hymns 또는 data/cleaned/worship 에서 원하는 곡들을`,
    );
    console.log(`    ${targetDir} 폴더로 복사한 후 다시 실행해 주세요.`);
    console.log(`    또는 특정 폴더를 직접 지정할 수도 있습니다:`);
    console.log(`    node scripts/seedSelected.mjs --dir=data/cleaned/hymns`);
    return null;
  }

  const songs = [];
  for (const file of txtFiles) {
    const content = await fs.readFile(path.join(targetDir, file), "utf-8");
    songs.push({ label: file, ...parseTextFile(content, file) });
  }
  return songs;
}

/**
 * `{ title, artist, lyrics }` 배열 JSON을 읽는다.
 */
async function loadSongsFromJson(jsonPath) {
  const entries = JSON.parse(await fs.readFile(jsonPath, "utf-8"));
  return entries.map((entry) => ({
    label: entry.title,
    title: entry.title.trim() || "제목 없음",
    artist: (entry.artist ?? "").trim(),
    lyricsRaw: (entry.lyrics ?? "").trim(),
  }));
}

async function main() {
  const args = parseFlags(process.argv.slice(2));
  const target = args.target ?? "local";
  const dryRun = args["dry-run"] === true;
  const source = args.json
    ? path.resolve(ROOT_DIR, args.json)
    : args.dir
      ? path.resolve(ROOT_DIR, args.dir)
      : SELECTED_DIR;
  const songs = args.json
    ? await loadSongsFromJson(source)
    : await loadSongsFromDir(source);
  if (!songs) return;

  applyTarget(target);
  await assertEmulatorUp();
  const [shared, client, collections, deckIndex, libraryFixes] =
    await Promise.all([
      importSource("src/shared/index.ts"),
      importSource("src/db/client.ts"),
      importSource("src/db/collections.ts"),
      importSource("src/db/deckIndex.ts"),
      importSource("src/db/ops/libraryTextFixes.ts"),
    ]);
  const db = client.getFirestore();
  const decks = collections.decksCol(db);
  const botId = shared.OFFICIAL_LIBRARY_USER_ID;
  const correctTitle = libraryFixes.libraryTitleCorrector(
    libraryFixes.parseLibraryTextFixes(
      JSON.parse(await fs.readFile(FIXES_JSON, "utf-8")),
    ),
  );

  console.log(`=== 시드 시작 ===`);
  console.log(`- 원본: ${source}`);
  console.log(`- 처리할 곡: ${songs.length}개`);
  console.log(`- 대상: ${describeTarget(target)}`);

  const fitArtist = (artist) =>
    shared.clampText(artist ?? "", shared.MAX_DECK_ARTIST_LENGTH);
  const fitTitle = (title, artist) =>
    shared.clampText(
      correctTitle(title, artist ?? ""),
      shared.MAX_DECK_TITLE_LENGTH,
    ) || "제목 없음";
  const songKey = (title, artist) =>
    `${fitTitle(title, artist)}\u0000${fitArtist(artist)}`;

  const existing = await decks
    .where("userId", "==", botId)
    .where("presentationId", "==", null)
    .get();
  const official = existing.docs.map((doc) => doc.data());
  const seen = new Set(
    official.map(({ title, artist }) => songKey(title, artist)),
  );
  const stale = official.filter(
    ({ title, artist }) => correctTitle(title, artist) !== title,
  ).length;

  const now = new Date();
  const rows = [];
  for (const song of songs) {
    const { label, lyricsRaw } = song;
    const title = fitTitle(song.title, song.artist);
    const artist = fitArtist(song.artist);
    if (!lyricsRaw || lyricsRaw.length < 5) {
      console.warn(`[건너뜀] 가사 내용 부족: ${label}`);
      continue;
    }
    const key = songKey(title, artist);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(
      deckIndex.withDeckIndex({
        id: nanoid(),
        userId: botId,
        presentationId: null,
        itemId: null,
        position: null,
        title,
        artist,
        lyricsRaw,
        slides: JSON.stringify(shared.splitLyricsIntoSlides(lyricsRaw)),
        style: JSON.stringify(shared.DEFAULT_DECK_STYLE),
        backgroundId: null,
        forkedFrom: null,
        forkedFromAuthorName: null,
        visibility: "public",
        publishedAt: now,
        takedownAt: null,
        forkCount: 0,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  console.log(`\n새로 넣을 곡: ${rows.length}개 (이미 있는 곡 제외)`);
  if (stale > 0) {
    console.log(
      `공식 곡 ${stale}개가 아직 고치기 전 제목입니다. 고친 제목으로 들어온 곡은 이 곡들과 같은 곡으로 보고 넣지 않으니, scripts/fixLibraryText.mjs로 제목을 고쳐 주세요.`,
    );
  }
  if (dryRun) {
    console.log(`--dry-run 모드이므로 Firestore에 쓰지 않습니다.`);
    return;
  }

  await client.runBulk(db, (writer) => [
    writer.set(
      collections.usersCol(db).doc(botId),
      {
        id: botId,
        name: shared.OFFICIAL_LIBRARY_NAME,
        email: "library@worship.local",
        emailVerified: true,
        image: null,
        termsAgreedAt: now,
        bannedAt: null,
        createdAt: now,
        updatedAt: now,
      },
      { merge: true },
    ),
    ...rows.map((row) => writer.set(decks.doc(row.id), row)),
  ]);
  console.log(
    `${rows.length}곡을 공유 라이브러리에 넣었습니다. 검색 색인도 함께 들어갔습니다.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("실행 실패:", err);
    process.exit(1);
  });
