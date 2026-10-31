/**
 * 공유 링크 운영 작업. 관리자 화면 대신 이 스크립트로 `src/db/ops/moderation.ts`를 부른다.
 * 대상별 준비는 `lib/targets.mjs`, 명령 처리는 `lib/moderationCli.mjs`를 따른다.
 *
 * 사용법:
 *   node scripts/moderation.mjs disable-link <프레젠테이션 id 또는 /s/ 주소>...  # 공유 링크 막기
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
