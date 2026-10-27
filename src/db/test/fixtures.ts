import { randomUUID } from "node:crypto";
import type { Transaction, WriteBatch } from "@google-cloud/firestore";
import { createFirestore, type Db } from "../client";
import {
  backgroundsCol,
  decksCol,
  foldersCol,
  presentationMembersCol,
  presentationsCol,
  usersCol,
  memberDocId,
  type BackgroundDoc,
  type DeckDoc,
  type FolderDoc,
  type PresentationDoc,
  type UserDoc,
} from "../collections";
import { withDeckIndex } from "../deckIndex";

const EPOCH = new Date(0);

/**
 * 테스트마다 비어 있는 Firestore. 에뮬레이터(`config/firestoreEmulator.ts`)에 매번 새
 * 프로젝트 id로 붙으므로 다른 테스트·파일과 데이터를 나누지 않는다.
 */
const projectIds = new WeakMap<Db, string>();

export function createTestDb(): Db {
  const projectId = `test-${randomUUID()}`;
  const db = createFirestore({ projectId });
  projectIds.set(db, projectId);
  return db;
}

/** 테스트 Firestore의 모든 문서를 지운다 (에뮬레이터 전용 API) */
export async function clearDb(db: Db): Promise<void> {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  const res = await fetch(
    `http://${host}/emulator/v1/projects/${projectIds.get(db)}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(`clearDb failed: ${res.status}`);
}

/** 사용자 문서. 이름 외 필드는 비우고 시각 0을 채운다 */
export function userDoc(row: Pick<UserDoc, "id"> & Partial<UserDoc>): UserDoc {
  return {
    name: row.id,
    email: null,
    emailVerified: false,
    image: null,
    termsAgreedAt: null,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    ...row,
  };
}

/**
 * 곡 문서. 빈 곡 내용과 시각 0을 채우고 공개 범위·검색 색인을 붙인다.
 * 프레젠테이션 사본은 `presentationId`·`itemId`·`position`을 함께 넘긴다.
 */
export function deckDoc(
  row: Pick<DeckDoc, "id" | "userId"> &
    Partial<Omit<DeckDoc, "listed" | "searchGrams">>,
): DeckDoc {
  return withDeckIndex({
    presentationId: null,
    itemId: null,
    position: null,
    title: "song",
    artist: "",
    lyricsRaw: "lyrics",
    slides: "[]",
    style: "{}",
    backgroundId: null,
    forkedFrom: null,
    forkedFromAuthorName: null,
    visibility: "private",
    publishedAt: null,
    takedownAt: null,
    forkCount: 0,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    ...row,
  });
}

/** 프레젠테이션 머리 문서 */
export function presentationDoc(
  row: Pick<PresentationDoc, "id" | "userId"> & Partial<PresentationDoc>,
): PresentationDoc {
  return {
    title: "세트",
    serviceDate: "2026-09-27",
    folderId: null,
    trashedAt: null,
    linkAccess: "off",
    linkToken: null,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    ...row,
  };
}

/**
 * 사본 곡이 `copies`곡씩 담긴 프레젠테이션 `count`개. Firestore `in` 조건 한도(30)를 넘는
 * 조회·삭제를 시험할 때 쓴다. 사본 id는 자리의 역순으로 정렬되게 붙여, 읽는 쪽이 자리순으로
 * 다시 세우는지도 함께 드러난다.
 */
export function presentationsWithCopies(
  userId: string,
  count: number,
  copies: number,
  overrides: Partial<PresentationDoc> = {},
): { presentations: PresentationDoc[]; decks: DeckDoc[] } {
  const pad = (value: number, width: number) =>
    String(value).padStart(width, "0");
  const presentations = Array.from({ length: count }, (_, index) =>
    presentationDoc({ id: `p${pad(index, 20)}`, userId, ...overrides }),
  );
  const decks = presentations.flatMap((presentation, index) =>
    Array.from({ length: copies }, (_, position) =>
      deckDoc({
        id: `d${pad(index, 10)}${pad(copies - position, 10)}`,
        userId,
        presentationId: presentation.id,
        itemId: `i${pad(index, 10)}${pad(position, 10)}`,
        position,
      }),
    ),
  );
  return { presentations, decks };
}

/** 폴더 문서 */
export function folderDoc(
  row: Pick<FolderDoc, "id" | "userId"> & Partial<FolderDoc>,
): FolderDoc {
  return {
    parentId: null,
    name: "폴더",
    trashedAt: null,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    ...row,
  };
}

/** 배경 문서 */
export function backgroundDoc(
  row: Pick<BackgroundDoc, "id"> & Partial<BackgroundDoc>,
): BackgroundDoc {
  return {
    title: `배경 ${row.id}`,
    kind: "video",
    mediaKey: `loops/${row.id}.mp4`,
    posterKey: `posters/${row.id}.webp`,
    durationSec: 20,
    sizeBytes: 0,
    license: "",
    description: "",
    keywords: [],
    createdAt: EPOCH,
    ...row,
  };
}

/**
 * 배치 하나에 담는 쓰기 수. Firestore의 쓰기 한도(500)를 에뮬레이터는 검사하지 않아, 시드도
 * 운영에서 통할 크기로 나눠 쓴다.
 */
const MAX_BATCH_WRITES = 500;

/** 문서들을 넣는다. 많으면 `MAX_BATCH_WRITES`씩 나눈 배치로 차례로 쓴다 */
export async function seedDocs(
  db: Db,
  docs: {
    users?: UserDoc[];
    decks?: DeckDoc[];
    presentations?: PresentationDoc[];
    folders?: FolderDoc[];
    backgrounds?: BackgroundDoc[];
    members?: { presentationId: string; userId: string }[];
  },
): Promise<void> {
  const writes: ((batch: WriteBatch) => void)[] = [];
  for (const row of docs.users ?? []) {
    writes.push((batch) => batch.set(usersCol(db).doc(row.id), row));
  }
  for (const row of docs.decks ?? []) {
    writes.push((batch) => batch.set(decksCol(db).doc(row.id), row));
  }
  for (const row of docs.presentations ?? []) {
    writes.push((batch) => batch.set(presentationsCol(db).doc(row.id), row));
  }
  for (const row of docs.folders ?? []) {
    writes.push((batch) => batch.set(foldersCol(db).doc(row.id), row));
  }
  for (const row of docs.backgrounds ?? []) {
    writes.push((batch) => batch.set(backgroundsCol(db).doc(row.id), row));
  }
  for (const row of docs.members ?? []) {
    const ref = presentationMembersCol(db).doc(
      memberDocId(row.presentationId, row.userId),
    );
    writes.push((batch) => batch.set(ref, row));
  }
  for (let start = 0; start < writes.length; start += MAX_BATCH_WRITES) {
    const batch = db.batch();
    for (const write of writes.slice(start, start + MAX_BATCH_WRITES)) {
      write(batch);
    }
    await batch.commit();
  }
}

/** `instrumentTransactions` 옵션. 호출 순번은 1부터 센다 */
export interface TransactionInstrumentOptions {
  /** 이 순번의 `runTransaction`은 아무것도 쓰지 않고 실패한다 (차례 사이에 멈춘 서버) */
  failOnCall?: number;
  /**
   * 이 순번의 `runTransaction`이 커밋된 뒤 돌려주기 전에 부른다 (차례 사이에 끼어든 다른 기기).
   * 안에서 연 트랜잭션은 세지 않는다.
   */
  afterCall?: { call: number; run: () => Promise<void> };
  /**
   * 첫 호출의 콜백을 쓰기를 버리는 트랜잭션으로 한 번 먼저 돌린다. Firestore가 경합으로 콜백을
   * 다시 돌리는 일을 흉내 낸다.
   */
  replayFirstAttempt?: boolean;
}

export interface TransactionInstrument {
  /** 콜백을 돌린 시도마다 부른 쓰기(set·update·delete·create) 수 */
  readonly writesPerAttempt: readonly number[];
  /** 가장 많이 쓴 시도의 쓰기 수 */
  max(): number;
  /** 원래 `runTransaction`으로 되돌린다 */
  restore(): void;
}

const WRITE_METHODS = new Set<PropertyKey>([
  "set",
  "update",
  "delete",
  "create",
]);

function watchWrites(
  tx: Transaction,
  onWrite: () => void,
  dropWrites: boolean,
): Transaction {
  const watched: Transaction = new Proxy(tx, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property);
      if (typeof value !== "function") return value;
      const method = value as (...args: unknown[]) => unknown;
      if (!WRITE_METHODS.has(property)) return method.bind(target);
      return (...args: unknown[]) => {
        onWrite();
        if (!dropWrites) method.apply(target, args);
        return watched;
      };
    },
  });
  return watched;
}

/**
 * `db.runTransaction`을 감싸 트랜잭션마다 쓰기 수를 세고, 차례 사이의 실패·끼어듦·콜백 재실행을
 * 일으킨다. 쓰기 한도를 에뮬레이터가 검사하지 않아 테스트가 직접 센다. 끝나면 `restore()`를 부른다.
 */
export function instrumentTransactions(
  db: Db,
  options: TransactionInstrumentOptions = {},
): TransactionInstrument {
  const ownProperty = Object.prototype.hasOwnProperty.call(
    db,
    "runTransaction",
  );
  const unwrapped = db.runTransaction;
  const original = unwrapped.bind(db);
  const writesPerAttempt: number[] = [];
  let calls = 0;
  let passThrough = false;

  const instrumented: Db["runTransaction"] = async (
    updateFunction,
    transactionOptions,
  ) => {
    if (passThrough) return original(updateFunction, transactionOptions);
    calls += 1;
    const call = calls;
    if (call === options.failOnCall) {
      throw new Error(`instrumented failure of runTransaction #${call}`);
    }
    const attempt = (tx: Transaction, dropWrites: boolean) => {
      const slot = writesPerAttempt.push(0) - 1;
      return updateFunction(
        watchWrites(
          tx,
          () => {
            writesPerAttempt[slot] += 1;
          },
          dropWrites,
        ),
      );
    };
    const result = await original(async (tx) => {
      if (call === 1 && options.replayFirstAttempt) await attempt(tx, true);
      return attempt(tx, false);
    }, transactionOptions);
    if (call === options.afterCall?.call) {
      passThrough = true;
      try {
        await options.afterCall.run();
      } finally {
        passThrough = false;
      }
    }
    return result;
  };
  db.runTransaction = instrumented;

  return {
    writesPerAttempt,
    max: () => Math.max(0, ...writesPerAttempt),
    restore: () => {
      if (ownProperty) db.runTransaction = unwrapped;
      else Reflect.deleteProperty(db, "runTransaction");
    },
  };
}
