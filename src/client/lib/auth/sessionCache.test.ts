import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { closeOfflineDB, OFFLINE_DB_NAME } from "../storage/db";
import {
  saveCachedSession,
  loadCachedSession,
  clearCachedSession,
  clearPendingSignOut,
  hasPendingSignOut,
  markSignOutPending,
  rememberSessionEnd,
  takeSessionEnd,
} from "./sessionCache";

const HOUR = 60 * 60 * 1000;

async function resetDatabase(): Promise<void> {
  closeOfflineDB();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(OFFLINE_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

describe("오프라인 세션 캐시", () => {
  beforeEach(resetDatabase);
  afterEach(closeOfflineDB);

  it("저장한 세션을 그대로 되읽는다", async () => {
    await saveCachedSession({
      userId: "8f14e45fc1a2b3c4d5e6f",
      name: "봉사자",
      image: "https://img.example.com/a.png",
      expiresAt: Date.now() + HOUR,
    });

    const cached = await loadCachedSession();
    expect(cached?.userId).toBe("8f14e45fc1a2b3c4d5e6f");
    expect(cached?.name).toBe("봉사자");
    expect(cached?.image).toBe("https://img.example.com/a.png");
  });

  it("캐시가 없으면 null이다 (에러 아님)", async () => {
    expect(await loadCachedSession()).toBeNull();
  });

  it("만료된 세션도 지우지 않고 돌려준다", async () => {
    const expiresAt = Date.now() - 1000;
    await saveCachedSession({
      userId: "8f14e45fc1a2b3c4d5e6f",
      name: "봉사자",
      expiresAt,
    });

    expect((await loadCachedSession())?.expiresAt).toBe(expiresAt);
    expect((await loadCachedSession())?.userId).toBe("8f14e45fc1a2b3c4d5e6f");
  });

  it("단일 레코드만 유지한다 (계정을 바꿔도 하나)", async () => {
    await saveCachedSession({
      userId: "aaaaaaaac1a2b3c4d5e6f",
      name: "A",
      expiresAt: Date.now() + HOUR,
    });
    await saveCachedSession({
      userId: "bbbbbbbbc1a2b3c4d5e6f",
      name: "B",
      expiresAt: Date.now() + HOUR,
    });

    expect((await loadCachedSession())?.userId).toBe("bbbbbbbbc1a2b3c4d5e6f");
  });

  it("로그아웃하면 캐시를 비운다", async () => {
    await saveCachedSession({
      userId: "8f14e45fc1a2b3c4d5e6f",
      name: "봉사자",
      expiresAt: Date.now() + HOUR,
    });

    await clearCachedSession();
    expect(await loadCachedSession()).toBeNull();
  });

  it("캐시가 비어 있을 때 지워도 던지지 않는다", async () => {
    await expect(clearCachedSession()).resolves.toBeUndefined();
  });
});

describe("서버가 확인하지 않은 로그아웃 표시", () => {
  const PENDING_KEY = "chiton:sign-out-pending";

  function storageBlocked(): never {
    throw new DOMException("blocked", "SecurityError");
  }

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("남기고 읽고 지운다", () => {
    expect(hasPendingSignOut()).toBe(false);

    expect(markSignOutPending()).toBe(true);
    expect(hasPendingSignOut()).toBe(true);
    expect(Number(window.localStorage.getItem(PENDING_KEY))).toBeGreaterThan(0);

    clearPendingSignOut();
    expect(hasPendingSignOut()).toBe(false);
  });

  it("다른 탭이 남긴 표시도 읽는다", () => {
    window.localStorage.setItem(PENDING_KEY, "1761523200000");

    expect(hasPendingSignOut()).toBe(true);
  });

  it("저장소에 쓸 수 없으면 남기지 못했다고 돌려주고 던지지 않는다", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(storageBlocked);

    expect(markSignOutPending()).toBe(false);
    expect(hasPendingSignOut()).toBe(false);
  });

  it("저장소를 읽거나 지울 수 없어도 던지지 않는다", () => {
    window.localStorage.setItem(PENDING_KEY, "1");
    vi.spyOn(window.localStorage, "getItem").mockImplementation(storageBlocked);
    vi.spyOn(window.localStorage, "removeItem").mockImplementation(
      storageBlocked,
    );

    expect(hasPendingSignOut()).toBe(false);
    expect(() => clearPendingSignOut()).not.toThrow();
  });
});

describe("계정이 끝난 이유", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
  });

  it("남긴 이유를 한 번만 돌려주고 지운다", () => {
    rememberSessionEnd("switched");

    expect(takeSessionEnd()).toBe("switched");
    expect(takeSessionEnd()).toBeNull();
  });

  it("모르는 값은 보통 부팅으로 보고 지운다", () => {
    window.sessionStorage.setItem("chiton:session-end", "kicked");

    expect(takeSessionEnd()).toBeNull();
    expect(window.sessionStorage.getItem("chiton:session-end")).toBeNull();
  });

  it("sessionStorage를 쓸 수 없어도 던지지 않는다", () => {
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(() => rememberSessionEnd("expired")).not.toThrow();
    expect(takeSessionEnd()).toBeNull();
  });
});
