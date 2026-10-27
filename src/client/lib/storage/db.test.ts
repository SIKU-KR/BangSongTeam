import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { forceCloseDatabase } from "fake-indexeddb";
import { openDB, unwrap, type IDBPDatabase } from "idb";
import {
  getOfflineDB,
  isPersistenceAvailable,
  closeOfflineDB,
  BLOCKED_OPEN_TIMEOUT_MS,
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
  OPEN_TIMEOUT_MS,
  PersistenceUnavailableError,
} from "./db";
import {
  clearPersistenceError,
  reportPersistenceError,
} from "./persistenceStatus";

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
    ]);
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
  });

  it("이미 v3인 DB는 다시 열어도 레코드를 지우지 않는다", async () => {
    const first = await getOfflineDB();
    await first.put("auth_session", {
      id: "current",
      userId: "100000000000000000001",
      name: "테스터",
      image: null,
      expiresAt: Date.now() + 60_000,
    });
    closeOfflineDB();

    const reopened = await getOfflineDB();
    expect(await reopened.count("auth_session")).toBe(1);
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

  it("v4 DB를 v5로 올리면 예전 사용자 업로드가 섞인 배경 사본만 비운다", async () => {
    const v4 = await openDB(OFFLINE_DB_NAME, 4, {
      upgrade(db) {
        db.createObjectStore("presentations", { keyPath: "id" });
        db.createObjectStore("decks", { keyPath: "id" });
        db.createObjectStore("folders", { keyPath: "id" });
        db.createObjectStore("backgrounds", { keyPath: "id" });
        db.createObjectStore("auth_session", { keyPath: "id" });
      },
    });
    await v4.put("presentations", { id: "p0000000000000000000a" });
    await v4.put("backgrounds", {
      id: "bg0000000000000000001",
      source: "user",
      cachedFor: "userA0000000000000001",
    });
    v4.close();

    const db = await getOfflineDB();
    expect(db.version).toBe(OFFLINE_DB_VERSION);
    expect(await db.count("backgrounds")).toBe(0);
    expect(await db.count("presentations")).toBe(1);
  });

  describe("연결 수명", () => {
    const STORES = [
      "presentations",
      "decks",
      "folders",
      "backgrounds",
      "auth_session",
    ];
    const otherTabs: IDBPDatabase[] = [];

    async function openOtherTab(version: number): Promise<IDBPDatabase> {
      const db = await openDB(OFFLINE_DB_NAME, version, {
        upgrade(upgrading) {
          for (const name of STORES) {
            if (!upgrading.objectStoreNames.contains(name)) {
              upgrading.createObjectStore(name, { keyPath: "id" });
            }
          }
        },
      });
      otherTabs.push(db);
      return db;
    }

    async function blockedOpenStarted(): Promise<void> {
      await vi.waitFor(() => expect(vi.getTimerCount()).toBe(2));
    }

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
      for (const db of otherTabs.splice(0)) db.close();
      window.history.replaceState({}, "", "/");
      clearPersistenceError();
    });

    it("새 버전을 여는 다른 탭을 막지 않고, 그 뒤에는 이전 버전이라 저장할 수 없다고 알린다", async () => {
      await getOfflineDB();

      await openOtherTab(OFFLINE_DB_VERSION + 1);

      await expect(getOfflineDB()).rejects.toMatchObject({
        name: "PersistenceUnavailableError",
        reason: "outdated",
      });
    });

    it("이전 버전 연결이 닫히지 않으면 기다리다 다른 탭 때문이라고 알리고, 그 탭이 닫히면 늦게 열린 연결을 쓴다", async () => {
      const olderTab = await openOtherTab(OFFLINE_DB_VERSION - 1);
      const opens = vi.spyOn(indexedDB, "open");
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

      const first = getOfflineDB();
      const blocked = expect(first).rejects.toMatchObject({
        name: "PersistenceUnavailableError",
        reason: "blocked",
      });
      await blockedOpenStarted();
      await vi.advanceTimersByTimeAsync(BLOCKED_OPEN_TIMEOUT_MS);
      await blocked;
      await expect(getOfflineDB()).rejects.toMatchObject({ reason: "blocked" });

      olderTab.close();
      vi.useRealTimers();
      const db = await vi.waitFor(() => getOfflineDB());

      expect(db.version).toBe(OFFLINE_DB_VERSION);
      expect(opens).toHaveBeenCalledTimes(1);
    });

    it("송출 화면에서는 기한 없이 기다렸다가 그 탭이 닫히면 연다", async () => {
      window.history.replaceState({}, "", "/present/x/fullscreen");
      const olderTab = await openOtherTab(OFFLINE_DB_VERSION - 1);
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

      let outcome = "pending";
      const opening = getOfflineDB().then(
        () => {
          outcome = "resolved";
        },
        () => {
          outcome = "rejected";
        },
      );
      await blockedOpenStarted();
      await vi.advanceTimersByTimeAsync(
        OPEN_TIMEOUT_MS + BLOCKED_OPEN_TIMEOUT_MS,
      );
      expect(outcome).toBe("pending");

      olderTab.close();
      await opening;

      expect(outcome).toBe("resolved");
    });

    it("브라우저가 연결을 끊으면 다음 호출에서 다시 연다", async () => {
      const first = await getOfflineDB();

      forceCloseDatabase(
        unwrap(first) as unknown as Parameters<typeof forceCloseDatabase>[0],
      );
      const second = await getOfflineDB();

      expect(second).not.toBe(first);
      expect(await second.count("presentations")).toBe(0);
    });

    it("연결이 끊겨 난 오류(InvalidStateError·UnknownError)를 알리면 다음 호출에서 다시 연다", async () => {
      const first = await getOfflineDB();

      reportPersistenceError(new DOMException("", "InvalidStateError"));
      const second = await getOfflineDB();
      reportPersistenceError(new DOMException("", "UnknownError"));
      const third = await getOfflineDB();

      expect(second).not.toBe(first);
      expect(third).not.toBe(second);
      expect(await third.count("presentations")).toBe(0);
    });

    it("연결과 상관없는 오류를 알리면 연결을 그대로 쓴다", async () => {
      const first = await getOfflineDB();

      reportPersistenceError(new DOMException("가득 참", "QuotaExceededError"));

      expect(await getOfflineDB()).toBe(first);
    });
  });
});
