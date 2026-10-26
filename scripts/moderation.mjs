/**
 * 공개 곡 신고·게시 중단 처리. 관리자 화면 대신 이 스크립트로 `src/db/ops/moderation.ts`를
 * 부른다. 대상별 준비는 `lib/targets.mjs`를 따른다.
 *
 * 사용법:
 *   node scripts/moderation.mjs list                                  # 처리 대기 신고
 *   node scripts/moderation.mjs descendants <곡 id>                   # 이 곡을 가져가 다시 공개한 곡
 *   node scripts/moderation.mjs takedown <곡 id> --note=<사유>        # 게시 중단 + 그 곡의 신고 처리 완료
 *   node scripts/moderation.mjs restore <곡 id>                       # 게시 중단 해제 (비공개 유지)
 *   node scripts/moderation.mjs resolve <신고 id> --note=<메모>
 *   node scripts/moderation.mjs reject <신고 id> --note=<메모>
 *
 * 운영 Firestore는 `--target=remote`를 붙인다 (기본: 로컬 에뮬레이터).
 */

import {
  assertEmulatorUp,
  importSource,
  parseFlags,
  applyTarget,
} from "./lib/targets.mjs";

async function main() {
  const argv = process.argv.slice(2);
  const [command, id] = argv.filter((arg) => !arg.startsWith("--"));
  const flags = parseFlags(argv.filter((arg) => arg.startsWith("--")));
  applyTarget(flags.target ?? "local");
  await assertEmulatorUp();

  const [{ getFirestore }, ops] = await Promise.all([
    importSource("src/db/client.ts"),
    importSource("src/db/ops/moderation.ts"),
  ]);
  const db = getFirestore();
  const note = typeof flags.note === "string" ? flags.note : "";
  const requireId = () => {
    if (!id) throw new Error(`${command}에는 id가 필요합니다`);
    return id;
  };

  switch (command) {
    case "list":
      console.table(await ops.listPendingReports(db));
      return;
    case "descendants":
      console.table(await ops.listPublicDescendants(db, requireId()));
      return;
    case "takedown": {
      if (!(await ops.takedownDeck(db, requireId()))) {
        throw new Error(`보관함 곡이 아닙니다: ${id}`);
      }
      const closed = await ops.resolveReportsForTarget(db, id, note);
      console.log(`게시를 중단하고 신고 ${closed}건을 처리 완료로 닫았습니다.`);
      return;
    }
    case "restore":
      if (!(await ops.restoreDeck(db, requireId()))) {
        throw new Error(`보관함 곡이 아닙니다: ${id}`);
      }
      console.log("게시 중단을 풀었습니다. 곡은 비공개로 남습니다.");
      return;
    case "resolve":
      await ops.resolveReport(db, requireId(), note);
      console.log("신고를 처리 완료로 닫았습니다.");
      return;
    case "reject":
      await ops.rejectReport(db, requireId(), note);
      console.log("신고를 기각했습니다.");
      return;
    default:
      throw new Error(
        "명령: list | descendants <곡 id> | takedown <곡 id> | restore <곡 id> | resolve <신고 id> | reject <신고 id>",
      );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
