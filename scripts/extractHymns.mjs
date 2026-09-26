/**
 * 새찬송가 1장~645장 전곡 가사 수집 스크립트
 * 출처: 다국어 성경 HolyBible (http://www.holybible.or.kr)
 * 
 * 실행: node scripts/extractHymns.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const HYMNS_DIR = path.join(ROOT_DIR, "data", "extracted", "hymns");
const HYMNS_JSON = path.join(ROOT_DIR, "data", "extracted", "hymns.json");

function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim();
}

async function fetchHymn(num) {
  const url = `http://www.holybible.or.kr/NHYMN/cgi/hymnftxt.php?VR=NHYMN&DN=${num}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for Hymn ${num}`);
  }
  const buffer = await res.arrayBuffer();
  const html = new TextDecoder("euc-kr").decode(buffer);

  // 제목 및 구 찬송가 번호 추출
  // 예: <b>288. 예수를 나의 구주 삼고</b>\n [(구)204장]
  const titleMatch = html.match(/<b>(\d+)\.\s*([^<]+)<\/b>(?:\s*\[([^\]]+)\])?/);
  if (!titleMatch) {
    throw new Error(`Title not found for Hymn ${num}`);
  }

  const hymnNo = parseInt(titleMatch[1], 10);
  const title = titleMatch[2].trim();
  const oldHymn = titleMatch[3] ? titleMatch[3].trim() : "";

  // 가사 절/후렴 행 추출
  const rows = [
    ...html.matchAll(
      /<TR>\s*<TD width=40><\/TD>\s*<TD align=right valign=top class=tk4l><nobr>(.*?)<\/nobr><\/TD>\s*<TD align=left valign=top class=tk4l>(.*?)<\/TD>\s*<TD width=40><\/TD>\s*<\/TR>/gs,
    ),
  ];

  const sections = [];
  const rawSectionsText = [];

  for (const r of rows) {
    let label = r[1].replace(/<[^>]+>/g, "").replace(/&nbsp;?/g, " ").trim();
    const text = r[2].replace(/<[^>]+>/g, "").replace(/&nbsp;?/g, " ").trim();

    if (label.endsWith(".")) {
      label = `[${label.slice(0, -1)}절]`;
    } else if (!label.startsWith("[")) {
      label = `[${label}]`;
    }

    sections.push({ label, text });
    rawSectionsText.push(`${label}\n${text}`);
  }

  // 전체 원문 가사 (빈 줄로 절 구분)
  const lyricsRaw = rawSectionsText.join("\n\n");

  return {
    number: hymnNo,
    title,
    oldHymn,
    category: "새찬송가",
    sections,
    lyricsRaw,
  };
}

async function main() {
  await fs.mkdir(HYMNS_DIR, { recursive: true });

  console.log("새찬송가 (1장 ~ 645장) 수집을 시작합니다...");

  const allHymns = [];
  const concurrency = 5;
  const total = 645;
  let completed = 0;

  for (let i = 1; i <= total; i += concurrency) {
    const chunk = [];
    for (let j = i; j < i + concurrency && j <= total; j++) {
      chunk.push(j);
    }

    const results = await Promise.all(
      chunk.map(async (num) => {
        try {
          const hymn = await fetchHymn(num);
          return hymn;
        } catch (err) {
          console.error(`[오류] 찬송가 ${num}장 수집 실패:`, err.message);
          return null;
        }
      }),
    );

    for (const hymn of results) {
      if (!hymn) continue;
      allHymns.push(hymn);

      const paddedNum = String(hymn.number).padStart(3, "0");
      const filename = `${paddedNum}_${sanitizeFilename(hymn.title)}.txt`;
      const filePath = path.join(HYMNS_DIR, filename);

      const fileContent = [
        `장수: ${hymn.number}장`,
        `제목: ${hymn.title}`,
        hymn.oldHymn ? `구찬송가: ${hymn.oldHymn}` : null,
        `구분: 새찬송가`,
        "--------------------------------------------------",
        hymn.lyricsRaw,
      ]
        .filter(Boolean)
        .join("\n");

      await fs.writeFile(filePath, fileContent, "utf-8");
    }

    completed += chunk.length;
    if (completed % 50 === 0 || completed === total) {
      console.log(`진행률: ${completed} / ${total} 장 (${Math.round((completed / total) * 100)}%)`);
    }

    // 서버 부하 방지를 위한 딜레이
    await new Promise((resolve) => setTimeout(resolve, 80));
  }

  // 번호순 정렬
  allHymns.sort((a, b) => a.number - b.number);

  // 통합 JSON 저장
  await fs.writeFile(HYMNS_JSON, JSON.stringify(allHymns, null, 2), "utf-8");

  console.log(`\n수집 완료!`);
  console.log(`- 개별 파일: ${HYMNS_DIR} (총 ${allHymns.length}개 .txt)`);
  console.log(`- 통합 JSON: ${HYMNS_JSON}`);
}

main().catch((err) => {
  console.error("실행 실패:", err);
  process.exit(1);
});
