import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { BackgroundMedia, Deck, Folder, Presentation } from "#shared";

export const OFFLINE_DB_NAME = "worship-offline-db";
export const OFFLINE_DB_VERSION = 4;

const FIRST_NANOID_DB_VERSION = 3;

export class PersistenceUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("이 브라우저에서 IndexedDB를 사용할 수 없습니다");
    this.name = "PersistenceUnavailableError";
    this.cause = cause;
  }
}

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
      serverUpdatedAt?: string;
      dirty?: boolean;
      lastSyncedAt?: number;
    };
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
  cachedAt: number;
}

let dbPromise: Promise<IDBPDatabase<WorshipOfflineDB>> | null = null;

export function isPersistenceAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}

export function getOfflineDB(): Promise<IDBPDatabase<WorshipOfflineDB>> {
  if (!isPersistenceAvailable()) {
    return Promise.reject(new PersistenceUnavailableError());
  }

  if (!dbPromise) {
    dbPromise = openDB<WorshipOfflineDB>(OFFLINE_DB_NAME, OFFLINE_DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        if (oldVersion > 0 && oldVersion < FIRST_NANOID_DB_VERSION) {
          for (const name of db.objectStoreNames) {
            void transaction.objectStore(name).clear();
          }
        }
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
      dbPromise = null;
      throw new PersistenceUnavailableError(err);
    });
  }

  return dbPromise;
}

export function closeOfflineDB(): void {
  const pending = dbPromise;
  dbPromise = null;
  if (!pending) return;
  void pending.then(
    (db) => db.close(),
    () => {},
  );
}
