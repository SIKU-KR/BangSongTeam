/**
 * 수정 시각·만든 시각이 미래로 저장된 곡·폴더·프레젠테이션을 찾아 지금으로 줄인다
 * (`src/db/ops/clampFutureTimestamps.ts`). 서버가 기기 시각을 줄이기 전에 남은 값이라, 공유
 * 라이브러리 맨 위에 박힌 곡이나 판이 미래에 박힌 프레젠테이션이 있을 때만 쓴다. 대상별 준비는
 * `lib/targets.mjs`를 따른다.
 *
 * 사용법:
 *   node scripts/clampFutureTimestamps.mjs                          # 로컬 에뮬레이터에서 찾기만 한다
 *   node scripts/clampFutureTimestamps.mjs --apply                  # 로컬 에뮬레이터에서 줄인다
 *   node scripts/clampFutureTimestamps.mjs --target=remote          # 운영 Firestore에서 찾기만 한다
 *   node scripts/clampFutureTimestamps.mjs --target=remote --apply  # 운영 Firestore에서 줄인다
 *
 * 기본은 미리보기라 아무것도 쓰지 않는다. `--target=remote`는 미리보기라도 운영 데이터를 읽으므로
 * 주인에게 먼저 확인받고, 미리보기 결과를 보여 준 뒤에만 `--apply`를 붙인다.
 */

import {
  applyTarget,
  assertEmulatorUp,
  describeTarget,
  importSource,
  parseOptions,
  runScript,
} from "./lib/targets.mjs";

const LABELS = {
  decks: "곡",
  folders: "폴더",
  presentations: "프레젠테이션",
};

async function main() {
  const { positionals, flags } = parseOptions(process.argv.slice(2), {
    apply: "boolean",
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
    importSource("src/db/ops/clampFutureTimestamps.ts"),
  ]);
  console.log(`대상: ${describeTarget(target)}`);
  const result = await ops.clampFutureTimestamps(getFirestore(), { apply });
  for (const [collection, ids] of Object.entries(result)) {
    console.log(
      `${LABELS[collection]} ${ids.length}개${apply ? "의 시각을 줄였어요" : ""}`,
    );
    if (ids.length > 0) console.log(`  ${ids.join("\n  ")}`);
  }
  if (!apply) {
    console.log(
      "미리보기라 아무것도 바꾸지 않았어요. 줄이려면 --apply를 붙여 주세요.",
    );
  }
}

runScript(main);
