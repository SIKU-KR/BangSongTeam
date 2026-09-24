import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { BackgroundMedia, Deck, Folder, Presentation } from "@repo/shared";

export const OFFLINE_DB_NAME = "worship-offline-db";
/**
 * v2: 오프라인 세션 캐시(`auth_session`)를 추가했다.
 * httpOnly 쿠키는 JS가 못 읽으므로, 네트워크 없이 로그인 게이트를 통과시키려면
 * 마지막으로 확인된 세션을 따로 들고 있어야 한다.
 *
 * v3: 드라이브 폴더(`folders`)를 추가했다. 홈의 폴더 트리도 프레젠테이션처럼
 * 네트워크 없이 열려야 한다.
 */
export const OFFLINE_DB_VERSION = 3;

/**
 * IndexedDB를 쓸 수 없는 환경(시크릿 모드, 저장소 차단 등)을 호출자가 식별할 수 있게
 * 감싸는 에러. 조용히 인메모리로 폴백하면 사용자는 저장된 줄 알고 예배 당일에 잃는다.
 */
export class PersistenceUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("이 브라우저에서 IndexedDB를 사용할 수 없습니다");
    this.name = "PersistenceUnavailableError";
    this.cause = cause;
  }
}

/**
 * 오프라인 저장소 스키마 (TECH_SPEC §5.4-4).
 *
 * `decks`는 보관함(scope: 'library') 곡만 담는다. 프레젠테이션에 속한 덱은
 * `presentation.items[].deck`에 임베드된 채로 프레젠테이션 문서와 함께 저장되므로
 * 별도 행을 만들지 않는다 (문서 단위 원자적 저장 = 송출 시 단일 읽기).
 */
export interface WorshipOfflineDB extends DBSchema {
  presentations: {
    key: string;
    value: Presentation;
    indexes: { "by-date": string };
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
  sync_meta: {
    key: string;
    value: {
      presentationId: string;
      /** 서버가 마지막으로 알려준 수정 시각 (ISO) — LWW 비교 기준 */
      serverUpdatedAt?: string;
      /** 로컬 변경이 아직 서버에 올라가지 않았는지 */
      dirty?: boolean;
      lastSyncedAt?: number;
      isReady?: boolean;
      cachedVideos?: string[];
      cachedAt?: number;
      storagePersisted?: boolean;
    };
  };
  auth_session: {
    key: string;
    value: CachedSession;
  };
}

/**
 * 마지막으로 서버가 확인해 준 세션.
 *
 * 예배 당일 네트워크가 끊겨도 송출이 되어야 하므로, 부팅 시 서버에 묻지 않고
 * 이 값으로 먼저 게이트를 통과시킨다 (재검증은 백그라운드).
 */
export interface CachedSession {
  /** 단일 레코드 고정 키 */
  id: "current";
  userId: string;
  name: string;
  image?: string | null;
  /** epoch ms. 지난 세션은 통과시키지 않는다 */
  expiresAt: number;
  cachedAt: number;
}

let dbPromise: Promise<IDBPDatabase<WorshipOfflineDB>> | null = null;

/** 현재 실행 환경에서 IndexedDB를 쓸 수 있는지 */
export function isPersistenceAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}

/**
 * 오프라인 DB 커넥션 (모듈 스코프 싱글턴).
 * 매 호출마다 openDB를 다시 부르면 업그레이드 트랜잭션이 겹쳐 blocked 된다.
 */
export function getOfflineDB(): Promise<IDBPDatabase<WorshipOfflineDB>> {
  if (!isPersistenceAvailable()) {
    return Promise.reject(new PersistenceUnavailableError());
  }

  if (!dbPromise) {
    dbPromise = openDB<WorshipOfflineDB>(OFFLINE_DB_NAME, OFFLINE_DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("presentations")) {
          const presentationStore = db.createObjectStore("presentations", {
            keyPath: "id",
          });
          presentationStore.createIndex("by-date", "serviceDate");
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
        if (!db.objectStoreNames.contains("sync_meta")) {
          db.createObjectStore("sync_meta", { keyPath: "presentationId" });
        }
        if (!db.objectStoreNames.contains("auth_session")) {
          db.createObjectStore("auth_session", { keyPath: "id" });
        }
      },
    }).catch((err) => {
      // 실패한 Promise를 캐시하면 이후 모든 호출이 같은 에러를 반환하므로 초기화한다
      dbPromise = null;
      throw new PersistenceUnavailableError(err);
    });
  }

  return dbPromise;
}

/** 커넥션을 닫고 싱글턴을 비운다 (테스트 격리 및 DB 삭제 전에 사용) */
export function closeOfflineDB(): void {
  const pending = dbPromise;
  dbPromise = null;
  if (!pending) return;
  void pending.then(
    (db) => db.close(),
    () => {},
  );
}
