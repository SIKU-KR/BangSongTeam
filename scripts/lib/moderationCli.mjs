/**
 * `scripts/moderation.mjs`의 명령 해석과 실행. 대상 준비와 Firestore 연결은 진입 파일이 맡고,
 * 여기서는 받은 `db`와 `ops`(`src/db/ops/moderation.ts`)로 명령을 실행한다. 연결을 나눠 둬서
 * 에뮬레이터 테스트가 같은 코드를 그대로 돌린다.
 */

import { parseFlags } from "./targets.mjs";

const FLAG_TYPES = {
  target: "string",
  note: "string",
  limit: "string",
  force: "boolean",
  republish: "boolean",
  "with-forks": "boolean",
};

const SHARE_URL = /\/s\/([\w-]+)/;

const ID_SHAPE = /^[\w-]{21}$/;

const EDGE_NOISE = /^[\s\p{Cf}]+|[\s\p{Cf}]+$/gu;

const trimArg = (arg) => arg.replace(EDGE_NOISE, "");

const isOption = (arg) => arg.startsWith("--") && !ID_SHAPE.test(arg);

const noteOf = (flags) => (typeof flags.note === "string" ? flags.note : "");

const eventNoteOf = (flags) => noteOf(flags).trim() || null;

async function splitKnownUsers(db, ops, ids) {
  const unknown = await ops.findUnknownUserIds(db, ids);
  const known = [...new Set(ids)].filter((id) => !unknown.includes(id));
  return { known, unknown };
}

const unknownUsersMessage = (unknown) =>
  `사용자를 찾을 수 없어 건너뛰었어요: ${unknown.join(", ")}. id를 확인해 주세요.`;

async function resolvePresentationId(db, ops, target) {
  const shared = SHARE_URL.exec(target);
  const found = await ops.findPresentationIdByLinkToken(
    db,
    shared ? shared[1] : target,
  );
  return found ?? (shared ? null : target);
}

const COMMANDS = {
  list: {
    ids: "none",
    flags: ["limit"],
    async run({ flags }, { db, ops, out }) {
      const limit = flags.limit === undefined ? undefined : Number(flags.limit);
      const [total, reports] = await Promise.all([
        ops.countPendingReports(db),
        ops.listPendingReports(db, { limit }),
      ]);
      if (total === 0) {
        out.log("처리 대기 신고가 없어요.");
        return;
      }
      out.log(
        reports.length < total
          ? `처리 대기 신고 ${total}건 중 오래된 ${reports.length}건이에요. 더 보려면 --limit 값을 늘려 주세요.`
          : `처리 대기 신고 ${total}건이에요.`,
      );
      out.table(reports);
    },
  },
  descendants: {
    ids: "one",
    async run({ ids: [deckId] }, { db, ops, out }) {
      out.table(await ops.listDescendants(db, deckId));
    },
  },
  "user-decks": {
    ids: "one",
    async run({ ids: [userId] }, { db, ops, out }) {
      const decks = await ops.listUserDecks(db, userId);
      out.log(`${userId}의 보관함 곡 ${decks.length}개예요.`);
      out.table(decks);
    },
  },
  takedown: {
    ids: "many",
    flags: ["note", "with-forks"],
    async run({ ids, flags }, { db, ops, out }) {
      const now = new Date();
      const eventNote = eventNoteOf(flags);
      const { takenDown, notLibrary } = await ops.takedownDecks(
        db,
        ids,
        now,
        eventNote,
      );
      const forks = [];
      if (flags["with-forks"] === true) {
        for (const deckId of takenDown) {
          forks.push(...(await ops.takedownForks(db, deckId, now, eventNote)));
        }
      }
      const closed = await ops.resolveReportsForDecks(
        db,
        [...takenDown, ...forks],
        noteOf(flags),
      );
      if (takenDown.length > 0) {
        out.log(
          `곡 ${takenDown.length}개의 게시를 중단하고 신고 ${closed}건을 처리 완료로 닫았어요.` +
            (flags["with-forks"] === true
              ? ` 가져간 곡 ${forks.length}개도 게시를 중단했어요.`
              : ""),
        );
      }
      if (notLibrary.length > 0) {
        throw new Error(
          `보관함 곡이 아니라 건너뛰었어요: ${notLibrary.join(", ")}`,
        );
      }
    },
  },
  "takedown-user": {
    ids: "many",
    flags: ["note"],
    async run({ ids, flags }, { db, ops, out }) {
      const now = new Date();
      const { known, unknown } = await splitKnownUsers(db, ops, ids);
      const official = [];
      for (const userId of known) {
        const result = await ops.takedownUserDecks(
          db,
          userId,
          now,
          eventNoteOf(flags),
        );
        if (result.status === "official") {
          official.push(userId);
          continue;
        }
        const closed = await ops.resolveReportsForDecks(
          db,
          result.libraryDeckIds,
          noteOf(flags),
        );
        out.log(
          `${userId}: 곡 ${result.deckIds.length}개의 게시를 중단하고 신고 ${closed}건을 처리 완료로 닫았어요.`,
        );
      }
      const problems = [];
      if (official.length > 0) {
        problems.push(
          `공식 라이브러리 계정의 곡은 한꺼번에 게시 중단할 수 없어 건너뛰었어요: ${official.join(", ")}. 곡마다 takedown <곡 id>로 중단해 주세요.`,
        );
      }
      if (unknown.length > 0) problems.push(unknownUsersMessage(unknown));
      if (problems.length > 0) throw new Error(problems.join("\n"));
    },
  },
  "revoke-sessions": {
    ids: "many",
    async run({ ids }, { db, ops, out }) {
      const { known, unknown } = await splitKnownUsers(db, ops, ids);
      for (const userId of known) {
        const count = await ops.revokeSessions(db, userId);
        out.log(
          `${userId}: 세션 ${count}개를 지웠어요. 계정은 막지 않아 바로 다시 로그인할 수 있고, 로그인해 있던 기기도 최대 5분 더 쓸 수 있어요. 계정을 정리하는 중이면 5분 뒤 takedown-user를 한 번 더 실행해 주세요.`,
        );
      }
      if (unknown.length > 0) throw new Error(unknownUsersMessage(unknown));
    },
  },
  ban: {
    ids: "one",
    flags: ["note"],
    async run({ ids: [userId], flags }, { db, ops, out }) {
      const result = await ops.banUser(
        db,
        userId,
        new Date(),
        eventNoteOf(flags),
      );
      if (result.status === "not_found") {
        throw new Error(`사용자가 없어요: ${userId}`);
      }
      if (result.status === "official") {
        throw new Error(`공식 라이브러리 계정은 제한할 수 없어요: ${userId}`);
      }
      const closed = await ops.resolveReportsForDecks(
        db,
        result.takenDownDeckIds,
        noteOf(flags),
      );
      out.log(
        `계정을 제한했어요. 공개 중이던 곡 ${result.takenDownDeckIds.length}개를 게시 중단하고 신고 ${closed}건을 닫았어요. 로그인 세션 ${result.revokedSessions}개를 지웠어요. 로그인한 기기는 최대 5분 더 쓸 수 있어요.`,
      );
      if (result.takenDownDeckIds.length > 0) {
        out.table(result.takenDownDeckIds.map((deckId) => ({ deckId })));
      }
    },
  },
  unban: {
    ids: "one",
    flags: ["note"],
    async run({ ids: [userId], flags }, { db, ops, out }) {
      if (!(await ops.unbanUser(db, userId, new Date(), eventNoteOf(flags)))) {
        throw new Error(`사용자가 없어요: ${userId}`);
      }
      out.log(
        "계정 제한을 풀었어요. 게시 중단한 곡은 restore로 하나씩 풀어 주세요.",
      );
    },
  },
  restore: {
    ids: "one",
    flags: ["republish", "note"],
    async run({ ids: [deckId], flags }, { db, ops, out }) {
      const restored = await ops.restoreDeck(db, deckId, {
        republish: flags.republish === true,
        note: eventNoteOf(flags),
      });
      if (restored === null) {
        throw new Error(`보관함 곡이 아니에요: ${deckId}`);
      }
      const [blockedBy, descendants] = await Promise.all([
        ops.findBlockingSource(db, deckId),
        ops.listDescendants(db, deckId),
      ]);
      const stillTakenDown = descendants.filter((deck) => deck.takenDown);
      out.log(
        restored.listed
          ? "게시 중단을 풀었어요. 곡이 공유 라이브러리에 다시 보여요."
          : "게시 중단을 풀었어요. 곡은 비공개로 남아요.",
      );
      if (blockedBy) {
        out.warn(
          `원곡 ${blockedBy}이(가) 아직 게시 중단돼 있어 소유자는 이 곡을 공개할 수 없어요.`,
        );
      }
      if (stillTakenDown.length > 0) {
        out.log(
          `가져간 곡 ${stillTakenDown.length}개는 아직 게시 중단돼 있어요. descendants ${deckId}로 확인하고 restore로 하나씩 풀어 주세요.`,
        );
      }
    },
  },
  resolve: {
    ids: "one",
    flags: ["note", "force"],
    async run({ ids: [reportId], flags }, { db, ops, out }) {
      await ops.resolveReport(db, reportId, noteOf(flags), {
        force: flags.force === true,
      });
      out.log("신고를 처리 완료로 닫았어요.");
    },
  },
  reject: {
    ids: "one",
    flags: ["note", "force"],
    async run({ ids: [reportId], flags }, { db, ops, out }) {
      await ops.rejectReport(db, reportId, noteOf(flags), {
        force: flags.force === true,
      });
      out.log("신고를 기각했어요.");
    },
  },
  "reject-by-reporter": {
    ids: "one",
    flags: ["note"],
    async run({ ids: [reporterId], flags }, { db, ops, out }) {
      const closed = await ops.rejectReportsByReporter(
        db,
        reporterId,
        noteOf(flags),
      );
      out.log(
        `신고자 ${reporterId}의 처리 대기 신고 ${closed}건을 기각했어요.`,
      );
    },
  },
  "disable-link": {
    ids: "many",
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

function checkFlags(command, allowed, flags) {
  for (const [name, value] of Object.entries(flags)) {
    if (name !== "target" && !allowed.includes(name)) {
      throw new Error(`${command}에는 --${name} 옵션을 쓸 수 없어요`);
    }
    if (FLAG_TYPES[name] === "boolean" && value !== true) {
      throw new Error(`--${name}에는 값을 붙이지 않아요`);
    }
    if (FLAG_TYPES[name] === "string" && typeof value !== "string") {
      throw new Error(`--${name}=<값> 형식으로 써 주세요`);
    }
  }
  if (flags.limit !== undefined) {
    const limit = Number(flags.limit);
    if (!(Number.isInteger(limit) && limit > 0)) {
      throw new Error(`--limit은 1 이상의 정수여야 해요: ${flags.limit}`);
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
  const spec = COMMANDS[command];
  if (spec.ids === "none" && ids.length > 0) {
    throw new Error(`${command}에는 id를 붙이지 않아요`);
  }
  if (spec.ids !== "none" && ids.length === 0) {
    throw new Error(`${command}에는 id가 필요해요`);
  }
  if (spec.ids === "one" && ids.length > 1) {
    throw new Error(`${command}는 id를 하나만 받아요`);
  }
  checkFlags(command, spec.flags ?? [], flags);
  return { command, ids, flags };
}

/**
 * 해석한 명령을 실행한다. 일부 id만 처리하지 못한 명령은 나머지를 모두 처리한 뒤 오류로
 * 알려, 긴 목록의 한 줄이 틀려도 처음부터 다시 돌리지 않게 한다.
 */
export async function runModeration({ command, ...args }, context) {
  await COMMANDS[command].run(args, context);
}
