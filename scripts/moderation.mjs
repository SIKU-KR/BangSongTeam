/**
 * 공개 곡 신고·게시 중단·계정 정리 처리. 관리자 화면 대신 이 스크립트로
 * `src/db/ops/moderation.ts`를 부른다. 대상별 준비는 `lib/targets.mjs`, 명령 처리는
 * `lib/moderationCli.mjs`를 따른다.
 *
 * 사용법:
 *   node scripts/moderation.mjs list [--limit=<n>]                    # 처리 대기 신고 (오래된 순, 신고자·곡 주인 포함)
 *   node scripts/moderation.mjs descendants <곡 id>                   # 이 곡에서 가져간 보관함 곡 (가져간 곡을 다시 가져간 곡까지, 비공개 포함). blockedBy는 공개를 막는 게시 중단된 원곡
 *   node scripts/moderation.mjs user-decks <사용자 id>                # 계정의 보관함 곡
 *   node scripts/moderation.mjs takedown <곡 id>... --note=<사유>     # 게시 중단 + 그 곡의 신고 처리 완료
 *   node scripts/moderation.mjs takedown <곡 id>... --with-forks --note=<사유>  # 가져간 곡도 함께 게시 중단
 *   node scripts/moderation.mjs takedown-user <사용자 id>... --note=<사유>   # 계정의 보관함 곡 모두 중단 (먼저 user-decks로 확인)
 *   node scripts/moderation.mjs revoke-sessions <사용자 id>...        # 계정의 로그인 끊기
 *   node scripts/moderation.mjs restore <곡 id> [--republish] --note=<사유>  # 게시 중단 해제 (기본은 비공개 유지). 원곡이나 가져간 곡이 아직 게시 중단돼 있으면 알린다
 *   node scripts/moderation.mjs ban <사용자 id> --note=<사유>         # 계정 제한: 공개·가져오기·신고를 막고 공개 곡을 게시 중단, 로그인 세션 종료
 *   node scripts/moderation.mjs unban <사용자 id> --note=<사유>       # 계정 제한 해제 (게시 중단한 곡은 restore로 하나씩 푼다)
 *   node scripts/moderation.mjs resolve <신고 id> --note=<메모> [--force]
 *   node scripts/moderation.mjs reject <신고 id> --note=<메모> [--force]
 *   node scripts/moderation.mjs reject-by-reporter <사용자 id> --note=<메모>   # 한 사람이 낸 대기 신고 모두 기각
 *   node scripts/moderation.mjs disable-link <프레젠테이션 id 또는 /s/ 주소>...  # 공유 링크 막기
 *
 * takedown·takedown-user·restore·ban·unban의 `--note`는 운영 기록(`moderationEvents`)에 사유로
 * 남고, 닫는 신고의 메모로도 남는다. 빼면 비워 둔다. `--republish`는 로그인할 수 없는 공식
 * 라이브러리 계정의 곡처럼 소유자가 다시 공개할 수 없을 때만 쓰고, 원곡이 아직 게시 중단돼 있는
 * 곡은 다시 공개하지 않는다. `--force`는 이미 닫은 신고의 결과를 일부러 바로잡을 때만 쓴다.
 *
 * 운영 Firestore는 `--target=remote`를 붙인다 (기본: 로컬 에뮬레이터). 실행할 때마다 첫 줄에
 * 연결한 프로젝트가 나온다.
 */

import {
  applyTarget,
  assertEmulatorUp,
  describeTarget,
  importSource,
} from "./lib/targets.mjs";
import { parseModerationArgs, runModeration } from "./lib/moderationCli.mjs";

async function main() {
  const args = parseModerationArgs(process.argv.slice(2));
  const target = args.flags.target ?? "local";
  applyTarget(target);
  await assertEmulatorUp();

  const [{ getFirestore }, ops] = await Promise.all([
    importSource("src/db/client.ts"),
    importSource("src/db/ops/moderation.ts"),
  ]);
  console.log(`대상: ${describeTarget(target)}`);
  await runModeration(args, { db: getFirestore(), ops, out: console });
}

// 파이프로 이어진 stdout은 비동기라 곧바로 process.exit()하면 뒤쪽 출력이 잘린다 (`list | less`).
// https://nodejs.org/api/process.html#a-note-on-process-io
process.stdout.on("error", (error) => {
  if (error.code !== "EPIPE") throw error;
});

const flush = (stream) => new Promise((resolve) => stream.write("", resolve));

async function exit(code) {
  await Promise.all([flush(process.stdout), flush(process.stderr)]);
  process.exit(code);
}

main().then(
  () => exit(0),
  (error) => {
    console.error(error.message);
    return exit(1);
  },
);
