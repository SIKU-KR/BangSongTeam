import { OFFICIAL_LIBRARY_USER_ID } from "#shared";
import { runBulk, type Db } from "../client";
import {
  chunkIds,
  COLLECTIONS,
  decksCol,
  reportsCol,
  usersCol,
  type ModerationEventDoc,
  type ReportDoc,
} from "../collections";
import { withDeckIndex } from "../deckIndex";
import { isBannedUser } from "../queries/limits";
import { recordModerationEvent } from "../queries/takedowns";

/**
 * 신고·게시 중단 운영 작업. 관리자 화면 없이 `scripts/moderation.mjs`로 실행한다.
 * 게시 중단은 곡을 비공개로 돌리고 다시 공개하지 못하게 막는다. 공개 범위와 검색 색인은
 * `withDeckIndex`가 함께 고친다. 게시 중단·해제와 계정 제한·해제는 같은 트랜잭션에서 운영 기록
 * (`ModerationEventDoc`)으로 남긴다.
 */

export interface PendingReport {
  id: string;
  deckId: string | null;
  reason: ReportDoc["reason"];
  details: string | null;
  reportedAt: string;
  targetTitle: string | null;
  /** 신고한 곡의 주인 */
  targetUserId: string | null;
}

/**
 * 처리 대기 신고 (접수 순). 곡이 지워졌으면 접수할 때 남긴 제목과 주인을 보여 준다. 그 기록이 없는
 * 예전 신고는 지금 곡에서 읽는다.
 */
export async function listPendingReports(db: Db): Promise<PendingReport[]> {
  const snapshot = await reportsCol(db).where("status", "==", "pending").get();
  const reports = snapshot.docs
    .map((doc) => doc.data())
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const deckIds = [
    ...new Set(reports.flatMap((r) => (r.deckId ? [r.deckId] : []))),
  ];
  const targets = new Map<string, { title: string; userId: string }>();
  for (const ids of chunkIds(deckIds)) {
    const decks = await db.getAll(...ids.map((id) => decksCol(db).doc(id)));
    for (const deck of decks) {
      const data = deck.data();
      if (data) {
        targets.set(deck.id, {
          title: data.title as string,
          userId: data.userId as string,
        });
      }
    }
  }
  return reports.map((report) => {
    const target = report.deckId ? targets.get(report.deckId) : undefined;
    return {
      id: report.id,
      deckId: report.deckId,
      reason: report.reason,
      details: report.details,
      reportedAt: report.createdAt.toISOString(),
      targetTitle: target?.title ?? report.targetTitle ?? null,
      targetUserId: target?.userId ?? report.targetUserId ?? null,
    };
  });
}

type EventCause = Pick<ModerationEventDoc, "cause" | "sourceDeckId" | "note">;

function directCause(note: string | null): EventCause {
  return { cause: "direct", sourceDeckId: null, note };
}

async function updateLibraryDeck(
  db: Db,
  deckId: string,
  change: { visibility?: "private"; takedownAt: Date | null },
  action: "takedown" | "restore",
  now: Date,
  cause: EventCause,
): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const ref = decksCol(db).doc(deckId);
    const deck = (await tx.get(ref)).data();
    if (!deck || deck.presentationId !== null) return false;
    tx.set(ref, withDeckIndex({ ...deck, ...change }));
    recordModerationEvent(tx, db, {
      action,
      ...cause,
      userId: deck.userId,
      deckId,
      title: deck.title,
      at: now,
    });
    return true;
  });
}

function takeDown(
  db: Db,
  deckId: string,
  now: Date,
  cause: EventCause,
): Promise<boolean> {
  return updateLibraryDeck(
    db,
    deckId,
    { visibility: "private", takedownAt: now },
    "takedown",
    now,
    cause,
  );
}

/** 게시 중단: 비공개로 돌리고 공유 라이브러리·검색에서 뺀다. 소유자는 다시 공개할 수 없다 */
export async function takedownDeck(
  db: Db,
  deckId: string,
  now: Date = new Date(),
  note: string | null = null,
): Promise<boolean> {
  return takeDown(db, deckId, now, directCause(note));
}

/** 게시 중단 해제. 비공개로 둔 채 소유자가 다시 공개할 수 있게만 한다 */
export async function restoreDeck(
  db: Db,
  deckId: string,
  now: Date = new Date(),
  note: string | null = null,
): Promise<boolean> {
  return updateLibraryDeck(
    db,
    deckId,
    { takedownAt: null },
    "restore",
    now,
    directCause(note),
  );
}

/** 이 곡에서 가져간 보관함 곡 하나 (`listDescendants`) */
export interface DescendantDeck {
  id: string;
  userId: string;
  title: string;
  /** 이 곡이 가져온 곡 */
  forkedFrom: string;
  listed: boolean;
  takenDown: boolean;
}

const DESCENDANT_QUERY_CONCURRENCY = 30;

/**
 * 이 곡에서 가져간 보관함 곡 전부. 가져간 곡을 다시 가져간 곡까지 너비 우선으로 찾고, 공개
 * 여부와 상관없이 담는다(함께 게시 중단할지 판단용). 비공개 사본도 나중에 공개할 수 있고, 곡을
 * 프레젠테이션에 담을 때마다 비공개 사본이 생기기 때문이다.
 *
 * 원본이 지워져 `forkedFrom`이 비워진 곡과 가사를 복사해 새로 만든 곡은 이어지지 않아 찾지 못한다.
 */
export async function listDescendants(
  db: Db,
  deckId: string,
): Promise<DescendantDeck[]> {
  const found: DescendantDeck[] = [];
  const seen = new Set([deckId]);
  let parents = [deckId];
  while (parents.length > 0) {
    const next: string[] = [];
    for (let i = 0; i < parents.length; i += DESCENDANT_QUERY_CONCURRENCY) {
      const batch = parents.slice(i, i + DESCENDANT_QUERY_CONCURRENCY);
      const children = await Promise.all(
        batch.map(async (parent) => {
          const snapshot = await decksCol(db)
            .where("forkedFrom", "==", parent)
            .where("presentationId", "==", null)
            .get();
          return snapshot.docs.map((doc) => ({ parent, deck: doc.data() }));
        }),
      );
      for (const { parent, deck } of children.flat()) {
        if (seen.has(deck.id)) continue;
        seen.add(deck.id);
        next.push(deck.id);
        found.push({
          id: deck.id,
          userId: deck.userId,
          title: deck.title,
          forkedFrom: parent,
          listed: deck.listed,
          takenDown: Boolean(deck.takedownAt),
        });
      }
    }
    parents = next;
  }
  return found;
}

/**
 * 이 곡에서 가져간 보관함 곡(`listDescendants`)을 모두 게시 중단하고, 그렇게 한 곡 id를 돌려준다.
 * 이미 게시 중단된 곡은 건너뛴다. 사본은 지우지 않으므로 주인은 계속 쓸 수 있고 공개만 못 한다.
 * 운영 기록에는 이 곡 때문에 막은 곡(`cause: "fork"`)으로 남긴다.
 */
export async function takedownForks(
  db: Db,
  deckId: string,
  now: Date = new Date(),
  note: string | null = null,
): Promise<string[]> {
  const takenDown: string[] = [];
  for (const deck of await listDescendants(db, deckId)) {
    if (deck.takenDown) continue;
    const cause: EventCause = { cause: "fork", sourceDeckId: deckId, note };
    if (await takeDown(db, deck.id, now, cause)) takenDown.push(deck.id);
  }
  return takenDown;
}

async function revokeSessionsOf(db: Db, userId: string): Promise<number> {
  const sessions = await db
    .collection(COLLECTIONS.sessions)
    .where("userId", "==", userId)
    .get();
  await runBulk(db, (writer) =>
    sessions.docs.map((doc) => writer.delete(doc.ref)),
  );
  return sessions.size;
}

export type BanResult =
  | {
      status: "banned";
      /** 게시 중단한 곡: 제한할 때 공개 중이던 보관함 곡 */
      takenDownDeckIds: string[];
      /** 끊은 로그인 세션 수 */
      revokedSessions: number;
    }
  | { status: "not_found" }
  | { status: "official" };

/**
 * 계정 제한(이용약관 제6조). 이 계정은 공유 라이브러리에 곡을 공개하거나, 새로 가져오거나,
 * 신고하지 못한다. 공개·가져오기·신고 트랜잭션이 `bannedAt`을 확인하므로 로그인 세션과 상관없이
 * 곧바로 막힌다. 공개 중인 보관함 곡은 모두 게시 중단하고 로그인 세션을 끊는다. 다시 로그인하면
 * 비공개 곡과 프레젠테이션은 그대로 쓸 수 있다.
 *
 * 제한 시각을 먼저 쓰고 공개 곡을 찾으므로 그사이 공개한 곡도 빠지지 않는다. 다시 불러도 처음
 * 제한한 시각을 지키고, 남은 공개 곡과 세션만 처리한다.
 *
 * 공식 라이브러리 계정(`OFFICIAL_LIBRARY_USER_ID`)은 아무것도 하지 않고 `official`이다. 제한하면
 * 공식 곡 전부가 게시 중단되고, 푸는 길은 `restoreDeck`을 곡마다 부르는 것뿐이다.
 */
export async function banUser(
  db: Db,
  userId: string,
  now: Date = new Date(),
  note: string | null = null,
): Promise<BanResult> {
  if (userId === OFFICIAL_LIBRARY_USER_ID) return { status: "official" };
  const found = await db.runTransaction(async (tx) => {
    const ref = usersCol(db).doc(userId);
    const user = (await tx.get(ref)).data();
    if (!user) return false;
    if (!isBannedUser(user)) {
      tx.update(ref, { bannedAt: now });
      recordModerationEvent(tx, db, {
        action: "ban",
        ...directCause(note),
        userId,
        deckId: null,
        title: null,
        at: now,
      });
    }
    return true;
  });
  if (!found) return { status: "not_found" };

  const listed = await decksCol(db)
    .where("userId", "==", userId)
    .where("listed", "==", true)
    .get();
  const cause: EventCause = { cause: "ban", sourceDeckId: null, note };
  const takenDownDeckIds: string[] = [];
  for (const doc of listed.docs) {
    if (await takeDown(db, doc.id, now, cause)) takenDownDeckIds.push(doc.id);
  }
  return {
    status: "banned",
    takenDownDeckIds,
    revokedSessions: await revokeSessionsOf(db, userId),
  };
}

/**
 * 계정 제한을 푼다. 제한할 때 게시 중단한 곡은 그대로 두므로 `restoreDeck`으로 하나씩 푼다.
 * 사용자가 없으면 `false`다.
 */
export async function unbanUser(
  db: Db,
  userId: string,
  now: Date = new Date(),
  note: string | null = null,
): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const ref = usersCol(db).doc(userId);
    const user = (await tx.get(ref)).data();
    if (!user) return false;
    if (isBannedUser(user)) {
      tx.update(ref, { bannedAt: null });
      recordModerationEvent(tx, db, {
        action: "unban",
        ...directCause(note),
        userId,
        deckId: null,
        title: null,
        at: now,
      });
    }
    return true;
  });
}

async function closeReports(
  db: Db,
  reportIds: readonly string[],
  status: "resolved" | "rejected",
  note: string,
  now: Date,
): Promise<number> {
  const batch = db.batch();
  for (const id of reportIds) {
    batch.update(reportsCol(db).doc(id), {
      status,
      resolvedAt: now,
      resolutionNote: note,
    });
  }
  if (reportIds.length > 0) await batch.commit();
  return reportIds.length;
}

/** 한 곡에 걸린 처리 대기 신고를 모두 처리 완료로 닫는다 */
export async function resolveReportsForTarget(
  db: Db,
  deckId: string,
  note: string,
  now: Date = new Date(),
): Promise<number> {
  const pending = await reportsCol(db)
    .where("deckId", "==", deckId)
    .where("status", "==", "pending")
    .get();
  return closeReports(
    db,
    pending.docs.map((doc) => doc.id),
    "resolved",
    note,
    now,
  );
}

/** 신고 하나를 처리 완료로 닫는다 */
export async function resolveReport(
  db: Db,
  reportId: string,
  note: string,
  now: Date = new Date(),
): Promise<number> {
  return closeReports(db, [reportId], "resolved", note, now);
}

/** 신고 하나를 기각한다 */
export async function rejectReport(
  db: Db,
  reportId: string,
  note: string,
  now: Date = new Date(),
): Promise<number> {
  return closeReports(db, [reportId], "rejected", note, now);
}
