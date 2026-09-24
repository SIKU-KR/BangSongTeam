import { describe, it, expect, beforeEach } from "vitest";
import {
  setSyncStatus,
  getSyncStatus,
  getSyncSnapshot,
  __resetSyncStatusForTests,
} from "./syncStatus";

describe("동기화 상태", () => {
  beforeEach(__resetSyncStatusForTests);

  it("기본 상태는 idle이다", () => {
    expect(getSyncStatus()).toBe("idle");
  });

  it("상태 전이를 반영한다", () => {
    setSyncStatus("syncing");
    expect(getSyncStatus()).toBe("syncing");
    setSyncStatus("synced");
    expect(getSyncStatus()).toBe("synced");
  });

  it("동기화 성공 시각을 기록한다", () => {
    expect(getSyncSnapshot().lastSyncedAt).toBeNull();
    setSyncStatus("synced");
    expect(getSyncSnapshot().lastSyncedAt).toBeGreaterThan(0);
  });

  it("스냅샷은 상태가 바뀔 때만 새로 만든다 (useSyncExternalStore 요구사항)", () => {
    const first = getSyncSnapshot();
    setSyncStatus("idle");
    expect(getSyncSnapshot()).toBe(first);

    setSyncStatus("offline");
    expect(getSyncSnapshot()).not.toBe(first);
  });

  it("오프라인은 error와 구분된다", () => {
    setSyncStatus("offline");
    expect(getSyncStatus()).toBe("offline");
    expect(getSyncStatus()).not.toBe("error");
  });
});
