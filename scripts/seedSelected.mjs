/**
 * 선별된 가사 텍스트 파일들을 BangSongTeam 공유 라이브러리(D1 DB)로 시드하는 스크립트
 * 
 * 사용법:
 *   1. data/extracted/selected/ 폴더에 업로드하고 싶은 .txt 파일들을 복사합니다.
 *   2. 로컬 D1에 적재:
 *      node scripts/seedSelected.mjs --target=local
 *   3. 원격(배포) D1에 적재:
 *      node scripts/seedSelected.mjs --target=remote
 * 
 * 옵션:
 *   --dir=<경로>    지정한 디렉터리의 txt 파일들을 읽어옵니다. (기본값: data/extracted/selected)
 *   --json=<경로>   txt 폴더 대신 `{ title, artist, lyrics }` 배열 JSON(예: data/cleaned/songs.json)을 읽어옵니다.
 *   --dry-run       DB에 실행하지 않고 SQL 파일(data/seed.sql)만 생성합니다.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const SELECTED_DIR = path.join(ROOT_DIR, "data", "cleaned", "selected");
const OUTPUT_SQL = path.join(ROOT_DIR, "data", "seed_decks.sql");

// 시스템 공식 봇 계정 ID. 덱 응답의 userId가 IdSchema(21자)를 통과해야 해서 21자로 맞춘다.
const SEED_BOT_USER_ID = "bot-seed-official-lib";
const SEED_BOT_NAME = "공식 찬양 라이브러리";

/**
 * src/shared/utils/id.ts의 createId·createSlideId와 같은 형식
 */
function createId() {
  return nanoid();
}

function createSlideId() {
  return `s_${nanoid(10)}`;
}

/**
 * 앞뒤 공백 정리
 */
function sanitizeLyricLine(line) {
  return line.replace(/^[\s\u00A0\u3000\u200B\uFEFF]+|[\s\u00A0\u3000\u200B\uFEFF]+$/g, "");
}

const MAX_SLIDE_LINES = 4;
const MAX_SLIDE_LINE_LENGTH = 80;

function wrapLyricLine(line) {
  if (line.length <= MAX_SLIDE_LINE_LENGTH) return [line];

  const text = sanitizeLyricLine(line);
  if (text.length <= MAX_SLIDE_LINE_LENGTH) return [text];

  const ideal = text.length / Math.ceil(text.length / MAX_SLIDE_LINE_LENGTH);
  let space = -1;
  for (let i = 1; i <= MAX_SLIDE_LINE_LENGTH; i++) {
    if (
      /\s/.test(text[i]) &&
      (space < 0 || Math.abs(i - ideal) < Math.abs(space - ideal))
    ) {
      space = i;
    }
  }
  const cut = space < 0 ? MAX_SLIDE_LINE_LENGTH : space;

  return [
    sanitizeLyricLine(text.slice(0, cut)),
    ...wrapLyricLine(sanitizeLyricLine(text.slice(cut))),
  ];
}

function fitLinesToSlides(lines) {
  const units = lines.map(wrapLyricLine);
  const wrapped = units.flat();
  if (wrapped.length <= MAX_SLIDE_LINES) return [wrapped];

  const chunks = [];
  let current = [];
  for (const unit of units) {
    if (current.length > 0 && current.length + unit.length > 2) {
      chunks.push(current);
      current = [];
    }
    for (const piece of unit) {
      if (current.length === 2) {
        chunks.push(current);
        current = [];
      }
      current.push(piece);
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * 슬라이드 분할 규칙 (src/shared/utils/lyrics.ts 동일)
 */
function splitLyricsIntoSlides(rawText) {
  const rawLines = rawText.split(/\r?\n/);
  const blocks = [];
  let currentBlock = [];

  for (const rawLine of rawLines) {
    const cleaned = sanitizeLyricLine(rawLine);
    if (cleaned.length === 0) {
      if (currentBlock.length > 0) {
        blocks.push(currentBlock);
        currentBlock = [];
      }
    } else {
      currentBlock.push(cleaned);
    }
  }
  if (currentBlock.length > 0) {
    blocks.push(currentBlock);
  }

  return blocks
    .flatMap(fitLinesToSlides)
    .map((lines, order) => ({ id: createSlideId(), order, lines }));
}

/**
 * 기본 덱 스타일 (src/shared/schemas/style.ts 기본값)
 */
const DEFAULT_DECK_STYLE = {
  overlayOpacity: 40,
  overlayColor: "#000000",
  fontFamily: "Pretendard",
  fontSizeVw: 4.2,
  fontColor: "#FFFFFF",
  textAlign: "center",
  lineHeight: 1.4,
  textShadowLevel: "medium",
  position: {
    anchor: "middle-center",
    xPercent: 50,
    yPercent: 50,
    widthPercent: 80,
  },
};

/**
 * 텍스트 파일 파싱 (헤더 메타데이터 또는 파일명에서 곡 정보 추출)
 */
function parseTextFile(content, fileName = "") {
  const delimiterIndex = content.indexOf("--------------------------------------------------");
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

function escapeSql(str) {
  return str.replace(/'/g, "''");
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
    console.log(`\n팁: data/cleaned/hymns 또는 data/cleaned/worship 에서 원하는 곡들을`);
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
  const args = process.argv.slice(2);
  const target = args.find((a) => a.startsWith("--target="))?.split("=")[1] || "local";
  const customDir = args.find((a) => a.startsWith("--dir="))?.split("=")[1];
  const jsonFile = args.find((a) => a.startsWith("--json="))?.split("=")[1];
  const dryRun = args.includes("--dry-run");

  const source = jsonFile
    ? path.resolve(ROOT_DIR, jsonFile)
    : customDir
      ? path.resolve(ROOT_DIR, customDir)
      : SELECTED_DIR;
  const songs = jsonFile ? await loadSongsFromJson(source) : await loadSongsFromDir(source);
  if (!songs) return;

  console.log(`=== 시드 생성 시작 ===`);
  console.log(`- 원본: ${source}`);
  console.log(`- 처리할 곡: ${songs.length}개`);
  console.log(`- 대상 데이터베이스: ${target === "remote" ? "원격(Remote)" : "로컬(Local)"}`);

  const nowMs = Date.now();
  const nowUnix = Math.floor(nowMs / 1000);
  const sqlStatements = [];

  // 1. 공식 봇 유저 생성 (없을 경우 INSERT OR IGNORE)
  sqlStatements.push(`-- 1. 시드용 시스템 봇 유저 보장`);
  sqlStatements.push(
    `INSERT OR IGNORE INTO user (id, name, email, email_verified, image, created_at, updated_at) VALUES ('${SEED_BOT_USER_ID}', '${escapeSql(SEED_BOT_NAME)}', 'library@worship.local', 1, NULL, ${nowUnix}, ${nowUnix});`,
  );

  // 2. 각 곡별 덱 SQL 생성. 봇 계정에 같은 제목·아티스트 곡이 있으면 건너뛰어 다시 실행해도 중복되지 않는다.
  sqlStatements.push(`\n-- 2. 선별 덱 삽입`);

  let count = 0;
  for (const { label, title, artist, lyricsRaw } of songs) {
    if (!lyricsRaw || lyricsRaw.length < 5) {
      console.warn(`[건너뜀] 가사 내용 부족: ${label}`);
      continue;
    }

    const slides = splitLyricsIntoSlides(lyricsRaw);
    const deckId = createId();

    const sql = `INSERT INTO decks (id, user_id, title, artist, lyrics_raw, slides, style, visibility, published_at, created_at, updated_at) SELECT '${deckId}', '${SEED_BOT_USER_ID}', '${escapeSql(title)}', '${escapeSql(artist)}', '${escapeSql(lyricsRaw)}', '${escapeSql(JSON.stringify(slides))}', '${escapeSql(JSON.stringify(DEFAULT_DECK_STYLE))}', 'public', ${nowMs}, ${nowMs}, ${nowMs} WHERE NOT EXISTS (SELECT 1 FROM decks WHERE user_id = '${SEED_BOT_USER_ID}' AND presentation_id IS NULL AND title = '${escapeSql(title)}' AND artist = '${escapeSql(artist)}');`;

    sqlStatements.push(sql);
    count++;
  }

  const finalSql = sqlStatements.join("\n");
  await fs.writeFile(OUTPUT_SQL, finalSql, "utf-8");

  console.log(`\nSQL 배치 파일 생성 완료: ${OUTPUT_SQL} (총 ${count}곡)`);

  if (dryRun) {
    console.log(`--dry-run 모드이므로 DB 실행을 건너뜁니다.`);
    return;
  }

  // 3. wrangler d1 execute 실행
  console.log(`\nD1에 시드 주입 중... (wrangler d1 execute DB)`);
  const wranglerCmd = `pnpm exec wrangler d1 execute DB ${target === "remote" ? "--remote" : "--local"} --file=${OUTPUT_SQL}`;

  try {
    execSync(wranglerCmd, { stdio: "inherit", cwd: ROOT_DIR });
    console.log(`\n성공적으로 ${count}곡이 D1 데이터베이스에 시드되었습니다!`);
    console.log(`FTS5 전문 검색 색인도 자동으로 반영되었습니다.`);
  } catch (err) {
    console.error(`\nD1 적재 중 오류 발생:`, err.message);
  }
}

main().catch((err) => {
  console.error("실행 실패:", err);
  process.exit(1);
});
