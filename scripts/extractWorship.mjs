/**
 * 한국 인기 CCM 및 워십곡 가사 대량 수집 스크립트
 * 출처: 벅스 (Bugs Music)
 * 
 * 실행: node scripts/extractWorship.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const WORSHIP_DIR = path.join(ROOT_DIR, "data", "extracted", "worship");
const WORSHIP_JSON = path.join(ROOT_DIR, "data", "extracted", "worship.json");

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim();
}

const SEARCH_KEYWORDS = [
  // 1. 대표 워십팀
  "마커스워십",
  "제이어스",
  "어노인팅",
  "위러브",
  "아이자야씩스티원",
  "피아워십",
  "예람워십",
  "캠퍼스워십",
  "다윗의장막",
  "디사이플스",
  "예수전도단",
  "브리지임팩트",
  "헤븐조선",
  "팀룩원",
  "브라운워십",
  "라이트하우스",
  "텐트메이커스",
  "달빛마을",
  "홀리원",
  "트리니티",

  // 2. 대표 사역자 및 작곡가
  "손경민",
  "히즈윌",
  "레베카황",
  "소진영",
  "심종호",
  "박진희",
  "이길우",
  "송정미",
  "박종호",
  "강명식",
  "천관웅",
  "김도현",
  "염평안",

  // 3. 교회 대표 애창곡 스테디셀러
  "은혜로다",
  "꽃들도",
  "원하고 바라고 기도합니다",
  "광야를 지나며",
  "시간을 뚫고",
  "행복",
  "감사",
  "오직 예수뿐이네",
  "나는 예배자입니다",
  "주 품에",
  "주 은혜임을",
  "시선",
  "내 모습 이대로",
  "모든 시선을",
  "밤이나 낮이나",
  "이곳에서",
  "선한 능력으로",
  "하나님의 은혜",
  "내 갈급함",
  "주의 이름 높이며",
  "부르신 곳에서",
  "아름다우신",
  "예수 늘 함께 하시네",
  "온 땅의 주인",
  "주님 한 분만으로",
  "내 마음 다해",
  "주 없이 살 수 없네",
  "그 사랑",
  "여호와께 돌아가자",
  "나 무엇과도 주님을",
  "주의 자비가 내려와",
  "주님 다시 오실 때까지",
  "밀알",
  "공감하시네",
  "나의 한숨을 바꾸셨네",
  "선하신 목자",
  "주가 일하시네",
  "은혜",
];

async function searchTracks(keyword) {
  const url = `https://music.bugs.co.kr/search/track?q=${encodeURIComponent(keyword)}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) return [];
    const html = await res.text();

    const trackIds = [];
    const regex = /<a href="https:\/\/music\.bugs\.co\.kr\/track\/(\d+)[^"]*"\s+class="trackInfo"/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
      trackIds.push(match[1]);
    }
    return trackIds;
  } catch (err) {
    console.error(`[검색 오류] ${keyword}:`, err.message);
    return [];
  }
}

async function fetchTrackDetail(trackId) {
  const url = `https://music.bugs.co.kr/track/${trackId}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) return null;
    const html = await res.text();

    const titleMatch = html.match(/<meta property="sc:track_title" content="([^"]+)"\/>/);
    const artistMatch = html.match(/<meta property="sc:artist_nm" content="([^"]+)"\/>/);
    const albumMatch = html.match(/<meta property="sc:album_title" content="([^"]+)"\/>/);
    const xmpMatch = html.match(/<xmp>([\s\S]*?)<\/xmp>/);

    const title = titleMatch ? titleMatch[1].trim() : "";
    const artist = artistMatch ? artistMatch[1].trim() : "";
    const album = albumMatch ? albumMatch[1].trim() : "";
    const rawLyrics = xmpMatch ? xmpMatch[1].trim() : "";

    // 가사가 없거나 MR, Inst는 건너뜀
    if (!rawLyrics || rawLyrics.length < 20) return null;
    if (/\((?:MR|Inst\.?|Acoustic Instrumental)\)/i.test(title)) return null;

    // 가사 정제 (CRLF -> LF)
    const cleanedLyrics = rawLyrics
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .trim();

    return {
      trackId,
      title,
      artist,
      album,
      category: "워십/CCM",
      sourceUrl: url,
      lyricsRaw: cleanedLyrics,
    };
  } catch (err) {
    console.error(`[트랙 조회 오류] ${trackId}:`, err.message);
    return null;
  }
}

async function main() {
  await fs.mkdir(WORSHIP_DIR, { recursive: true });

  console.log("=== 한국 인기 워십/CCM 대량 수집 시작 ===");
  console.log(`검색 키워드 수: ${SEARCH_KEYWORDS.length}개`);

  // 1. 키워드별 트랙 ID 수집 (중복 제거)
  const uniqueTrackIds = new Set();
  for (let i = 0; i < SEARCH_KEYWORDS.length; i++) {
    const kw = SEARCH_KEYWORDS[i];
    process.stdout.write(`[${i + 1}/${SEARCH_KEYWORDS.length}] 키워드 '${kw}' 검색 중... `);
    const tracks = await searchTracks(kw);
    let added = 0;
    for (const tid of tracks) {
      if (!uniqueTrackIds.has(tid)) {
        uniqueTrackIds.add(tid);
        added++;
      }
    }
    console.log(`발견 ${tracks.length}곡 (신규 ${added}곡, 누적 ${uniqueTrackIds.size}곡)`);
    await new Promise((r) => setTimeout(r, 120));
  }

  const trackIdList = Array.from(uniqueTrackIds);
  console.log(`\n총 ${trackIdList.length}개의 고유 트랙을 탐색했습니다.`);
  console.log(`가사 상세 정보 수집을 시작합니다...\n`);

  // 2. 트랙별 상세 정보 및 가사 수집
  const concurrency = 3;
  const worshipSongs = [];
  let processed = 0;
  let skipped = 0;

  for (let i = 0; i < trackIdList.length; i += concurrency) {
    const chunk = trackIdList.slice(i, i + concurrency);
    const results = await Promise.all(chunk.map((id) => fetchTrackDetail(id)));

    for (const song of results) {
      if (!song) {
        skipped++;
        continue;
      }
      worshipSongs.push(song);

      // 파일명: [아티스트] 제목.txt
      const safeArtist = sanitizeFilename(song.artist || "Unknown");
      const safeTitle = sanitizeFilename(song.title);
      const filename = `[${safeArtist}] ${safeTitle}.txt`;
      const filePath = path.join(WORSHIP_DIR, filename);

      const fileContent = [
        `제목: ${song.title}`,
        `아티스트: ${song.artist}`,
        song.album ? `앨범: ${song.album}` : null,
        `출처: 벅스 (trackId: ${song.trackId})`,
        `구분: 워십 / CCM`,
        "--------------------------------------------------",
        song.lyricsRaw,
      ]
        .filter(Boolean)
        .join("\n");

      await fs.writeFile(filePath, fileContent, "utf-8");
    }

    processed += chunk.length;
    if (processed % 30 === 0 || processed >= trackIdList.length) {
      console.log(
        `진행: ${processed} / ${trackIdList.length} (${Math.round((processed / trackIdList.length) * 100)}%) - 유효 곡 ${worshipSongs.length}개, 제외 ${skipped}개`,
      );
    }

    await new Promise((r) => setTimeout(r, 150));
  }

  // 중복 곡명/아티스트 정리 후 제목순 정렬
  worshipSongs.sort((a, b) => a.title.localeCompare(b.title, "ko"));

  // 통합 JSON 저장
  await fs.writeFile(WORSHIP_JSON, JSON.stringify(worshipSongs, null, 2), "utf-8");

  console.log(`\n=== 워십/CCM 수집 완료! ===`);
  console.log(`- 유효 수집 곡 수: ${worshipSongs.length}곡 (가사 없는 곡 제외됨)`);
  console.log(`- 개별 파일 폴더: ${WORSHIP_DIR}`);
  console.log(`- 통합 JSON 파일: ${WORSHIP_JSON}`);
}

main().catch((err) => {
  console.error("실행 실패:", err);
  process.exit(1);
});
