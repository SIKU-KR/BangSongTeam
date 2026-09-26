/**
 * 보유 곡 수가 3곡 미만인 아티스트(1~2곡)를 노이즈로 보고 일괄 제거하는 스크립트
 * 
 * 실행: node scripts/filterUnderThreeSongs.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const CLEANED_WORSHIP_DIR = path.join(ROOT_DIR, "data", "cleaned", "worship");
const CLEANED_WORSHIP_JSON = path.join(ROOT_DIR, "data", "cleaned", "worship.json");

async function main() {
  console.log("=== 3곡 미만 아티스트 노이즈 제거 시작 ===");

  // 1. JSON 파일 로드
  const rawJson = await fs.readFile(CLEANED_WORSHIP_JSON, "utf-8");
  const worshipSongs = JSON.parse(rawJson);
  const initialCount = worshipSongs.length;

  // 2. 아티스트별 곡 수 카운트
  const artistCounts = {};
  for (const song of worshipSongs) {
    const artist = (song.artist || "Unknown").trim();
    artistCounts[artist] = (artistCounts[artist] || 0) + 1;
  }

  // 3곡 이상 보유 아티스트 Set
  const keepArtistsSet = new Set(
    Object.entries(artistCounts)
      .filter(([, count]) => count >= 3)
      .map(([artist]) => artist),
  );

  console.log(`- 전체 아티스트 수: ${Object.keys(artistCounts).length}개`);
  console.log(`- 3곡 이상 유지 아티스트 수: ${keepArtistsSet.size}개`);
  console.log(`- 3곡 미만 제거 아티스트 수: ${Object.keys(artistCounts).length - keepArtistsSet.size}개`);

  // 3. 곡 필터링
  const keptSongs = [];
  const removedSongs = [];

  for (const song of worshipSongs) {
    const artist = (song.artist || "Unknown").trim();
    if (keepArtistsSet.has(artist)) {
      keptSongs.push(song);
    } else {
      removedSongs.push(song);
    }
  }

  // 4. TXT 파일 삭제
  const dirFiles = await fs.readdir(CLEANED_WORSHIP_DIR);
  let deletedFilesCount = 0;

  for (const file of dirFiles) {
    if (!file.endsWith(".txt")) continue;

    // 파일명 형식: [아티스트] 제목.txt
    const match = file.match(/^\[(.*?)\]/);
    const artistInFile = match ? match[1].trim() : "Unknown";

    if (!keepArtistsSet.has(artistInFile)) {
      await fs.unlink(path.join(CLEANED_WORSHIP_DIR, file));
      deletedFilesCount++;
    }
  }

  // 5. worship.json 갱신
  await fs.writeFile(CLEANED_WORSHIP_JSON, JSON.stringify(keptSongs, null, 2), "utf-8");

  console.log(`\n=== 제거 완료 결과 ===`);
  console.log(`- 기존 곡 수: ${initialCount}곡`);
  console.log(`- 제거된 곡 수: ${removedSongs.length}곡`);
  console.log(`- 삭제된 개별 TXT 파일 수: ${deletedFilesCount}개`);
  console.log(`- 최종 유지된 핵심 워십 곡 수: ${keptSongs.length}곡`);
  console.log(`- 최종 유지된 대표 워십 아티스트 수: ${keepArtistsSet.size}개`);
  console.log(`- 갱신된 JSON 저장: ${CLEANED_WORSHIP_JSON}`);
}

main().catch((err) => {
  console.error("제거 실패:", err);
  process.exit(1);
});
