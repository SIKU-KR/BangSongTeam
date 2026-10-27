/**
 * 회원 탈퇴 요청을 처리한다: 한 사용자의 계정과 데이터를 모두 지운다
 * (`src/db/ops/deleteUser.ts`). 개인정보처리방침이 약속한 파기다. 요청한 사람이 그 계정의 주인인지는
 * 먼저 따로 확인한다(요청 메일이 그 계정의 이메일에서 왔는지 등). 대상별 준비는 `lib/targets.mjs`를
 * 따른다.
 *
 * 사용법:
 *   node scripts/deleteUser.mjs <사용자 id>                          # 지울 데이터 수만 센다
 *   node scripts/deleteUser.mjs <사용자 id> --apply                  # 로컬 에뮬레이터에서 지운다
 *   node scripts/deleteUser.mjs <사용자 id> --target=remote          # 운영 Firestore에서 센다
 *   node scripts/deleteUser.mjs <사용자 id> --target=remote --apply  # 운영 Firestore에서 지운다
 *
 * `--apply`는 먼저 로그인 수단(세션·연결된 로그인·사용자 문서)을 지우고, 이미 로그인한 기기의 세션
 * 쿠키 캐시가 끝날 때까지 기다린 뒤 데이터를 지운다. 그사이 그 기기가 저장하거나 다시 올린 데이터까지
 * 지우기 위해서다. 로컬 에뮬레이터는 기다리지 않는다. 끝나면 남은 데이터를 다시 세고, 남았으면 1로
 * 끝난다. 중간에 멈춰도 같은 명령을 다시 실행하면 이어서 지운다.
 *
 * 다른 사용자가 가져간 곡은 그 사람의 것이라 남기고 원본 연결만 끊는다. 게시 중단 운영 기록은 남긴다.
 * `--target=remote`는 세기만 하더라도 주인에게 먼저 확인받는다.
 */

import {
  applyTarget,
  assertEmulatorUp,
  describeTarget,
  importSource,
  parseOptions,
  runScript,
} from "./lib/targets.mjs";

const USER_ID = /^[\w-]{21}$/;

const WAIT_MARGIN_SECONDS = 30;

const LABELS = {
  user: "사용자 문서",
  sessions: "로그인 세션",
  accounts: "연결된 로그인",
  presentations: "프레젠테이션",
  libraryDecks: "보관함 곡",
  otherDecks: "프레젠테이션 사본",
  folders: "폴더",
  memberships: "링크로 들어간 다른 사람의 프레젠테이션",
  tombstones: "영구 삭제 기록",
  reports: "낸 신고 (신고 내용은 남기고 신고자만 비움)",
  quotas: "하루 한도 기록",
  forksByOthers: "다른 사용자가 가져간 곡 (남기고 연결만 끊음)",
};

function printCounts(title, counts) {
  console.log(title);
  for (const [key, value] of Object.entries(counts)) {
    console.log(`  ${LABELS[key] ?? key}: ${value}`);
  }
}

async function main() {
  const { positionals, flags } = parseOptions(process.argv.slice(2), {
    apply: "boolean",
  });
  const [userId, ...rest] = positionals;
  if (userId === undefined || rest.length > 0) {
    throw new Error("사용자 id를 하나만 적어 주세요");
  }
  if (!USER_ID.test(userId)) {
    throw new Error(`사용자 id는 21자 NanoID예요: ${userId}`);
  }
  const target = flags.target ?? "local";
  const apply = flags.apply === true;
  applyTarget(target);
  await assertEmulatorUp();

  const [{ getFirestore }, ops, shared] = await Promise.all([
    importSource("src/db/client.ts"),
    importSource("src/db/ops/deleteUser.ts"),
    importSource("src/shared/index.ts"),
  ]);
  if (userId === shared.OFFICIAL_LIBRARY_USER_ID) {
    throw new Error("공식 라이브러리 계정은 지울 수 없어요");
  }
  const db = getFirestore();
  console.log(`대상: ${describeTarget(target)}`);
  printCounts(`${userId}의 데이터`, await ops.countUserData(db, userId));
  if (!apply) {
    console.log(
      "미리보기라 아무것도 지우지 않았어요. 지우려면 --apply를 붙여 주세요.",
    );
    return;
  }

  const revoked = await ops.revokeUserAccess(db, userId);
  console.log(
    `로그인 수단을 지웠어요: 세션 ${revoked.sessions}개, 연결된 로그인 ${revoked.accounts}개, 사용자 문서 ${revoked.user ? 1 : 0}개`,
  );
  if (target === "remote") {
    const { SESSION_COOKIE_CACHE_SECONDS } = await importSource(
      "src/server/lib/auth.ts",
    );
    const waitSeconds = SESSION_COOKIE_CACHE_SECONDS + WAIT_MARGIN_SECONDS;
    console.log(
      `로그인한 기기의 세션 캐시가 끝나도록 ${waitSeconds}초 기다려요. 멈추면 같은 명령을 다시 실행해 주세요.`,
    );
    await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
  }

  const result = await ops.deleteUserData(db, userId);
  printCounts("남은 데이터", result.remaining);
  if (Object.values(result.remaining).some((value) => value > 0)) {
    console.error("아직 남은 데이터가 있어요. 같은 명령을 다시 실행해 주세요.");
    process.exitCode = 1;
    return;
  }
  console.log("계정과 데이터를 모두 지웠어요.");
}

runScript(main);
