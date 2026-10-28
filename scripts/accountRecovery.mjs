/**
 * 로그인할 수 없게 된 사용자를 돕는다 (`src/db/ops/accountRecovery.ts`). Cloudflare에서 옮겨 온
 * 카카오·네이버 사용자는 그 로그인을 켜지 않은 운영에서 들어올 길이 없다. 대상별 준비는
 * `lib/targets.mjs`를 따른다.
 *
 * 사용법:
 *   node scripts/accountRecovery.mjs social-only                                   # 카카오·네이버로만 들어오는 사용자 수
 *   node scripts/accountRecovery.mjs add-password <사용자 id> --email=<주소> [--apply]   # 이메일·비밀번호 로그인 더하기
 *   node scripts/accountRecovery.mjs reassign <옛 사용자 id> <새 사용자 id> [--apply]    # 새로 가입한 계정으로 데이터 옮기기
 *
 * 바꾸기 전에 요청한 사람이 그 계정의 주인인지 확인한다. 예를 들어 그 계정에만 있는 프레젠테이션
 * 제목·날짜를 묻고, 옛 계정의 이메일이 실제 주소면 그 주소에서 온 요청인지 본다. 미리보기 첫머리에
 * 나오는 계정(reassign은 두 계정)의 이름·이메일·가입 시각이 확인한 사람과 맞는지도 본다.
 *
 * - add-password: 그 계정 그대로 받은 이메일과 임시 비밀번호로 로그인하게 한다. `--apply`면 임시
 *   비밀번호를 한 번만 출력하니 본인에게 안전한 길로 전한다. 앱에는 비밀번호 바꾸기가 없어 그
 *   비밀번호를 계속 쓰게 된다는 점도 함께 알린다.
 * - reassign: 사용자가 이메일이나 Google로 새로 가입한 계정에 옛 계정의 데이터를 옮긴다. 옛 계정의
 *   로그인 세션은 먼저 끊는다. 다 옮긴 뒤 옛 계정은 `deleteUser.mjs`로 지운다.
 *
 * 기본은 로컬 에뮬레이터 미리보기라 아무것도 쓰지 않는다. 운영 Firestore는 `--target=remote`를 붙이는데,
 * 세기만 하더라도 주인에게 먼저 확인받는다.
 */

import { randomBytes } from "node:crypto";
import { describeAccount } from "./lib/accounts.mjs";
import {
  applyTarget,
  assertEmulatorUp,
  describeTarget,
  importSource,
  parseOptions,
  runScript,
} from "./lib/targets.mjs";

const USER_ID = /^[\w-]{21}$/;

const REFUSALS = {
  not_found: "사용자를 찾을 수 없어요",
  has_password: "이미 이메일·비밀번호 로그인이 있는 사용자예요",
  invalid_email: "이메일 주소가 올바르지 않아요",
  same_user: "옛 계정과 새 계정이 같아요",
};

const COUNT_LABELS = {
  sessions: "옛 계정의 로그인 세션 (먼저 끊음)",
  folders: "폴더",
  presentations: "프레젠테이션 (사본 곡 포함)",
  libraryDecks: "보관함 곡",
  memberships: "링크로 들어간 다른 사람의 프레젠테이션",
  tombstones: "영구 삭제 기록",
};

function refusal(result) {
  if (result.status === "not_social_only") {
    return `카카오·네이버로만 들어오는 사용자가 아니에요 (연결된 로그인: ${result.providers.join(", ") || "없음"})`;
  }
  if (result.status === "email_taken") {
    return `다른 사용자(${result.heldBy})가 쓰는 이메일이에요`;
  }
  return REFUSALS[result.status] ?? result.status;
}

function requireUserIds(ids, count) {
  if (ids.length !== count) {
    throw new Error(`사용자 id를 ${count}개 적어 주세요`);
  }
  for (const id of ids) {
    if (!USER_ID.test(id))
      throw new Error(`사용자 id는 21자 NanoID예요: ${id}`);
  }
}

const COMMANDS = {
  "social-only": {
    options: {},
    check: (ids) => {
      if (ids.length > 0) throw new Error("social-only에는 id를 붙이지 않아요");
    },
    async run({ db, ops }) {
      const { SYNTHETIC_EMAIL_DOMAIN } = await importSource(
        "src/server/lib/auth.ts",
      );
      const result = await ops.countSocialOnlyUsers(db, {
        syntheticEmailDomain: SYNTHETIC_EMAIL_DOMAIN,
      });
      console.log(`카카오·네이버로만 들어오는 사용자 ${result.total}명이에요.`);
      console.log(`  만든 이메일(로그인 길 없음): ${result.syntheticEmail}`);
      console.log(
        `  인증된 이메일(같은 이메일의 Google로 들어옴): ${result.verifiedEmail}`,
      );
      console.log(`  인증되지 않은 이메일: ${result.unverifiedEmail}`);
      if (result.userIds.length > 0)
        console.log(`  ${result.userIds.join("\n  ")}`);
    },
  },
  "add-password": {
    options: { email: "string", apply: "boolean" },
    check: (ids, flags) => {
      requireUserIds(ids, 1);
      if (flags.email === undefined)
        throw new Error("--email=<주소>가 필요해요");
    },
    async run({ db, ops, getAccountIdentity, ids: [userId], flags }) {
      console.log(
        `계정: ${describeAccount(userId, await getAccountIdentity(db, userId))}`,
      );
      const apply = flags.apply === true;
      let password;
      let passwordHash;
      if (apply) {
        const { hashPassword } = await importSource(
          "src/server/lib/password.ts",
        );
        password = randomBytes(12).toString("base64url");
        passwordHash = await hashPassword(password);
      }
      const result = await ops.addPasswordLogin(db, {
        userId,
        email: flags.email,
        ...(apply ? { apply, passwordHash } : {}),
      });
      if (result.status !== "ready" && result.status !== "added") {
        throw new Error(refusal(result));
      }
      console.log(
        `${result.userId}: 로그인 이메일 ${result.previousEmail ?? "(없음)"} → ${result.email}`,
      );
      if (!apply) {
        console.log(
          "미리보기라 아무것도 바꾸지 않았어요. 더하려면 --apply를 붙여 주세요.",
        );
        return;
      }
      console.log(`임시 비밀번호: ${password}`);
      console.log(
        "이 비밀번호는 다시 보여 주지 않아요. 본인에게 안전한 길로 전해 주세요.",
      );
    },
  },
  reassign: {
    options: { apply: "boolean" },
    check: (ids) => requireUserIds(ids, 2),
    async run({
      db,
      ops,
      getAccountIdentity,
      ids: [fromUserId, toUserId],
      flags,
    }) {
      const [from, to] = await Promise.all(
        [fromUserId, toUserId].map((id) => getAccountIdentity(db, id)),
      );
      console.log(`옛 계정: ${describeAccount(fromUserId, from)}`);
      console.log(`새 계정: ${describeAccount(toUserId, to)}`);
      const apply = flags.apply === true;
      const result = await ops.reassignUserData(db, {
        fromUserId,
        toUserId,
        apply,
      });
      if (result.status !== "ready" && result.status !== "moved") {
        throw new Error(refusal(result));
      }
      console.log(
        `${fromUserId} → ${toUserId}: ${apply ? "옮겼어요" : "옮길 데이터예요"}`,
      );
      for (const [key, value] of Object.entries(result.counts)) {
        console.log(`  ${COUNT_LABELS[key] ?? key}: ${value}`);
      }
      if (!apply) {
        console.log(
          "미리보기라 아무것도 옮기지 않았어요. 옮기려면 --apply를 붙여 주세요.",
        );
        return;
      }
      console.log(
        "옛 계정으로 로그인된 기기가 있었다면 5분 뒤 한 번 더 실행해 주세요. 다 옮긴 뒤 옛 계정은 deleteUser.mjs로 지워 주세요.",
      );
    },
  },
};

async function main() {
  const [command] = process.argv.slice(2);
  if (command === undefined || !Object.hasOwn(COMMANDS, command)) {
    throw new Error(`명령: ${Object.keys(COMMANDS).join(" | ")}`);
  }
  const spec = COMMANDS[command];
  const { positionals: ids, flags } = parseOptions(
    process.argv.slice(3),
    spec.options,
  );
  spec.check(ids, flags);
  const target = flags.target ?? "local";
  applyTarget(target);
  await assertEmulatorUp();

  const [{ getFirestore }, ops, { getAccountIdentity }] = await Promise.all([
    importSource("src/db/client.ts"),
    importSource("src/db/ops/accountRecovery.ts"),
    importSource("src/db/ops/deleteUser.ts"),
  ]);
  console.log(`대상: ${describeTarget(target)}`);
  await spec.run({ db: getFirestore(), ops, getAccountIdentity, ids, flags });
}

runScript(main);
