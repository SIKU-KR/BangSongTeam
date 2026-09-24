import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { openDB } from "idb";
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
      "auth_session",
      "backgrounds",
      "decks",
      "folders",
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

  it("v2(UUID 시절) DB를 열면 모든 스토어를 비운다 (v3 NanoID 전환)", async () => {
    const legacy = await openDB(OFFLINE_DB_NAME, 2, {
      upgrade(db) {
        db.createObjectStore("presentations", { keyPath: "id" }).createIndex(
          "by-date",
          "serviceDate",
        );
        db.createObjectStore("decks", { keyPath: "id" });
        db.createObjectStore("backgrounds", { keyPath: "id" });
        db.createObjectStore("sync_meta", { keyPath: "presentationId" });
        db.createObjectStore("auth_session", { keyPath: "id" });
      },
    });
    const legacyId = "10000000-0000-4000-8000-000000000001";
    await legacy.put("presentations", {
      id: legacyId,
      serviceDate: "2026-09-27",
    });
    await legacy.put("decks", { id: "c0000000-0000-4000-8000-000000000001" });
    await legacy.put("backgrounds", {
      id: "b0000000-0000-0000-0000-000000000001",
    });
    await legacy.put("sync_meta", { presentationId: legacyId, dirty: true });
    await legacy.put("auth_session", {
      id: "current",
      userId: "8f14e45f-ceea-4e0a-9f2b-1a2b3c4d5e6f",
    });
    legacy.close();

    const db = await getOfflineDB();

    expect(db.version).toBe(OFFLINE_DB_VERSION);
    for (const name of db.objectStoreNames) {
      expect(await db.count(name), `${name}가 비어 있어야 한다`).toBe(0);
    }
    expect(db.transaction("presentations").store.indexNames).toContain(
      "by-date",
    );
  });

  it("이미 v3인 DB는 다시 열어도 레코드를 지우지 않는다", async () => {
    const first = await getOfflineDB();
    await first.put("sync_meta", { presentationId: "100000000000000000001" });
    closeOfflineDB();

    const reopened = await getOfflineDB();
    expect(await reopened.count("sync_meta")).toBe(1);
  });

  it("v3(NanoID) DB를 v4로 올리면 레코드를 지우지 않고 folders 스토어만 더한다", async () => {
    const v3 = await openDB(OFFLINE_DB_NAME, 3, {
      upgrade(db) {
        db.createObjectStore("presentations", { keyPath: "id" }).createIndex(
          "by-date",
          "serviceDate",
        );
        db.createObjectStore("decks", { keyPath: "id" });
        db.createObjectStore("backgrounds", { keyPath: "id" });
        db.createObjectStore("sync_meta", { keyPath: "presentationId" });
        db.createObjectStore("auth_session", { keyPath: "id" });
      },
    });
    await v3.put("presentations", {
      id: "p0000000000000000000a",
      serviceDate: "2026-09-27",
    });
    v3.close();

    const db = await getOfflineDB();
    expect(db.version).toBe(OFFLINE_DB_VERSION);
    expect([...db.objectStoreNames]).toContain("folders");
    expect(await db.count("presentations")).toBe(1);
  });
});
