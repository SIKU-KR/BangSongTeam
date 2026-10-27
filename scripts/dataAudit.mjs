/**
 * 저장된 데이터를 점검한다 (`src/db/ops/dataAudit.ts`). 대상별 준비는 `lib/targets.mjs`를 따른다.
 *
 * 사용법:
 *   node scripts/dataAudit.mjs text-limits                  # 한도를 넘는 곡 글·사용자 이름을 센다
 *   node scripts/dataAudit.mjs text-limits --apply          # 앱이 보여 주는 값으로 고친다
 *   node scripts/dataAudit.mjs folder-counts [--top=<n>]    # 폴더가 많은 사용자 (읽기만 한다)
 *
 * 기본은 로컬 에뮬레이터이고 아무것도 쓰지 않는다. 운영 Firestore는 `--target=remote`를 붙이는데,
 * 읽기만 하는 명령도 운영 데이터를 읽으므로 주인에게 먼저 확인받는다. `--apply`는 미리보기
 * 결과를 보여 준 뒤에만 붙인다.
 */

import {
  applyTarget,
  assertEmulatorUp,
  describeTarget,
  importSource,
  parseOptions,
  runScript,
} from "./lib/targets.mjs";

const COMMANDS = {
  "text-limits": {
    options: { apply: "boolean" },
    async run(ops, db, flags) {
      const apply = flags.apply === true;
      const { decks, users } = await ops.textLimits(db, { apply });
      const verb = apply ? "고쳤어요" : "찾았어요";
      console.log(`곡 ${decks.length}개를 ${verb} (제목·아티스트·원작자 이름)`);
      if (decks.length > 0) console.log(`  ${decks.join("\n  ")}`);
      console.log(`사용자 이름 ${users.length}개를 ${verb}`);
      if (users.length > 0) console.log(`  ${users.join("\n  ")}`);
      if (!apply) {
        console.log(
          "미리보기라 아무것도 바꾸지 않았어요. 고치려면 --apply를 붙여 주세요.",
        );
      }
    },
  },
  "folder-counts": {
    options: { top: "string" },
    check(flags) {
      const top = Number(flags.top);
      if (flags.top !== undefined && !(Number.isInteger(top) && top > 0)) {
        throw new Error(`--top은 1 이상의 정수여야 해요: ${flags.top}`);
      }
    },
    async run(ops, db, flags) {
      const top = flags.top === undefined ? undefined : Number(flags.top);
      const result = await ops.folderCounts(db, { top });
      console.log(
        `폴더 ${result.total}개, 폴더가 있는 사용자 ${result.users}명이에요.`,
      );
      console.table(result.top);
    },
  },
};

async function main() {
  const [command] = process.argv.slice(2);
  if (command === undefined || !Object.hasOwn(COMMANDS, command)) {
    throw new Error(`명령: ${Object.keys(COMMANDS).join(" | ")}`);
  }
  const spec = COMMANDS[command];
  const { positionals, flags } = parseOptions(
    process.argv.slice(3),
    spec.options,
  );
  if (positionals.length > 0) {
    throw new Error(`${command}에는 위치 인자를 붙이지 않아요`);
  }
  spec.check?.(flags);
  const target = flags.target ?? "local";
  applyTarget(target);
  await assertEmulatorUp();

  const [{ getFirestore }, ops] = await Promise.all([
    importSource("src/db/client.ts"),
    importSource("src/db/ops/dataAudit.ts"),
  ]);
  console.log(`대상: ${describeTarget(target)}`);
  await spec.run(ops, getFirestore(), flags);
}

runScript(main);
