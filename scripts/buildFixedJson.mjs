/**
 * 현재 정제/선별된 텍스트 파일들을 기반으로 최종 JSON을 생성하고 픽스하는 스크립트
 * 
 * 생성 파일:
 * 1. data/cleaned/hymns.json (새찬송가 639곡)
 * 2. data/cleaned/worship.json (핵심 워십 1,202곡)
 * 3. data/cleaned/songs.json (찬송가 + 워십 전체 통합 1,841곡)
 * 
 * 구조:
 * {
 *   "title": "곡 제목",
 *   "artist": "아티스트명",
 *   "lyrics": "가사 본문 (개행 문자 \\n)"
 * }
 * 
 * 실행: node scripts/buildFixedJson.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

const CLEANED_DIR = path.join(ROOT_DIR, "data", "cleaned");
const HYMNS_DIR = path.join(CLEANED_DIR, "hymns");
const WORSHIP_DIR = path.join(CLEANED_DIR, "worship");

const OUTPUT_HYMNS_JSON = path.join(CLEANED_DIR, "hymns.json");
const OUTPUT_WORSHIP_JSON = path.join(CLEANED_DIR, "worship.json");
const OUTPUT_SONGS_JSON = path.join(CLEANED_DIR, "songs.json");

/**
 * 텍스트 파일 가사 정규화 (CRLF -> LF, 앞뒤 공백 제거)
 */
function normalizeLyrics(text) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

async function buildHymnsJson() {
  const files = await fs.readdir(HYMNS_DIR);
  const txtFiles = files.filter((f) => f.endsWith(".txt"));

  const hymns = [];

  for (const file of txtFiles) {
    const match = file.match(/^(\d{1,3})_(.+)\.txt$/);
    if (!match) continue;

    const num = parseInt(match[1], 10);
    const rawTitle = match[2].trim();
    const title = `${num}장 ${rawTitle}`;
    const artist = "새찬송가";

    const content = await fs.readFile(path.join(HYMNS_DIR, file), "utf-8");
    const lyrics = normalizeLyrics(content);

    hymns.push({
      number: num,
      title,
      artist,
      lyrics,
    });
  }

  // 찬송가 번호순 정렬
  hymns.sort((a, b) => a.number - b.number);

  return hymns;
}

async function buildWorshipJson() {
  const files = await fs.readdir(WORSHIP_DIR);
  const txtFiles = files.filter((f) => f.endsWith(".txt"));

  const worshipList = [];

  for (const file of txtFiles) {
    const match = file.match(/^\[(.*?)\]\s*(.+)\.txt$/);
    if (!match) continue;

    const artist = match[1].trim();
    const title = match[2].trim();

    const content = await fs.readFile(path.join(WORSHIP_DIR, file), "utf-8");
    const lyrics = normalizeLyrics(content);

    worshipList.push({
      title,
      artist,
      lyrics,
    });
  }

  // 아티스트명 가나다순, 동일 아티스트 내 제목순 정렬
  worshipList.sort((a, b) => {
    const artistCompare = a.artist.localeCompare(b.artist, "ko");
    if (artistCompare !== 0) return artistCompare;
    return a.title.localeCompare(b.title, "ko");
  });

  return worshipList;
}

async function main() {
  console.log("=== 최종 가사 데이터 JSON 빌드 & 픽스 시작 ===");

  // 1. 찬송가 빌드
  const hymns = await buildHymnsJson();
  console.log(`- 새찬송가: ${hymns.length}곡 로드 완료`);

  // 2. 워십곡 빌드
  const worship = await buildWorshipJson();
  console.log(`- 핵심 워십/CCM: ${worship.length}곡 로드 완료`);

  // 3. 전체 통합 리스트
  const allSongs = [
    ...hymns.map(({ title, artist, lyrics }) => ({
      category: "찬송가",
      title,
      artist,
      lyrics,
    })),
    ...worship.map(({ title, artist, lyrics }) => ({
      category: "워십/CCM",
      title,
      artist,
      lyrics,
    })),
  ];
  console.log(`- 전체 통합 목록: ${allSongs.length}곡 생성`);

  // 4. JSON 파일 저장
  await fs.writeFile(OUTPUT_HYMNS_JSON, JSON.stringify(hymns, null, 2), "utf-8");
  await fs.writeFile(OUTPUT_WORSHIP_JSON, JSON.stringify(worship, null, 2), "utf-8");
  await fs.writeFile(OUTPUT_SONGS_JSON, JSON.stringify(allSongs, null, 2), "utf-8");

  console.log(`\n=== JSON 픽스 완료 ===`);
  console.log(`1. 새찬송가 JSON: ${OUTPUT_HYMNS_JSON} (${hymns.length}곡)`);
  console.log(`2. 워십/CCM JSON: ${OUTPUT_WORSHIP_JSON} (${worship.length}곡)`);
  console.log(`3. 전체 통합 JSON: ${OUTPUT_SONGS_JSON} (${allSongs.length}곡)`);
}

main().catch((err) => {
  console.error("JSON 빌드 실패:", err);
  process.exit(1);
});
