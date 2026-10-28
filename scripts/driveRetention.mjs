/**
 * 휴지통에 오래 둔 폴더·프레젠테이션을 영구 삭제하고, 오래된 영구 삭제 기록을 지운다
 * (`src/db/ops/driveRetention.ts`). 부팅마다 받는 내 목록이 쓰는 동안 끝없이 늘지 않게 한다. 기본
 * 보관 기간은 휴지통 90일, 영구 삭제 기록 180일이고, 둘 다 30일보다 짧게 줄 수 없다. 대상별 준비는
 * `lib/targets.mjs`를 따른다.
 *
 * 사용법:
 *   node scripts/driveRetention.mjs                                       # 로컬 에뮬레이터에서 찾기만 한다
 *   node scripts/driveRetention.mjs --apply                               # 로컬 에뮬레이터에서 지운다
 *   node scripts/driveRetention.mjs --trash-days=120 --tombstone-days=365 # 보관 기간을 바꿔 찾는다
 *   node scripts/driveRetention.mjs --target=remote                       # 운영 Firestore에서 찾기만 한다
 *   node scripts/driveRetention.mjs --target=remote --apply               # 운영 Firestore에서 지운다
 *
 * 기본은 미리보기라 아무것도 지우지 않는다. 지운 항목은 되돌릴 수 없다. `--target=remote`는 미리보기라도
 * 운영 데이터를 읽으므로 주인에게 먼저 확인받고, 미리보기 결과를 보여 준 뒤에만 `--apply`를 붙인다.
 * 영구 삭제 기록을 지우면 보관 기간보다 오래 꺼 둔 기기가 지운 항목을 다시 올릴 수 있다.
 */

import {
  applyTarget,
  assertEmulatorUp,
  describeTarget,
  importSource,
  parseOptions,
  runScript,
} from "./lib/targets.mjs";

function days(value) {
  return value === undefined ? undefined : Number(value);
}

function printItems(label, items) {
  console.log(`${label} ${items.length}개`);
  if (items.length > 0) console.log(`  ${items.join("\n  ")}`);
}

async function main() {
  const { positionals, flags } = parseOptions(process.argv.slice(2), {
    apply: "boolean",
    "trash-days": "string",
    "tombstone-days": "string",
  });
  if (positionals.length > 0) {
    throw new Error(`위치 인자는 받지 않아요: ${positionals.join(" ")}`);
  }
  const target = flags.target ?? "local";
  const apply = flags.apply === true;
  applyTarget(target);
  await assertEmulatorUp();

  const [{ getFirestore }, ops] = await Promise.all([
    importSource("src/db/client.ts"),
    importSource("src/db/ops/driveRetention.ts"),
  ]);
  const trashDays =
    days(flags["trash-days"]) ?? ops.DEFAULT_TRASH_RETENTION_DAYS;
  const tombstoneDays =
    days(flags["tombstone-days"]) ?? ops.DEFAULT_TOMBSTONE_RETENTION_DAYS;
  console.log(`대상: ${describeTarget(target)}`);
  const report = await ops.pruneDriveRetention(getFirestore(), {
    apply,
    trashDays,
    tombstoneDays,
  });

  const owned = (item) => `${item.id} (사용자 ${item.userId})`;
  printItems(
    `휴지통에 넣은 지 ${trashDays}일이 지난 폴더`,
    report.folders.map(owned),
  );
  printItems(
    `휴지통에 넣은 지 ${trashDays}일이 지난 프레젠테이션`,
    report.presentations.map(owned),
  );
  printItems(
    `남긴 지 ${tombstoneDays}일이 지난 영구 삭제 기록`,
    report.tombstones,
  );
  if (!apply) {
    console.log(
      "미리보기라 아무것도 지우지 않았어요. 지우려면 --apply를 붙여 주세요.",
    );
    return;
  }
  if (report.skipped.length > 0) {
    printItems("그사이 바뀌어 지우지 않은 항목", report.skipped);
  }
  console.log("보관 기간이 지난 항목과 기록을 지웠어요.");
}

runScript(main);
