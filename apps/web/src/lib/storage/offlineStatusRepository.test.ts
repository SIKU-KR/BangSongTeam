import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { getOfflineDB, closeOfflineDB } from "./db";
import {
  saveOfflineStatus,
  loadOfflineStatus,
  clearOfflineStatus,
} from "./offlineStatusRepository";

const PRESENTATION_ID = "10000000-0000-4000-8000-000000000001";

describe("offlineStatusRepository", () => {
  beforeEach(async () => {
    const db = await getOfflineDB();
    await db.clear("sync_meta");
  });

  it("기록이 없으면 '준비 안 됨' 기본값을 돌려준다", async () => {
    const status = await loadOfflineStatus(PRESENTATION_ID);

    expect(status).toEqual({
      isReady: false,
      cachedVideos: [],
      cachedAt: 0,
      storagePersisted: false,
    });
  });

  it("캐시 완료 상태를 저장하고 그대로 읽는다", async () => {
    await saveOfflineStatus(PRESENTATION_ID, {
      isReady: true,
      cachedVideos: ["/api/media/loops/a.mp4"],
      cachedAt: 1700000000000,
      storagePersisted: true,
    });

    const status = await loadOfflineStatus(PRESENTATION_ID);

    expect(status.isReady).toBe(true);
    expect(status.cachedVideos).toEqual(["/api/media/loops/a.mp4"]);
    expect(status.storagePersisted).toBe(true);
  });

  it("서버 동기화 필드를 덮어쓰지 않는다", async () => {
    const db = await getOfflineDB();
    await db.put("sync_meta", {
      presentationId: PRESENTATION_ID,
      serverUpdatedAt: "2026-09-22T00:00:00.000Z",
      dirty: true,
      lastSyncedAt: 1699999999999,
    });

    await saveOfflineStatus(PRESENTATION_ID, { isReady: true });

    const record = await db.get("sync_meta", PRESENTATION_ID);
    expect(record?.serverUpdatedAt).toBe("2026-09-22T00:00:00.000Z");
    expect(record?.dirty).toBe(true);
    expect(record?.lastSyncedAt).toBe(1699999999999);
    expect(record?.isReady).toBe(true);
  });

  it("부분 갱신이 앞선 값을 지우지 않는다", async () => {
    await saveOfflineStatus(PRESENTATION_ID, { storagePersisted: true });
    await saveOfflineStatus(PRESENTATION_ID, { isReady: true });

    const status = await loadOfflineStatus(PRESENTATION_ID);

    expect(status.storagePersisted).toBe(true);
    expect(status.isReady).toBe(true);
  });

  it("캐시 상태만 지우고 동기화 필드는 남긴다", async () => {
    const db = await getOfflineDB();
    await db.put("sync_meta", {
      presentationId: PRESENTATION_ID,
      dirty: true,
      isReady: true,
      cachedVideos: ["/api/media/loops/a.mp4"],
    });

    await clearOfflineStatus(PRESENTATION_ID);

    const record = await db.get("sync_meta", PRESENTATION_ID);
    expect(record?.dirty).toBe(true);
    expect(record?.isReady).toBeUndefined();
    expect(record?.cachedVideos).toBeUndefined();
  });

  it("없는 레코드를 지워도 터지지 않는다", async () => {
    await expect(clearOfflineStatus("missing-id")).resolves.toBeUndefined();
  });
});

afterAll(() => {
  closeOfflineDB();
});
