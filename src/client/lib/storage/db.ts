import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { BackgroundMedia, Deck, Folder, Presentation } from "#shared";
import { ERROR_COPY } from "#copy/common";
import { isProjecting } from "../../features/presentation/fullscreen";

export const OFFLINE_DB_NAME = "worship-offline-db";
export const OFFLINE_DB_VERSION = 5;

/**
 * 송출 화면 밖에서 저장소 열기를 기다리는 최대 시간. 브라우저가 열기 요청에 끝내 답하지 않아도
 * 부팅(세션 캐시 읽기)이 로딩 화면에 멈추지 않고, 저장하지 못한다는 경고와 함께 이어간다.
 */
export const OPEN_TIMEOUT_MS = 10_000;

/**
 * 송출 화면 밖에서 다른 탭의 연결에 막힌(`blocked`) 열기를 기다리는 최대 시간. 막혔다는 것은
 * 이전 버전의 탭이 연결을 닫지 않고 있다는 뜻이라, 오래 기다리지 않고 다른 탭을 닫으라고 알린다.
 */
export const BLOCKED_OPEN_TIMEOUT_MS = 3000;

const FIRST_NANOID_DB_VERSION = 3;
const NO_USER_BACKGROUNDS_DB_VERSION = 5;
const BROKEN_CONNECTION_ERRORS = new Set(["InvalidStateError", "UnknownError"]);

/**
 * 저장소를 쓸 수 없는 까닭.
 * - `unavailable`: IndexedDB가 없거나 열지 못했다(시크릿 모드, 막힌 저장소, 답하지 않는 열기).
 * - `blocked`: 이전 버전의 다른 탭이 연결을 닫지 않아 열기가 막혔다.
 * - `outdated`: 다른 탭이 저장소를 새 버전으로 올렸다. 이 탭은 새로고침해야 다시 연다.
 */
export type PersistenceUnavailableReason =
  "unavailable" | "blocked" | "outdated";

export class PersistenceUnavailableError extends Error {
  readonly reason: PersistenceUnavailableReason;

  constructor(
    cause?: unknown,
    reason: PersistenceUnavailableReason = "unavailable",
  ) {
    super(ERROR_COPY.indexedDbUnavailable);
    this.name = "PersistenceUnavailableError";
    this.cause = cause;
    this.reason = reason;
  }
}

export interface WorshipOfflineDB extends DBSchema {
  presentations: {
    key: string;
    value: Presentation;
  };
  decks: {
    key: string;
    value: Deck;
  };
  folders: {
    key: string;
    value: Folder;
  };
  backgrounds: {
    key: string;
    value: BackgroundMedia;
  };
  auth_session: {
    key: string;
    value: CachedSession;
  };
}

export interface CachedSession {
  id: "current";
  userId: string;
  name: string;
  image?: string | null;
  expiresAt: number;
}

type OfflineDB = IDBPDatabase<WorshipOfflineDB>;

let connection: OfflineDB | null = null;
let opening: Promise<OfflineDB> | null = null;
let stall: PersistenceUnavailableError | null = null;
const waiters = new Set<(err: PersistenceUnavailableError) => void>();
let deadlines: ReturnType<typeof setTimeout>[] = [];

export function isPersistenceAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined";
  } catch {
    return false;
  }
}

function errorName(err: unknown): string | null {
  return err instanceof DOMException ? err.name : null;
}

function clearDeadlines(): void {
  for (const timer of deadlines) clearTimeout(timer);
  deadlines = [];
}

function stallOpening(
  attempt: Promise<OfflineDB>,
  reason: PersistenceUnavailableReason,
): void {
  if (opening !== attempt) return;
  stall ??= new PersistenceUnavailableError(undefined, reason);
  for (const reject of waiters) reject(stall);
  waiters.clear();
}

function armDeadline(
  attempt: Promise<OfflineDB>,
  reason: PersistenceUnavailableReason,
  ms: number,
): void {
  deadlines.push(setTimeout(() => stallOpening(attempt, reason), ms));
}

function forget(db: OfflineDB): void {
  if (connection === db) connection = null;
}

function startOpening(): Promise<OfflineDB> {
  let opened: OfflineDB | null = null;
  let blockedArmed = false;
  const attempt: Promise<OfflineDB> = openDB<WorshipOfflineDB>(
    OFFLINE_DB_NAME,
    OFFLINE_DB_VERSION,
    {
      upgrade(db, oldVersion, _newVersion, transaction) {
        if (oldVersion > 0 && oldVersion < FIRST_NANOID_DB_VERSION) {
          for (const name of db.objectStoreNames) {
            void transaction.objectStore(name).clear();
          }
        }
        if (
          oldVersion >= FIRST_NANOID_DB_VERSION &&
          oldVersion < NO_USER_BACKGROUNDS_DB_VERSION
        ) {
          void transaction.objectStore("backgrounds").clear();
        }
        if (!db.objectStoreNames.contains("presentations")) {
          db.createObjectStore("presentations", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("decks")) {
          db.createObjectStore("decks", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("folders")) {
          db.createObjectStore("folders", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("backgrounds")) {
          db.createObjectStore("backgrounds", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("auth_session")) {
          db.createObjectStore("auth_session", { keyPath: "id" });
        }
      },
      blocked() {
        if (blockedArmed) return;
        blockedArmed = true;
        armDeadline(attempt, "blocked", BLOCKED_OPEN_TIMEOUT_MS);
      },
      blocking() {
        if (!opened) return;
        opened.close();
        forget(opened);
      },
      terminated() {
        if (opened) forget(opened);
      },
    },
  ).then(
    (db) => {
      opened = db;
      if (opening !== attempt) return db;
      clearDeadlines();
      opening = null;
      stall = null;
      connection = db;
      return db;
    },
    (err: unknown) => {
      if (opening === attempt) {
        clearDeadlines();
        opening = null;
        stall = null;
      }
      throw new PersistenceUnavailableError(
        err,
        errorName(err) === "VersionError" ? "outdated" : "unavailable",
      );
    },
  );
  opening = attempt;
  armDeadline(attempt, "unavailable", OPEN_TIMEOUT_MS);
  return attempt;
}

function waitForOpening(attempt: Promise<OfflineDB>): Promise<OfflineDB> {
  return new Promise<OfflineDB>((resolve, reject) => {
    waiters.add(reject);
    attempt.then(resolve, reject).finally(() => waiters.delete(reject));
  });
}

/**
 * 오프라인 저장소 연결을 돌려준다. 연결이 있으면 그 연결을, 없으면 하나만 여는 열기를 함께 기다린다.
 *
 * - 다른 탭이 저장소를 새 버전으로 올리거나 지우려 하면(`versionchange`) 이 탭의 연결을 닫고 잊는다.
 *   닫지 않으면 새 버전의 탭이 열리지 않는다. 그 뒤의 호출은 다시 열고, 저장소가 새 버전이면
 *   `outdated`로 거절한다. 브라우저가 연결을 끊어도(`close`) 잊고 다음 호출이 다시 연다.
 * - 송출 화면 밖에서는 열기가 다른 탭에 막힌 채 `BLOCKED_OPEN_TIMEOUT_MS`(`blocked`), 모두
 *   `OPEN_TIMEOUT_MS`(`unavailable`)가 지나면 기다리던 호출을 거절하고, 그동안 오는 호출도 곧바로
 *   거절한다. 열기는 멈추지 않고, 늦게라도 열리면 그 연결을 쓴다. 다른 탭을 닫으면 새로고침하지
 *   않아도 다음 저장부터 된다.
 * - 송출 화면에서는 기한 없이 기다린다. 오프라인에서 세션 캐시를 읽지 못하면 로그인 화면으로
 *   넘어가 관객 화면이 바뀐다.
 *
 * 열지 못하면 `PersistenceUnavailableError`로 거절하고 그 까닭(`reason`)을 단다.
 */
export function getOfflineDB(): Promise<OfflineDB> {
  if (!isPersistenceAvailable()) {
    return Promise.reject(new PersistenceUnavailableError());
  }
  if (connection) return Promise.resolve(connection);

  const attempt = opening ?? startOpening();
  if (isProjecting()) return attempt;
  if (stall) return Promise.reject(stall);
  return waitForOpening(attempt);
}

/**
 * 연결이 끊겨 난 오류(DOMException `InvalidStateError`·`UnknownError`)를 알리면 지금 연결을 닫고
 * 잊어, 다음 호출이 다시 열게 한다. WebKit은 'Connection to Indexed Database server lost'로 연결을
 * 잃어도 `close`를 보내지 않을 때가 있어, 그대로 두면 새로고침할 때까지 모든 저장이 실패한다.
 * 열고 있는 중인 연결은 건드리지 않는다. 오류는 그 전 연결에서 났다.
 */
export function discardBrokenConnection(err: unknown): void {
  const name = errorName(err);
  if (!name || !BROKEN_CONNECTION_ERRORS.has(name) || !connection) return;
  const broken = connection;
  connection = null;
  broken.close();
}

/**
 * 연결을 닫고 잊는다. 열고 있는 중이면 그 열기를 버리고, 열리는 대로 닫는다. 다음 호출은
 * 새로 연다.
 */
export function closeOfflineDB(): void {
  const current = connection;
  const pending = opening;
  connection = null;
  opening = null;
  stall = null;
  waiters.clear();
  clearDeadlines();
  current?.close();
  if (pending) {
    void pending.then(
      (db) => db.close(),
      () => undefined,
    );
  }
}
