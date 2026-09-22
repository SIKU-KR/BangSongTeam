import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { closeOfflineDB, OFFLINE_DB_NAME } from "../storage";
import {
  saveCachedSession,
  loadCachedSession,
  clearCachedSession,
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
      userId: "8f14e45f-ceea-4e0a-9f2b-1a2b3c4d5e6f",
      name: "봉사자",
      image: "https://img.example.com/a.png",
      expiresAt: Date.now() + HOUR,
    });

    const cached = await loadCachedSession();
    expect(cached?.userId).toBe("8f14e45f-ceea-4e0a-9f2b-1a2b3c4d5e6f");
    expect(cached?.name).toBe("봉사자");
    expect(cached?.image).toBe("https://img.example.com/a.png");
  });

  it("캐시가 없으면 null이다 (에러 아님)", async () => {
    expect(await loadCachedSession()).toBeNull();
  });

  it("만료된 세션은 통과시키지 않고 지운다", async () => {
    // 만료된 세션으로 게이트를 열면 화면은 로그인 상태인데 서버 요청마다
    // 401이 나는 어정쩡한 상태가 된다.
    await saveCachedSession({
      userId: "8f14e45f-ceea-4e0a-9f2b-1a2b3c4d5e6f",
      name: "봉사자",
      expiresAt: Date.now() - 1000,
    });

    expect(await loadCachedSession()).toBeNull();
    expect(await loadCachedSession()).toBeNull();
  });

  it("단일 레코드만 유지한다 (계정을 바꿔도 하나)", async () => {
    await saveCachedSession({
      userId: "aaaaaaaa-ceea-4e0a-9f2b-1a2b3c4d5e6f",
      name: "A",
      expiresAt: Date.now() + HOUR,
    });
    await saveCachedSession({
      userId: "bbbbbbbb-ceea-4e0a-9f2b-1a2b3c4d5e6f",
      name: "B",
      expiresAt: Date.now() + HOUR,
    });

    expect((await loadCachedSession())?.userId).toBe(
      "bbbbbbbb-ceea-4e0a-9f2b-1a2b3c4d5e6f",
    );
  });

  it("로그아웃하면 캐시를 비운다", async () => {
    await saveCachedSession({
      userId: "8f14e45f-ceea-4e0a-9f2b-1a2b3c4d5e6f",
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
