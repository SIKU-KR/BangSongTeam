/**
 * `scripts/moderation.mjs`의 명령 해석과 실행. 대상 준비와 Firestore 연결은 진입 파일이 맡고,
 * 여기서는 받은 `db`와 `ops`(`src/db/ops/moderation.ts`)로 명령을 실행한다. 연결을 나눠 둬서
 * 에뮬레이터 테스트가 같은 코드를 그대로 돌린다.
 */

import { parseFlags } from "./targets.mjs";

const SHARE_URL = /\/s\/([\w-]+)/;

const ID_SHAPE = /^[\w-]{21}$/;

const EDGE_NOISE = /^[\s\p{Cf}]+|[\s\p{Cf}]+$/gu;

const trimArg = (arg) => arg.replace(EDGE_NOISE, "");

const isOption = (arg) => arg.startsWith("--") && !ID_SHAPE.test(arg);

async function resolvePresentationId(db, ops, target) {
  const shared = SHARE_URL.exec(target);
  const found = await ops.findPresentationIdByLinkToken(
    db,
    shared ? shared[1] : target,
  );
  return found ?? (shared ? null : target);
}

const COMMANDS = {
  "disable-link": {
    async run({ ids }, { db, ops, out }) {
      const missing = [];
      const failed = [];
      const targets = new Map();
      for (const target of new Set(ids)) {
        const presentationId = await resolvePresentationId(db, ops, target);
        if (presentationId === null) {
          missing.push(target);
        } else if (!targets.has(presentationId)) {
          targets.set(presentationId, target);
        }
      }
      for (const [presentationId, target] of targets) {
        if (presentationId !== target) {
          out.log(`${target} → 프레젠테이션 ${presentationId}`);
        }
        try {
          if (await ops.disableShareLink(db, presentationId)) {
            out.log(
              `${presentationId}: 공유 링크를 막고 링크로 들어온 사람의 접근을 끊었어요.`,
            );
          } else {
            missing.push(target);
          }
        } catch (error) {
          failed.push(`${presentationId} (${error.message})`);
        }
      }
      const problems = [];
      if (missing.length > 0) {
        problems.push(
          `프레젠테이션을 찾을 수 없어요: ${missing.join(", ")}. id나 주소가 틀렸거나 이미 막은 링크일 수 있어요. 막다가 멈췄다면 앞서 출력한 프레젠테이션 id로 다시 실행해 주세요.`,
        );
      }
      if (failed.length > 0) {
        problems.push(
          `링크를 다 막지 못했어요: ${failed.join(", ")}. 같은 프레젠테이션 id로 다시 실행해 주세요.`,
        );
      }
      if (problems.length > 0) throw new Error(problems.join("\n"));
    },
  },
};

function checkFlags(command, flags) {
  for (const [name, value] of Object.entries(flags)) {
    if (name !== "target") {
      throw new Error(`${command}에는 --${name} 옵션을 쓸 수 없어요`);
    }
    if (typeof value !== "string") {
      throw new Error(`--${name}=<값> 형식으로 써 주세요`);
    }
  }
}

/**
 * 명령줄을 `{ command, ids, flags }`로 나눈다. 모르는 명령, id 개수, 명령에 맞지 않는 옵션은
 * Firestore에 연결하기 전에 막는다. `--tagret=remote`처럼 틀린 옵션이 조용히 무시되어 다른
 * 대상에 쓰는 일이 없도록 모르는 옵션도 오류로 본다.
 *
 * id는 NanoID(21자, `A-Za-z0-9_-`)라 `--`로 시작할 수 있다. 긴 목록이 id 하나 때문에 통째로
 * 거절되지 않도록 그 모양(`ID_SHAPE`)인 인자는 옵션이 아니라 id로 읽는다. 옵션 이름은 모두
 * 21자보다 짧거나 `=`가 들어가 id와 겹치지 않는다.
 *
 * 붙여 넣은 목록이나 CRLF 파일(`xargs`)에서 따라온 앞뒤 공백·`\r`·폭 없는 문자는 인자마다 지우고,
 * 지우고 나서 빈 인자는 버린다. 그대로 두면 id가 실제 문서와 맞지 않아 아무것도 하지 않은 명령이
 * 성공한 것처럼 끝난다.
 */
export function parseModerationArgs(argv) {
  const args = argv.map(trimArg).filter((arg) => arg !== "");
  const [command, ...ids] = args.filter((arg) => !isOption(arg));
  const flags = parseFlags(args.filter(isOption));
  if (command === undefined || !Object.hasOwn(COMMANDS, command)) {
    throw new Error(
      `알 수 없는 명령이에요${command === undefined ? "" : `: ${command}`}. 명령: ${Object.keys(COMMANDS).join(" | ")}`,
    );
  }
  if (ids.length === 0) {
    throw new Error(`${command}에는 id가 필요해요`);
  }
  checkFlags(command, flags);
  return { command, ids, flags };
}

/**
 * 해석한 명령을 실행한다. 일부 id만 처리하지 못한 명령은 나머지를 모두 처리한 뒤 오류로
 * 알려, 긴 목록의 한 줄이 틀려도 처음부터 다시 돌리지 않게 한다.
 */
export async function runModeration({ command, ...args }, context) {
  await COMMANDS[command].run(args, context);
}
