import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getOfflineDB,
  isPersistenceAvailable,
  closeOfflineDB,
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
  PersistenceUnavailableError,
} from "./db";

describe("worship-offline-db", () => {
  beforeEach(async () => {
    closeOfflineDB();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(OFFLINE_DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    closeOfflineDB();
  });

  it("필요한 객체 저장소를 모두 생성한다", async () => {
    const db = await getOfflineDB();

    expect(db.name).toBe(OFFLINE_DB_NAME);
    expect(db.version).toBe(OFFLINE_DB_VERSION);
    expect([...db.objectStoreNames].sort()).toEqual([
      "backgrounds",
      "decks",
      "presentations",
      "sync_meta",
    ]);
  });

  it("presentations 스토어에 by-date 인덱스를 만든다", async () => {
    const db = await getOfflineDB();
    const tx = db.transaction("presentations", "readonly");

    expect([...tx.store.indexNames]).toContain("by-date");
    await tx.done;
  });

  it("두 번 호출해도 같은 커넥션을 재사용한다", async () => {
    const first = await getOfflineDB();
    const second = await getOfflineDB();

    expect(second).toBe(first);
  });

  it("IndexedDB를 쓸 수 없는 환경에서는 식별 가능한 에러로 감싼다", async () => {
    closeOfflineDB();
    vi.stubGlobal("indexedDB", undefined);

    expect(isPersistenceAvailable()).toBe(false);
    await expect(getOfflineDB()).rejects.toBeInstanceOf(
      PersistenceUnavailableError,
    );
  });

  it("IndexedDB가 있으면 사용 가능으로 보고한다", () => {
    expect(isPersistenceAvailable()).toBe(true);
  });
});
