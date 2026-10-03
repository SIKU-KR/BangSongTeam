import { describe, it, expect, beforeEach } from "vitest";
import {
  setSyncStatus,
  getSyncSnapshot,
  __resetSyncStatusForTests,
} from "./syncStatus";

describe("동기화 상태", () => {
  beforeEach(__resetSyncStatusForTests);

  it("기본 상태는 idle이다", () => {
    expect(getSyncSnapshot().status).toBe("idle");
  });

  it("상태 전이를 반영한다", () => {
    setSyncStatus("syncing");
    expect(getSyncSnapshot().status).toBe("syncing");
    setSyncStatus("synced");
    expect(getSyncSnapshot().status).toBe("synced");
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
    expect(getSyncSnapshot().status).toBe("offline");
    expect(getSyncSnapshot().status).not.toBe("error");
  });

  it("영구 실패 시 실패 정보를 함께 기록하고, synced/idle 전환 시 지운다", () => {
    const failure = {
      id: "doc-1",
      title: "찬양 세트",
      kind: "presentation" as const,
      status: 400,
      message: "잘못된 요청",
      failedAt: Date.now(),
    };
    setSyncStatus("error", failure);
    expect(getSyncSnapshot().status).toBe("error");
    expect(getSyncSnapshot().lastFailure).toEqual(failure);

    setSyncStatus("synced");
    expect(getSyncSnapshot().status).toBe("synced");
    expect(getSyncSnapshot().lastFailure).toBeNull();
  });
});
