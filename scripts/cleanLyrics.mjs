/**
 * 수집된 가사 텍스트 데이터 전처리 스크립트
 * 
 * 전처리 규칙:
 * 1. 상단 메타데이터 헤더(제목, 아티스트, 출처, 구분선) 완전 제거
 * 2. 찬송가 및 가사 내 [1절], [2절], [후렴] 등 섹션 라벨 제거
 * 3. 각 줄의 앞뒤 공백 및 전각 공백 정리
 * 4. 모든 빈 줄(공백 라인/줄바꿈 라인) 제거하여 순수 가사 줄만 연속되도록 정제
 * 5. 원본(data/extracted/)은 보존하고 data/cleaned/ 폴더에 저장
 * 
 * 실행: node scripts/cleanLyrics.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

const EXTRACTED_DIR = path.join(ROOT_DIR, "data", "extracted");
const CLEANED_DIR = path.join(ROOT_DIR, "data", "cleaned");

const HYMNS_SRC = path.join(EXTRACTED_DIR, "hymns");
const HYMNS_DEST = path.join(CLEANED_DIR, "hymns");

const WORSHIP_SRC = path.join(EXTRACTED_DIR, "worship");
const WORSHIP_DEST = path.join(CLEANED_DIR, "worship");

/**
 * 앞뒤 일반 공백 및 전각 공백(\u3000), 특수 공백(\u00A0, \uFEFF 등) 제거
 */
function sanitizeLyricLine(line) {
  return line.replace(/^[\s\u00A0\u3000\u200B\uFEFF]+|[\s\u00A0\u3000\u200B\uFEFF]+$/g, "");
}

/**
 * 가사 텍스트 전처리
 */
function cleanLyricsText(rawContent) {
  // 1. 메타데이터 구분선 이후 본문만 추출
  const delimiterIndex = rawContent.indexOf("--------------------------------------------------");
  const bodyText = delimiterIndex !== -1 ? rawContent.slice(delimiterIndex + 50) : rawContent;

  const rawLines = bodyText.split(/\r?\n/);
  const cleanedLines = [];

  for (const rawLine of rawLines) {
    const cleaned = sanitizeLyricLine(rawLine);

    // 빈 줄 건너뜀
    if (cleaned.length === 0) continue;

    // [1절], [2절], [후렴], [Chorus], [Bridge], [Verse 1] 등 라벨 건너뜀
    if (/^\[.*?\]$/.test(cleaned)) continue;

    // "1.", "2." 처럼 절 번호만 단독으로 있는 줄 건너뜀
    if (/^\d+\.?$/.test(cleaned)) continue;

    cleanedLines.push(cleaned);
  }

  // 공백 라인 없이 연속된 가사 줄로 반환
  return cleanedLines.join("\n");
}

async function processDirectory(srcDir, destDir, label) {
  await fs.mkdir(destDir, { recursive: true });

  const files = await fs.readdir(srcDir);
  const txtFiles = files.filter((f) => f.endsWith(".txt"));

  console.log(`[${label}] 총 ${txtFiles.length}개 파일 전처리 중...`);

  let count = 0;
  for (const file of txtFiles) {
    const srcPath = path.join(srcDir, file);
    const destPath = path.join(destDir, file);

    const raw = await fs.readFile(srcPath, "utf-8");
    const cleaned = cleanLyricsText(raw);

    await fs.writeFile(destPath, cleaned, "utf-8");
    count++;
  }

  console.log(`[${label}] 전처리 완료: ${count}개 저장 -> ${destDir}`);
  return count;
}

async function processJsonFiles() {
  // 1. 찬송가 JSON 전처리
  const hymnsJsonPath = path.join(EXTRACTED_DIR, "hymns.json");
  try {
    const raw = await fs.readFile(hymnsJsonPath, "utf-8");
    const hymns = JSON.parse(raw);

    const cleanedHymns = hymns.map((h) => {
      const cleanedLyrics = cleanLyricsText(h.lyricsRaw);
      return {
        ...h,
        lyricsRaw: cleanedLyrics,
      };
    });

    const destPath = path.join(CLEANED_DIR, "hymns.json");
    await fs.writeFile(destPath, JSON.stringify(cleanedHymns, null, 2), "utf-8");
    console.log(`[새찬송가 JSON] 전처리 완료 -> ${destPath}`);
  } catch (err) {
    console.warn(`[찬송가 JSON 처리 경고]:`, err.message);
  }

  // 2. 워십 JSON 전처리
  const worshipJsonPath = path.join(EXTRACTED_DIR, "worship.json");
  try {
    const raw = await fs.readFile(worshipJsonPath, "utf-8");
    const worship = JSON.parse(raw);

    const cleanedWorship = worship.map((w) => {
      const cleanedLyrics = cleanLyricsText(w.lyricsRaw);
      return {
        ...w,
        lyricsRaw: cleanedLyrics,
      };
    });

    const destPath = path.join(CLEANED_DIR, "worship.json");
    await fs.writeFile(destPath, JSON.stringify(cleanedWorship, null, 2), "utf-8");
    console.log(`[워십/CCM JSON] 전처리 완료 -> ${destPath}`);
  } catch (err) {
    console.warn(`[워십 JSON 처리 경고]:`, err.message);
  }
}

async function main() {
  await fs.mkdir(CLEANED_DIR, { recursive: true });
  await fs.mkdir(path.join(CLEANED_DIR, "selected"), { recursive: true });

  console.log("=== 가사 데이터 전처리 시작 ===");
  console.log("- 대상: 헤더 메타데이터 제거, 절 라벨 제거, 공백라인 제거");
  console.log(`- 결과 폴더: ${CLEANED_DIR}\n`);

  const hymnsCount = await processDirectory(HYMNS_SRC, HYMNS_DEST, "새찬송가");
  const worshipCount = await processDirectory(WORSHIP_SRC, WORSHIP_DEST, "워십/CCM");
  await processJsonFiles();

  console.log(`\n=== 전처리 최종 완료 ===`);
  console.log(`- 새찬송가: ${hymnsCount}곡`);
  console.log(`- 워십/CCM: ${worshipCount}곡`);
  console.log(`- 총합: ${hymnsCount + worshipCount}곡`);
  console.log(`- 저장 위치: ${CLEANED_DIR}`);
}

main().catch((err) => {
  console.error("전처리 실패:", err);
  process.exit(1);
});
