import type {
  CollectionReference,
  DocumentReference,
  QueryDocumentSnapshot,
  Transaction,
  UpdateData,
} from "@google-cloud/firestore";
import { MAX_CLOCK_SKEW_MS } from "#shared";
import type { Db } from "../client";
import {
  decksCol,
  foldersCol,
  presentationsCol,
  type DeckDoc,
} from "../collections";
import { withDeckIndex } from "../deckIndex";

/** 시각을 줄이는 컬렉션 */
export type ClampedCollection = "decks" | "folders" | "presentations";

/** 컬렉션마다 시각이 미래에 박힌 문서 id */
export type FutureTimestampIds = Record<ClampedCollection, string[]>;

export interface ClampFutureTimestampsOptions {
  /** 찾기만 하지 않고 시각을 줄인다 */
  apply?: boolean;
  now?: Date;
}

const PAGE_SIZE = 200;

const TIMESTAMP_FIELDS = ["updatedAt", "createdAt"] as const;

interface Stamped {
  createdAt: unknown;
  updatedAt: unknown;
}

type Clamped = Partial<Record<(typeof TIMESTAMP_FIELDS)[number], Date>>;

function isLaterThan(value: unknown, limit: Date): value is Date {
  return value instanceof Date && value.getTime() > limit.getTime();
}

function clampedTimes(doc: Stamped, now: Date, limit: Date): Clamped | null {
  const changes: Clamped = {};
  if (isLaterThan(doc.updatedAt, limit)) changes.updatedAt = now;
  if (isLaterThan(doc.createdAt, limit)) {
    const updatedAt = changes.updatedAt ?? doc.updatedAt;
    changes.createdAt =
      updatedAt instanceof Date && updatedAt.getTime() < now.getTime()
        ? updatedAt
        : now;
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

async function idsLaterThan(
  collection: CollectionReference,
  field: (typeof TIMESTAMP_FIELDS)[number],
  limit: Date,
): Promise<string[]> {
  const ids: string[] = [];
  let last: QueryDocumentSnapshot | undefined;
  for (;;) {
    const query = collection
      .where(field, ">", limit)
      .orderBy(field)
      .select(field)
      .limit(PAGE_SIZE);
    const page = await (last ? query.startAfter(last) : query).get();
    ids.push(...page.docs.map((doc) => doc.id));
    last = page.docs.at(-1);
    if (page.size < PAGE_SIZE) return ids;
  }
}

async function clampDeck(
  tx: Transaction,
  ref: DocumentReference<DeckDoc>,
  now: Date,
  limit: Date,
): Promise<boolean> {
  const deck = (await tx.get(ref)).data();
  const changes = deck && clampedTimes(deck, now, limit);
  if (!deck || !changes) return false;
  const { listed, searchGrams } = withDeckIndex({ ...deck, ...changes });
  tx.update(ref, { ...changes, listed, searchGrams });
  return true;
}

async function clampTimes<T extends Stamped>(
  tx: Transaction,
  ref: DocumentReference<T>,
  now: Date,
  limit: Date,
): Promise<boolean> {
  const doc = (await tx.get(ref)).data();
  const changes = doc && clampedTimes(doc, now, limit);
  if (!changes) return false;
  tx.update(ref, changes as UpdateData<T>);
  return true;
}

async function clampOne(
  db: Db,
  collection: ClampedCollection,
  id: string,
  now: Date,
  limit: Date,
): Promise<boolean> {
  return db.runTransaction((tx) => {
    if (collection === "decks") {
      return clampDeck(tx, decksCol(db).doc(id), now, limit);
    }
    if (collection === "folders") {
      return clampTimes(tx, foldersCol(db).doc(id), now, limit);
    }
    return clampTimes(tx, presentationsCol(db).doc(id), now, limit);
  });
}

/**
 * 수정 시각·만든 시각이 서버 시계 + 5분(`MAX_CLOCK_SKEW_MS`)보다 늦게 저장된 곡·폴더·프레젠테이션을
 * 찾고, `apply`면 그 시각을 지금으로 줄인다. `scripts/clampFutureTimestamps.mjs`가 쓴다.
 *
 * 서버가 기기 시각을 줄이기(`clampToClock`) 전에 빠른 시계나 꾸민 요청이 남긴 값이다. 공유
 * 라이브러리는 가져간 횟수가 같으면 수정 시각순이라 그런 곡이 맨 위에 박혀 있다. 새 저장은 이미
 * 줄이므로 정확성에는 필요 없고, 그렇게 박힌 문서를 한 번 바로잡을 때만 쓴다.
 *
 * - 단일 필드 범위 조회(자동 색인)로 찾으므로 복합 색인이 필요 없다. 미리보기는 아무것도 쓰지
 *   않는다.
 * - 문서마다 트랜잭션 하나에서 다시 읽고 줄인다. 그사이 앱이 새로 저장한 문서는 다시 확인해
 *   건너뛰고, 다시 실행해도 줄일 것이 남은 문서만 쓴다.
 * - 만든 시각은 고친 수정 시각보다 늦지 않게 줄인다.
 * - 곡은 줄인 문서를 `withDeckIndex`에 통과시키고 바뀌는 필드만 고친다. 가사가 든 문서를 통째로
 *   다시 쓰지 않는다.
 * - 프레젠테이션의 수정 시각은 문서 판이다. 판을 낮추면 미래 판을 기준으로 저장하던 기기는
 *   412를 받고 서버 판을 받아 맞춘다.
 *
 * 돌려주는 id는 미리보기면 찾은 문서, `apply`면 실제로 줄인 문서다.
 */
export async function clampFutureTimestamps(
  db: Db,
  { apply = false, now = new Date() }: ClampFutureTimestampsOptions = {},
): Promise<FutureTimestampIds> {
  const limit = new Date(now.getTime() + MAX_CLOCK_SKEW_MS);
  const collections: Record<ClampedCollection, CollectionReference> = {
    decks: decksCol(db),
    folders: foldersCol(db),
    presentations: presentationsCol(db),
  };
  const result: FutureTimestampIds = {
    decks: [],
    folders: [],
    presentations: [],
  };
  for (const name of Object.keys(collections) as ClampedCollection[]) {
    const found = new Set<string>();
    for (const field of TIMESTAMP_FIELDS) {
      for (const id of await idsLaterThan(collections[name], field, limit)) {
        found.add(id);
      }
    }
    for (const id of found) {
      if (!apply || (await clampOne(db, name, id, now, limit))) {
        result[name].push(id);
      }
    }
  }
  return result;
}
