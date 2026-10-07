import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { BackgroundMedia, Deck, Folder, Presentation } from "#shared";
import { ERROR_COPY } from "#copy/common";

export const OFFLINE_DB_NAME = "worship-offline-db";
export const OFFLINE_DB_VERSION = 5;

const FIRST_NANOID_DB_VERSION = 3;
const NO_USER_BACKGROUNDS_DB_VERSION = 5;

export class PersistenceUnavailableError extends Error {
  constructor(cause?: unknown) {
    super(ERROR_COPY.indexedDbUnavailable);
    this.name = "PersistenceUnavailableError";
    this.cause = cause;
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

let dbPromise: Promise<IDBPDatabase<WorshipOfflineDB>> | null = null;

export function isPersistenceAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined";
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
