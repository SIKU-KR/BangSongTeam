/**
 * 저장된 곡의 공개 범위·검색 색인을 지금 규칙으로 다시 만든다 (`src/db/ops/searchIndex.ts`).
 * 색인 규칙(`src/db/deckIndex.ts`)을 바꾼 릴리스의 배포가 끝나면 한 번 실행한다. 여러 번 실행해도
 * 색인이 달라진 곡만 고친다. 대상별 준비는 `lib/targets.mjs`를 따른다.
 *
 * 사용법:
 *   node scripts/reindexDecks.mjs                  # 로컬 에뮬레이터
 *   node scripts/reindexDecks.mjs --target=remote  # 운영 Firestore
 */

import {
  applyTarget,
  assertEmulatorUp,
  describeTarget,
  importSource,
  parseFlags,
} from "./lib/targets.mjs";

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const target = flags.target ?? "local";
  applyTarget(target);
  await assertEmulatorUp();
  console.log(`대상: ${describeTarget(target)}`);

  const [{ getFirestore }, ops] = await Promise.all([
    importSource("src/db/client.ts"),
    importSource("src/db/ops/searchIndex.ts"),
  ]);
  const { scanned, updated } = await ops.reindexDecks(getFirestore());
  console.log(
    `곡 ${scanned}개를 확인하고 ${updated}개의 검색 색인을 다시 만들었습니다.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
