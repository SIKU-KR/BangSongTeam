/**
 * 유형 1~4 (대중가요/팝, 키즈/동요, 성가대/클래식, Unknown) 아티스트 일괄 제거 스크립트
 * 
 * 실행: node scripts/removeNonWorshipArtists.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const CLEANED_WORSHIP_DIR = path.join(ROOT_DIR, "data", "cleaned", "worship");
const CLEANED_WORSHIP_JSON = path.join(ROOT_DIR, "data", "cleaned", "worship.json");

// 제거 대상 아티스트 명단 (72개 아티스트)
const REMOVE_ARTIST_SET = new Set([
  // 유형 4: 미상
  "Unknown",
  "",

  // 유형 1: 대중가요 / 트로트 / 해외팝 / OST / 아이돌
  "이수만",
  "아이비(IVY)",
  "김소년 (BoyKim)",
  "Westlife(웨스트라이프)",
  "Hirahara Ayaka(히라하라 아야카/平原綾香)",
  "Various Artists",
  "라딧(Ladeat)",
  "MC몽",
  "이은미",
  "센티멘탈 시너리(Sentimental Scenery)",
  "Rich Redd Tae",
  "정의송",
  "장태화",
  "국립국악원(National Gugak Center)",
  "Disciples(디사이플스)", // 해외 EDM DJ
  "Peder Elias",
  "TEMPEST(템페스트)",
  "Okean Elzy",
  "Halsey(할시)",
  "김동률",
  "김용빈",
  "나훈아",
  "홍경민",
  "설민",
  "강찬구",
  "단테 루이스",
  "TODAY LOVER",
  "The012project",
  "신화",
  "맥스플라이(Maxfli)",
  "런치송 프로젝트",
  "채환",
  "오션(5tion)",
  "그리하여",
  "서상철",
  "진송남",
  "정잘해",
  "윤소안",
  "이인",
  "XIA(준수)",
  "적우(Red Sun)",
  "버벌진트(Verbal Jint)",
  "손준호",
  "코스타(Kosta)",
  "Lighthouse Family(라이트하우스 패밀리)",
  "ONEWE(원위)",

  // 유형 2: 어린이 / 키즈 / 동요 / 주일학교 전용
  "트리니티 키즈(Trinity Kids)",
  "사랑의 교회 캔송키즈(Can Song Kids)",
  "파이디온선교회",
  "김한희",
  "AAM",
  "노아 틴",
  "울산동요사랑회",
  "초록아이",
  "리뉴잉찬양보컬학교 2기",
  "예성교육국",
  "키즈벤처(Kidzventure)",
  "포유키즈(For You Kids)",
  "전국교회학교연합회(고신)",
  "교회학교 성장 연구소",
  "Jirani Children's Choir(지라니 어린이 합창단)",
  "키즈엘(Kids엘)",
  "드림아이(Dream-i)",

  // 유형 3: 성가대 / 클래식 콰이어 / 오케스트라 / 성악
  "클래식콰이어",
  "CCM성가합창",
  "박신화 콰이어",
  "레비파티콰이어(LEVIPARTY CHOIR)",
  "와이즈뮤직챔버콰이어",
  "가스펠콰이어",
  "국립심포니오케스트라",
  "하늘소리콰이어",
  "김순영", // 소프라노 독창 성악
]);

async function main() {
  console.log("=== 유형 1~4 아티스트 제거 시작 ===");
  console.log(`- 제거 대상 아티스트 수: ${REMOVE_ARTIST_SET.size}개`);

  // 1. JSON 파일 로드 및 필터링
  const rawJson = await fs.readFile(CLEANED_WORSHIP_JSON, "utf-8");
  const worshipSongs = JSON.parse(rawJson);
  const initialCount = worshipSongs.length;

  const keptSongs = [];
  const removedSongs = [];

  for (const song of worshipSongs) {
    const artist = (song.artist || "Unknown").trim();
    if (REMOVE_ARTIST_SET.has(artist)) {
      removedSongs.push(song);
    } else {
      keptSongs.push(song);
    }
  }

  // 2. 텍스트 파일 삭제 (data/cleaned/worship/)
  const dirFiles = await fs.readdir(CLEANED_WORSHIP_DIR);
  let deletedFilesCount = 0;

  for (const file of dirFiles) {
    if (!file.endsWith(".txt")) continue;

    // 파일명 형식: [아티스트] 제목.txt
    const match = file.match(/^\[(.*?)\]/);
    const artistInFile = match ? match[1].trim() : "Unknown";

    if (REMOVE_ARTIST_SET.has(artistInFile) || file.startsWith("[Unknown]")) {
      await fs.unlink(path.join(CLEANED_WORSHIP_DIR, file));
      deletedFilesCount++;
    }
  }

  // 3. 정제된 worship.json 다시 저장
  await fs.writeFile(CLEANED_WORSHIP_JSON, JSON.stringify(keptSongs, null, 2), "utf-8");

  console.log(`\n=== 제거 완료 결과 ===`);
  console.log(`- 기존 총 곡 수: ${initialCount}곡`);
  console.log(`- 제거된 곡 수: ${removedSongs.length}곡`);
  console.log(`- 삭제된 개별 TXT 파일 수: ${deletedFilesCount}개`);
  console.log(`- 최종 유지된 워십/CCM 곡 수: ${keptSongs.length}곡`);
  console.log(`- 최종 JSON 저장: ${CLEANED_WORSHIP_JSON}`);
}

main().catch((err) => {
  console.error("제거 실패:", err);
  process.exit(1);
});
