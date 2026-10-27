/**
 * 공개 곡 신고·게시 중단 처리. 관리자 화면 대신 이 스크립트로 `src/db/ops/moderation.ts`를
 * 부른다. 대상별 준비는 `lib/targets.mjs`를 따른다.
 *
 * 사용법:
 *   node scripts/moderation.mjs list                                  # 처리 대기 신고
 *   node scripts/moderation.mjs descendants <곡 id>                   # 이 곡에서 가져간 보관함 곡 (가져간 곡을 다시 가져간 곡까지, 비공개 포함)
 *   node scripts/moderation.mjs takedown <곡 id> --note=<사유>        # 게시 중단 + 그 곡의 신고 처리 완료
 *   node scripts/moderation.mjs takedown <곡 id> --with-forks --note=<사유>  # 가져간 곡도 함께 게시 중단
 *   node scripts/moderation.mjs restore <곡 id> --note=<사유>         # 게시 중단 해제 (비공개 유지)
 *   node scripts/moderation.mjs ban <사용자 id> --note=<사유>         # 계정 제한: 공개·가져오기·신고를 막고 공개 곡을 게시 중단, 로그인 세션 종료
 *   node scripts/moderation.mjs unban <사용자 id> --note=<사유>       # 계정 제한 해제 (게시 중단한 곡은 restore로 하나씩 푼다)
 *   node scripts/moderation.mjs resolve <신고 id> --note=<메모>
 *   node scripts/moderation.mjs reject <신고 id> --note=<메모>
 *
 * takedown·restore·ban·unban의 `--note`는 운영 기록(`moderationEvents`)에 사유로 남는다. 빼면 비워 둔다.
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
  const eventNote = note.trim() || null;
  const now = new Date();
  const requireId = () => {
    if (!id) throw new Error(`${command}에는 id가 필요합니다`);
    return id;
  };
  const resolveAll = async (deckIds) => {
    let closed = 0;
    for (const deckId of deckIds) {
      closed += await ops.resolveReportsForTarget(db, deckId, note);
    }
    return closed;
  };

  switch (command) {
    case "list":
      console.table(await ops.listPendingReports(db));
      return;
    case "descendants":
      console.table(await ops.listDescendants(db, requireId()));
      return;
    case "takedown": {
      if (!(await ops.takedownDeck(db, requireId(), now, eventNote))) {
        throw new Error(`보관함 곡이 아닙니다: ${id}`);
      }
      const forks = flags["with-forks"]
        ? await ops.takedownForks(db, id, now, eventNote)
        : [];
      const closed = await resolveAll([id, ...forks]);
      console.log(
        `게시를 중단하고 신고 ${closed}건을 처리 완료로 닫았습니다.` +
          (flags["with-forks"]
            ? ` 가져간 곡 ${forks.length}개도 게시를 중단했습니다.`
            : ""),
      );
      return;
    }
    case "restore":
      if (!(await ops.restoreDeck(db, requireId(), now, eventNote))) {
        throw new Error(`보관함 곡이 아닙니다: ${id}`);
      }
      console.log("게시 중단을 풀었습니다. 곡은 비공개로 남습니다.");
      return;
    case "ban": {
      const result = await ops.banUser(db, requireId(), now, eventNote);
      if (result.status === "not_found") {
        throw new Error(`사용자가 없습니다: ${id}`);
      }
      if (result.status === "official") {
        throw new Error(`공식 라이브러리 계정은 제한할 수 없습니다: ${id}`);
      }
      const closed = await resolveAll(result.takenDownDeckIds);
      console.log(
        `계정을 제한했습니다. 공개 중이던 곡 ${result.takenDownDeckIds.length}개를 게시 중단하고 신고 ${closed}건을 닫았습니다. 로그인 세션 ${result.revokedSessions}개를 끊었습니다(쿠키 캐시 때문에 최대 5분 뒤 끊깁니다).`,
      );
      if (result.takenDownDeckIds.length > 0) {
        console.table(result.takenDownDeckIds.map((deckId) => ({ deckId })));
      }
      return;
    }
    case "unban":
      if (!(await ops.unbanUser(db, requireId(), now, eventNote))) {
        throw new Error(`사용자가 없습니다: ${id}`);
      }
      console.log(
        "계정 제한을 풀었습니다. 게시 중단한 곡은 restore로 하나씩 풀어 주세요.",
      );
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
        "명령: list | descendants <곡 id> | takedown <곡 id> [--with-forks] | restore <곡 id> | ban <사용자 id> | unban <사용자 id> | resolve <신고 id> | reject <신고 id>",
      );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
