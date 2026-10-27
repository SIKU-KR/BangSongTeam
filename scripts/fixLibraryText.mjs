/**
 * 공식 라이브러리 곡의 제목·가사를 고친다 (`src/db/ops/libraryTextFixes.ts`). 고칠 목록은
 * `data/officialLibraryFixes.json`이고, 고친 원본 `data/cleaned/songs.json`과 같은 내용이다.
 * 시드(`seedSelected.mjs`)는 이미 넣은 곡을 건너뛰기만 하므로, 원본을 고친 뒤 이미 넣은 곡은 이
 * 스크립트로 제자리에서 고친다. 대상별 준비는 `lib/targets.mjs`를 따른다.
 *
 * 사용법:
 *   node scripts/fixLibraryText.mjs                          # 로컬 에뮬레이터에서 고칠 곡만 보여 준다
 *   node scripts/fixLibraryText.mjs --apply                  # 로컬 에뮬레이터에서 고친다
 *   node scripts/fixLibraryText.mjs --target=remote          # 운영 Firestore에서 고칠 곡만 보여 준다
 *   node scripts/fixLibraryText.mjs --target=remote --apply  # 운영 Firestore에서 고친다
 *
 * 옵션:
 *   --fixes=<경로>  고칠 목록 JSON (기본값: data/officialLibraryFixes.json)
 *
 * `--target=remote`는 미리보기라도 주인에게 먼저 확인받고, 미리보기 결과를 보여 준 뒤에만
 * `--apply`를 붙인다. 고친 곡은 옛 제목으로 찾지 못하므로 다시 실행해도 겹쳐 쓰지 않는다.
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  ROOT_DIR,
  applyTarget,
  assertEmulatorUp,
  describeTarget,
  importSource,
  parseOptions,
  runScript,
} from "./lib/targets.mjs";

const DEFAULT_FIXES = path.join(ROOT_DIR, "data", "officialLibraryFixes.json");

async function main() {
  const { positionals, flags } = parseOptions(process.argv.slice(2), {
    apply: "boolean",
    fixes: "string",
  });
  if (positionals.length > 0) {
    throw new Error(`위치 인자는 받지 않아요: ${positionals.join(" ")}`);
  }
  const target = flags.target ?? "local";
  const apply = flags.apply === true;
  const fixesPath = path.resolve(ROOT_DIR, flags.fixes ?? DEFAULT_FIXES);
  const raw = JSON.parse(await fs.readFile(fixesPath, "utf-8"));

  applyTarget(target);
  await assertEmulatorUp();
  const [{ getFirestore }, ops] = await Promise.all([
    importSource("src/db/client.ts"),
    importSource("src/db/ops/libraryTextFixes.ts"),
  ]);
  const fixes = ops.parseLibraryTextFixes(raw);

  console.log(`대상: ${describeTarget(target)}`);
  console.log(
    `고칠 목록: ${path.relative(ROOT_DIR, fixesPath)} (${fixes.length}곡)`,
  );
  const result = await ops.fixLibraryText(getFirestore(), fixes, { apply });
  console.log(
    `${apply ? "고친" : "고칠"} 곡 ${result.changed.length}개, 이미 고친 곡 ${result.alreadyFixed}개, 찾지 못한 곡 ${result.unmatched.length}개예요.`,
  );
  for (const change of result.changed) {
    console.log(
      `  ${change.id}  ${change.title} → ${change.nextTitle}${change.lyrics ? " (가사)" : ""}`,
    );
  }
  if (result.unmatched.length > 0) {
    console.log(
      "공식 라이브러리에 없는 곡이에요. 운영에 넣지 않은 곡이면 그대로 둬도 돼요.",
    );
    for (const fix of result.unmatched) {
      console.log(`  ${fix.title} / ${fix.artist}`);
    }
  }
  if (!apply) {
    console.log(
      "미리보기라 아무것도 바꾸지 않았어요. 고치려면 --apply를 붙여 주세요.",
    );
  }
}

runScript(main);
