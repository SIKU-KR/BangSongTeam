import { describe, it, expect, beforeEach } from "vitest";
import {
  setSyncStatus,
  recordSyncFailure,
  clearSyncFailure,
  getSyncDomainStatus,
  getSyncSnapshot,
  resetSyncStatus,
  type SyncFailure,
} from "./syncStatus";

function failure(overrides: Partial<SyncFailure> = {}): SyncFailure {
  return {
    id: "doc-1",
    title: "찬양 세트",
    kind: "presentation",
    status: 400,
    message: "잘못된 요청",
    failedAt: 1_000,
    ...overrides,
  };
}

describe("동기화 상태", () => {
  beforeEach(resetSyncStatus);

  it("기본 상태는 idle이고 실패 정보가 없다", () => {
    expect(getSyncSnapshot()).toEqual({ status: "idle", lastFailure: null });
  });

  it("상태 전이를 반영한다", () => {
    setSyncStatus("presentation", "syncing");
    expect(getSyncSnapshot().status).toBe("syncing");
    setSyncStatus("presentation", "synced");
    expect(getSyncSnapshot().status).toBe("synced");
  });

  it("스냅샷은 종합 상태가 바뀔 때만 새로 만든다 (useSyncExternalStore 요구사항)", () => {
    const first = getSyncSnapshot();
    setSyncStatus("presentation", "idle");
    expect(getSyncSnapshot()).toBe(first);

    setSyncStatus("folder", "offline");
    const offline = getSyncSnapshot();
    expect(offline).not.toBe(first);

    setSyncStatus("deck", "synced");
    expect(getSyncSnapshot()).toBe(offline);
  });

  it("오프라인은 error와 구분된다", () => {
    setSyncStatus("presentation", "offline");
    expect(getSyncSnapshot().status).toBe("offline");
  });

  it("세트 동기화가 실패한 뒤 폴더 동기화가 성공해도 동기화 실패로 남는다", () => {
    recordSyncFailure(failure());
    setSyncStatus("folder", "syncing");
    setSyncStatus("folder", "synced");

    expect(getSyncSnapshot().status).toBe("error");
    expect(getSyncSnapshot().lastFailure?.kind).toBe("presentation");
  });

  it("우선순위는 error > offline > syncing > synced 순이다", () => {
    setSyncStatus("presentation", "offline");
    setSyncStatus("deck", "synced");
    expect(getSyncSnapshot().status).toBe("offline");

    setSyncStatus("presentation", "synced");
    setSyncStatus("folder", "synced");
    setSyncStatus("deck", "syncing");
    expect(getSyncSnapshot().status).toBe("syncing");

    setSyncStatus("folder", "offline");
    expect(getSyncSnapshot().status).toBe("offline");

    setSyncStatus("folder", "synced");
    setSyncStatus("deck", "error");
    expect(getSyncSnapshot().status).toBe("error");
  });

  it("같은 도메인의 다른 성공은 항목 실패를 지우지 않고, 그 항목이 성공해야 지운다", () => {
    recordSyncFailure(failure({ id: "A" }));
    setSyncStatus("presentation", "synced");
    expect(getSyncSnapshot().status).toBe("error");
    expect(getSyncDomainStatus("presentation")).toBe("synced");

    clearSyncFailure("presentation", "A");
    expect(getSyncSnapshot()).toEqual({ status: "synced", lastFailure: null });
  });

  it("없는 실패를 지워도 스냅샷은 그대로다", () => {
    const first = getSyncSnapshot();
    clearSyncFailure("deck", "none");
    expect(getSyncSnapshot()).toBe(first);
  });

  it("lastFailure는 모든 도메인에서 가장 최근 실패다", () => {
    const older = failure({ id: "A", failedAt: 1_000 });
    const newer = failure({ id: "F", kind: "folder", failedAt: 2_000 });
    recordSyncFailure(newer);
    recordSyncFailure(older);
    expect(getSyncSnapshot().lastFailure).toEqual(newer);

    clearSyncFailure("folder", "F");
    expect(getSyncSnapshot().lastFailure).toEqual(older);
  });

  it("초기화하면 모든 도메인이 idle로 돌아간다", () => {
    recordSyncFailure(failure());
    setSyncStatus("deck", "offline");

    resetSyncStatus();

    expect(getSyncSnapshot()).toEqual({ status: "idle", lastFailure: null });
    expect(getSyncDomainStatus("deck")).toBe("idle");
  });
});
