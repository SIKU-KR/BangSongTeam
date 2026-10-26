import type {
  DocumentReference,
  Query,
  Transaction,
} from "@google-cloud/firestore";
import {
  API_ERRORS,
  isReservedDocumentId,
  OFFICIAL_LIBRARY_USER_ID,
  OPS_ERRORS,
} from "#shared";
import { runBulk, type Db } from "../client";
import {
  chunkIds,
  COLLECTIONS,
  decksCol,
  presentationMembersCol,
  presentationsCol,
  reportsCol,
  usersCol,
  type DeckDoc,
  type ModerationEventDoc,
  type ReportDoc,
} from "../collections";
import { withDeckIndex } from "../deckIndex";
import { isBannedUser } from "../queries/limits";
import { parseSlides } from "../queries/mappers";
import {
  findTakenDownAncestor,
  findTakenDownSource,
  recordModerationEvent,
  type DeckReader,
} from "../queries/takedowns";

/**
 * 신고·게시 중단 운영 작업. 관리자 화면 없이 `scripts/moderation.mjs`로 실행한다.
 * 게시 중단은 곡을 비공개로 돌리고 다시 공개하지 못하게 막는다. 공개 범위와 검색 색인은
 * `withDeckIndex`가 함께 고친다. 게시 중단·해제와 계정 제한·해제는 같은 트랜잭션에서 운영 기록
 * (`ModerationEventDoc`)으로 남긴다.
 *
 * 스크립트는 오류를 찍고 곧바로 끝나므로 트랜잭션 콜백은 던지지 않고 거절을 반환값으로 알린다.
 * Firestore SDK는 콜백이 던져도 롤백 요청을 기다리지 않고 보내서, 요청이 나가기 전에 프로세스가
 * 끝나면 그 문서의 잠금이 한참 남는다. 같은 까닭으로 여러 곡을 나눠 처리하다 하나가 실패하면
 * 새 작업은 시작하지 않고, 진행 중인 작업이 모두 끝난 뒤에 오류를 던진다. 여러 신고를 닫을 때는
 * 범위 조회를 트랜잭션 밖에서 하고 문서 단위로만 다시 읽어, 동시에 도는 작업끼리 서로 잠가
 * 재시도가 늘지 않게 한다.
 *
 * 운영자가 붙여 넣은 값이 문서 id가 될 수 없으면(빈 값, `/`가 든 주소, `.`·`..`, `__…__`) SDK가
 * 던지거나 서버가 거절해 목록 전체가 멈추므로, 그런 값은 문서를 읽기 전에 "없는 id"로 다룬다.
 */

/** Firestore 한 번의 쓰기(트랜잭션·배치)가 담을 수 있는 문서 수 */
const MAX_BATCH_WRITES = 500;

/** 곡·신고 여러 개를 처리할 때 동시에 보내는 요청 수. 계정 하나의 곡이 수천 개여도 연결을 다 쓰지 않게 한다 */
const CONCURRENCY = 20;

function isDocumentId(id: string): boolean {
  return (
    id !== "" &&
    id !== "." &&
    id !== ".." &&
    !id.includes("/") &&
    !isReservedDocumentId(id)
  );
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  const failures: unknown[] = [];
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (failures.length === 0 && next < items.length) {
        const index = next++;
        try {
          results[index] = await run(items[index] as T);
        } catch (error) {
          failures.push(error);
        }
      }
    },
  );
  await Promise.all(workers);
  if (failures.length > 0) throw failures[0];
  return results;
}

export interface PendingReport {
  id: string;
  deckId: string | null;
  reporterId: string | null;
  reason: ReportDoc["reason"];
  details: string | null;
  reportedAt: string;
  targetTitle: string | null;
  /** 신고한 곡의 주인 */
  targetUserId: string | null;
}

function pendingReports(db: Db): Query<ReportDoc> {
  return reportsCol(db).where("status", "==", "pending");
}

/** 처리 대기 신고 수 */
export async function countPendingReports(db: Db): Promise<number> {
  const snapshot = await pendingReports(db).count().get();
  return snapshot.data().count;
}

/**
 * 처리 대기 신고 (접수 순). 신고자와 곡 주인을 함께 보여 줘 한 계정이 몰아서 낸 신고를
 * 알아볼 수 있다. 곡이 지워졌으면 접수할 때 남긴 제목과 주인을 보여 준다. 그 기록이 없는
 * 예전 신고는 지금 곡에서 읽는다. `limit`을 주면 가장 오래된 신고부터 그만큼만 곡을 찾아 붙인다.
 */
export async function listPendingReports(
  db: Db,
  { limit }: { limit?: number } = {},
): Promise<PendingReport[]> {
  const snapshot = await pendingReports(db).get();
  const reports = snapshot.docs
    .map((doc) => doc.data())
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .slice(0, limit);
  const deckIds = [
    ...new Set(reports.flatMap((r) => (r.deckId ? [r.deckId] : []))),
  ];
  const targets = new Map<string, { title: string; userId: string }>();
  await mapWithConcurrency(chunkIds(deckIds), CONCURRENCY, async (ids) => {
    const snapshots = await db.getAll(...ids.map((id) => decksCol(db).doc(id)));
    for (const deck of snapshots) {
      const data = deck.data();
      if (!data) continue;
      targets.set(deck.id, { title: data.title, userId: data.userId });
    }
  });
  return reports.map((report) => {
    const target = report.deckId ? targets.get(report.deckId) : undefined;
    return {
      id: report.id,
      deckId: report.deckId,
      reporterId: report.reporterId,
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

type DeckChange = Partial<
  Pick<DeckDoc, "visibility" | "takedownAt" | "publishedAt">
>;

type Refusal = { refusal: string };

type LibraryUpdate =
  | { status: "updated" }
  | { status: "notLibrary" }
  | { status: "refused"; reason: string };

async function updateLibraryDeck(
  db: Db,
  deckId: string,
  change: (deck: DeckDoc, tx: Transaction) => Promise<DeckChange | Refusal>,
  action: "takedown" | "restore",
  now: Date,
  cause: EventCause,
): Promise<LibraryUpdate> {
  if (!isDocumentId(deckId)) return { status: "notLibrary" };
  const ref = decksCol(db).doc(deckId);
  return db.runTransaction(async (tx): Promise<LibraryUpdate> => {
    const deck = (await tx.get(ref)).data();
    if (!deck || deck.presentationId !== null) return { status: "notLibrary" };
    const next = await change(deck, tx);
    if ("refusal" in next) return { status: "refused", reason: next.refusal };
    tx.set(ref, withDeckIndex({ ...deck, ...next }));
    recordModerationEvent(tx, db, {
      action,
      ...cause,
      userId: deck.userId,
      deckId,
      title: deck.title,
      at: now,
    });
    return { status: "updated" };
  });
}

async function takeDown(
  db: Db,
  deckId: string,
  now: Date,
  cause: EventCause,
): Promise<boolean> {
  const result = await updateLibraryDeck(
    db,
    deckId,
    async (deck) => ({
      visibility: "private",
      takedownAt: deck.takedownAt ?? now,
    }),
    "takedown",
    now,
    cause,
  );
  return result.status === "updated";
}

/**
 * 게시 중단: 비공개로 돌리고 공유 라이브러리·검색에서 뺀다. 소유자는 다시 공개할 수 없다.
 * 이미 중단된 곡은 처음 중단한 시각을 그대로 둬 다시 실행해도 중단 시각이 바뀌지 않는다.
 * 운영 기록은 운영자가 실행할 때마다 남긴다.
 */
export async function takedownDeck(
  db: Db,
  deckId: string,
  now: Date = new Date(),
  note: string | null = null,
): Promise<boolean> {
  return takeDown(db, deckId, now, directCause(note));
}

export interface RestoreOptions {
  /** 비공개로 두지 않고 운영자가 곧바로 다시 공개한다 */
  republish?: boolean;
  now?: Date;
  /** 운영 기록에 남길 사유 */
  note?: string | null;
}

/**
 * 게시 중단 해제. 기본은 비공개로 둔 채 이 곡 자신의 게시 중단만 푼다. 거슬러 올라간 원본이 아직
 * 게시 중단돼 있으면 소유자는 여전히 공개하지 못하고(`findBlockingSource`), 이 곡에서 가져간 곡의
 * 게시 중단도 그대로 남는다(`listDescendants`).
 *
 * 공식 라이브러리 곡처럼 로그인할 수 없는 계정이 주인이면 다시 공개할 사람이 없어 곡이
 * 영영 돌아오지 못하므로, `republish`로 운영자가 대신 공개한다. 잘못 넣은 id로 남의 비공개
 * 곡이 공개되지 않도록 게시를 중단한 적 없는 곡은 막고, 슬라이드가 없는 곡과 가져온 원본이
 * 게시 중단된 곡은 사용자 공개(`setDeckVisibility`)와 같은 규칙으로 막는다.
 */
export async function restoreDeck(
  db: Db,
  deckId: string,
  { republish = false, now = new Date(), note = null }: RestoreOptions = {},
): Promise<boolean> {
  const result = await updateLibraryDeck(
    db,
    deckId,
    async (deck, tx) => {
      if (!republish) return { takedownAt: null };
      if (deck.takedownAt === null) {
        return { refusal: OPS_ERRORS.deck.notTakenDown };
      }
      if (parseSlides(deck.slides).length === 0) {
        return { refusal: API_ERRORS.deck.noSlides };
      }
      if (await findTakenDownSource(tx, db, deck)) {
        return { refusal: OPS_ERRORS.deck.sourceTakenDown };
      }
      return { takedownAt: null, visibility: "public", publishedAt: now };
    },
    "restore",
    now,
    directCause(note),
  );
  if (result.status === "refused") throw new Error(result.reason);
  return result.status === "updated";
}

/** 이 곡에서 가져간 보관함 곡 하나 (`listDescendants`) */
export interface DescendantDeck {
  id: string;
  userId: string;
  title: string;
  /** 이 곡이 가져온 곡 */
  forkedFrom: string;
  listed: boolean;
  /** 이 곡 자신이 게시 중단됐다 */
  takenDown: boolean;
  /**
   * 이 곡의 공개를 막는 원본: 거슬러 올라가며 처음 만나는 게시 중단된 곡 id(`findBlockingSource`).
   * 없으면 `null`이다. 이 값이 있으면 `takenDown`이 `false`여도 공개하지 못한다.
   */
  blockedBy: string | null;
}

const DESCENDANT_QUERY_CONCURRENCY = 30;

function cachedDeckReader(db: Db, known: Iterable<DeckDoc> = []): DeckReader {
  const reads = new Map<string, Promise<DeckDoc | undefined>>();
  for (const deck of known) reads.set(deck.id, Promise.resolve(deck));
  return (deckId) => {
    const cached = reads.get(deckId);
    if (cached) return cached;
    const read = decksCol(db)
      .doc(deckId)
      .get()
      .then((snapshot) => snapshot.data());
    reads.set(deckId, read);
    return read;
  };
}

/**
 * 이 곡의 공개를 막는 원본: 거슬러 올라가며 처음 만나는 게시 중단된 곡 id. 없거나 곡이 없으면
 * `null`이다. 곡을 공개하는 트랜잭션(`setDeckVisibility`)과 같은 길(`findTakenDownAncestor`)로 찾으므로,
 * 이 값이 있으면 곡 자신의 게시 중단을 풀어도 공개하지 못한다.
 */
export async function findBlockingSource(
  db: Db,
  deckId: string,
): Promise<string | null> {
  const read = cachedDeckReader(db);
  const deck = await read(deckId);
  if (!deck) return null;
  return (await findTakenDownAncestor(read, deck))?.id ?? null;
}

/**
 * 이 곡에서 가져간 보관함 곡 전부. 가져간 곡을 다시 가져간 곡까지 너비 우선으로 찾고, 공개
 * 여부와 상관없이 담는다(함께 게시 중단할지 판단용). 비공개 사본도 나중에 공개할 수 있고, 곡을
 * 프레젠테이션에 담을 때마다 비공개 사본이 생기기 때문이다. 곡마다 공개를 막는 원본(`blockedBy`)도
 * 함께 알려, 원본의 게시 중단을 풀거나 곡 하나만 풀었을 때 실제로 공개할 수 있는 곡을 가린다.
 *
 * 원본이 지워져 `forkedFrom`이 비워진 곡과 가사를 복사해 새로 만든 곡은 이어지지 않아 찾지 못한다.
 */
export async function listDescendants(
  db: Db,
  deckId: string,
): Promise<DescendantDeck[]> {
  const found: { parent: string; deck: DeckDoc }[] = [];
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
      for (const child of children.flat()) {
        if (seen.has(child.deck.id)) continue;
        seen.add(child.deck.id);
        next.push(child.deck.id);
        found.push(child);
      }
    }
    parents = next;
  }
  const read = cachedDeckReader(
    db,
    found.map(({ deck }) => deck),
  );
  return Promise.all(
    found.map(async ({ parent, deck }) => ({
      id: deck.id,
      userId: deck.userId,
      title: deck.title,
      forkedFrom: parent,
      listed: deck.listed,
      takenDown: Boolean(deck.takedownAt),
      blockedBy: (await findTakenDownAncestor(read, deck))?.id ?? null,
    })),
  );
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

/**
 * 곡 여러 개를 게시 중단한다. 보관함 곡이 아니거나 없는 id(문서 id가 될 수 없는 값 포함)는
 * 건너뛰고 따로 알려 줘, 목록 일부가 틀려도 나머지는 처리된다. 요청이 실패하면 새 곡은
 * 시작하지 않고 진행 중인 곡이 끝난 뒤 오류를 던진다. 이미 중단한 곡은 처음 기록을 유지하므로
 * 같은 목록으로 다시 실행해도 된다.
 */
export async function takedownDecks(
  db: Db,
  deckIds: readonly string[],
  now: Date = new Date(),
  note: string | null = null,
): Promise<{ takenDown: string[]; notLibrary: string[] }> {
  const ids = [...new Set(deckIds)];
  const done = await mapWithConcurrency(ids, CONCURRENCY, (id) =>
    takedownDeck(db, id, now, note),
  );
  return {
    takenDown: ids.filter((_, index) => done[index]),
    notLibrary: ids.filter((_, index) => !done[index]),
  };
}

function libraryDecksOf(db: Db, userId: string): Query<DeckDoc> {
  return decksCol(db)
    .where("userId", "==", userId)
    .where("presentationId", "==", null);
}

export interface UserDeck {
  id: string;
  title: string;
  artist: string;
  visibility: DeckDoc["visibility"];
  listed: boolean;
  takedownAt: string | null;
  forkCount: number;
  updatedAt: string;
}

/** 한 계정의 보관함 곡 (프레젠테이션 사본은 뺀다). 최근 수정순 */
export async function listUserDecks(
  db: Db,
  userId: string,
): Promise<UserDeck[]> {
  const snapshot = await libraryDecksOf(db, userId).get();
  return snapshot.docs
    .map((doc) => doc.data())
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .map((deck) => ({
      id: deck.id,
      title: deck.title,
      artist: deck.artist,
      visibility: deck.visibility,
      listed: deck.listed,
      takedownAt: deck.takedownAt?.toISOString() ?? null,
      forkCount: deck.forkCount,
      updatedAt: deck.updatedAt.toISOString(),
    }));
}

/**
 * 한 계정의 보관함 곡을 모두 게시 중단한다. 비공개 곡도 포함해, 계정이 나중에 그 곡을 다시
 * 공개하지 못하게 한다. 곡마다 `takedownDeck`을 거치므로 색인과 프레젠테이션 사본 제외
 * 규칙이 그대로 적용된다. 이미 게시 중단된 곡은 건너뛰어 다시 실행해도 운영 기록이 겹치지
 * 않는다. 중단 전 공개 범위는 남기지 않으므로 나중에 `restoreDeck`의 `republish`로 되살리면
 * 원래 비공개였던 곡도 공개된다. 새로 게시 중단한 곡 수를 돌려준다.
 */
export async function takedownUserDecks(
  db: Db,
  userId: string,
  now: Date = new Date(),
  note: string | null = null,
): Promise<number> {
  const snapshot = await libraryDecksOf(db, userId).select("takedownAt").get();
  const { takenDown } = await takedownDecks(
    db,
    snapshot.docs.filter((doc) => !doc.get("takedownAt")).map((doc) => doc.id),
    now,
    note,
  );
  return takenDown.length;
}

/**
 * 한 계정의 세션 문서를 모두 지운다. 로그인한 기기는 세션 쿠키 캐시
 * (`SESSION_COOKIE_CACHE_SECONDS`, 5분) 동안 세션을 DB에서 다시 확인하지 않아 그동안 계속
 * 쓸 수 있으니, 바로 끊기지는 않는다. 계정을 정리할 때는 5분 뒤 `takedownUserDecks`를 한 번 더
 * 실행해 그사이 올린 곡까지 중단한다. 계정 자체는 막지 않아 다시 로그인할 수 있다. 지운 세션
 * 수를 돌려준다.
 */
export async function revokeSessions(db: Db, userId: string): Promise<number> {
  const snapshot = await db
    .collection(COLLECTIONS.sessions)
    .where("userId", "==", userId)
    .get();
  await runBulk(db, (writer) =>
    snapshot.docs.map((doc) => writer.delete(doc.ref)),
  );
  return snapshot.size;
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
    revokedSessions: await revokeSessions(db, userId),
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

async function closeIfPending(
  db: Db,
  refs: readonly DocumentReference<ReportDoc>[],
  status: "resolved" | "rejected",
  note: string,
  now: Date,
): Promise<number> {
  let closed = 0;
  for (let start = 0; start < refs.length; start += MAX_BATCH_WRITES) {
    const chunk = refs.slice(start, start + MAX_BATCH_WRITES);
    closed += await db.runTransaction(async (tx) => {
      const pending = (await tx.getAll(...chunk)).filter(
        (snapshot) => snapshot.data()?.status === "pending",
      );
      for (const snapshot of pending) {
        tx.update(snapshot.ref, {
          status,
          resolvedAt: now,
          resolutionNote: note,
        });
      }
      return pending.length;
    });
  }
  return closed;
}

/** 한 곡에 걸린 처리 대기 신고를 모두 처리 완료로 닫는다 */
export async function resolveReportsForTarget(
  db: Db,
  deckId: string,
  note: string,
  now: Date = new Date(),
): Promise<number> {
  return resolveReportsForDecks(db, [deckId], note, now);
}

/** 곡 여러 개에 걸린 처리 대기 신고를 모두 처리 완료로 닫는다 */
export async function resolveReportsForDecks(
  db: Db,
  deckIds: readonly string[],
  note: string,
  now: Date = new Date(),
): Promise<number> {
  const snapshots = await mapWithConcurrency(
    [...new Set(deckIds)],
    CONCURRENCY,
    (deckId) => pendingReports(db).where("deckId", "==", deckId).get(),
  );
  return closeIfPending(
    db,
    snapshots.flatMap((snapshot) => snapshot.docs.map((doc) => doc.ref)),
    "resolved",
    note,
    now,
  );
}

/**
 * 한 사람이 낸 처리 대기 신고를 모두 기각한다. 같은 계정이 곡마다 낸 신고를 한 번에 치운다.
 * 이미 닫은 신고는 건드리지 않는다.
 */
export async function rejectReportsByReporter(
  db: Db,
  reporterId: string,
  note: string,
  now: Date = new Date(),
): Promise<number> {
  const snapshot = await pendingReports(db)
    .where("reporterId", "==", reporterId)
    .get();
  return closeIfPending(
    db,
    snapshot.docs.map((doc) => doc.ref),
    "rejected",
    note,
    now,
  );
}

export interface CloseReportOptions {
  now?: Date;
  /** 이미 닫은 신고의 결과와 메모를 일부러 바로잡는다 */
  force?: boolean;
}

async function closeReport(
  db: Db,
  reportId: string,
  status: "resolved" | "rejected",
  note: string,
  { now = new Date(), force = false }: CloseReportOptions,
): Promise<void> {
  if (!isDocumentId(reportId)) throw new Error(OPS_ERRORS.report.notFound);
  const ref = reportsCol(db).doc(reportId);
  const failure = await db.runTransaction(
    async (tx): Promise<string | null> => {
      const report = (await tx.get(ref)).data();
      if (!report) return OPS_ERRORS.report.notFound;
      if (report.status !== "pending" && !force) {
        return report.status === "resolved"
          ? OPS_ERRORS.report.alreadyResolved
          : OPS_ERRORS.report.alreadyRejected;
      }
      tx.update(ref, { status, resolvedAt: now, resolutionNote: note });
      return null;
    },
  );
  if (failure) throw new Error(failure);
}

/**
 * 신고 하나를 처리 완료로 닫는다. 이미 닫은 신고는 처리 기록이 바뀌지 않게 멈추고,
 * `force`로만 바로잡는다.
 */
export async function resolveReport(
  db: Db,
  reportId: string,
  note: string,
  options: CloseReportOptions = {},
): Promise<void> {
  await closeReport(db, reportId, "resolved", note, options);
}

/** 신고 하나를 기각한다. 이미 닫은 신고는 `force`로만 바로잡는다 */
export async function rejectReport(
  db: Db,
  reportId: string,
  note: string,
  options: CloseReportOptions = {},
): Promise<void> {
  await closeReport(db, reportId, "rejected", note, options);
}

/**
 * 공유 링크 토큰으로 프레젠테이션 id를 찾는다. 링크가 꺼진 프레젠테이션도 토큰을 남기므로
 * 찾는다. 신고가 `/s/<토큰>` 주소로만 들어올 때 운영자가 id를 알아내는 길이다.
 */
export async function findPresentationIdByLinkToken(
  db: Db,
  token: string,
): Promise<string | null> {
  const snapshot = await presentationsCol(db)
    .where("linkToken", "==", token)
    .limit(1)
    .get();
  return snapshot.docs[0]?.id ?? null;
}

/**
 * 공유 링크를 운영자가 막는다. 링크를 끄고 토큰을 비운 뒤 링크로 들어온 멤버를 모두 지운다.
 * 로그인 없이 읽는 `GET /api/share/:token`은 토큰만 보므로 퍼진 주소는 바로 죽고, 멤버를
 * 지워 둬서 소유자가 다시 공유해도(새 토큰이 만들어진다) 예전 멤버가 접근을 되찾지 못한다.
 * 퍼진 링크는 멤버가 한 번에 쓸 수 있는 문서 수를 넘을 수 있어, 접근부터 끊은 다음 멤버를
 * 나눠 지운다. 중간에 멈추면 토큰이 이미 지워져 링크 주소로는 찾을 수 없으니 같은
 * 프레젠테이션 id로 다시 실행한다. 프레젠테이션이 없으면(문서 id가 될 수 없는 값 포함) false다.
 */
export async function disableShareLink(
  db: Db,
  presentationId: string,
): Promise<boolean> {
  if (!isDocumentId(presentationId)) return false;
  const ref = presentationsCol(db).doc(presentationId);
  const disabled = await db.runTransaction(async (tx) => {
    if (!(await tx.get(ref)).exists) return false;
    tx.update(ref, { linkAccess: "off", linkToken: null });
    return true;
  });
  if (!disabled) return false;

  const members = await presentationMembersCol(db)
    .where("presentationId", "==", presentationId)
    .get();
  await runBulk(db, (writer) =>
    members.docs.map((member) => writer.delete(member.ref)),
  );
  return true;
}
