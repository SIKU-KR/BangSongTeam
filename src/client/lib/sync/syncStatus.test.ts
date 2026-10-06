import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
    expect(getSyncSnapshot()).toEqual({
      status: "idle",
      lastFailure: null,
      lastSyncedAt: null,
      failureRequestId: null,
    });
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

  it("프레젠테이션 동기화가 실패한 뒤 폴더 동기화가 성공해도 동기화 실패로 남는다", () => {
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
    expect(getSyncSnapshot()).toMatchObject({
      status: "synced",
      lastFailure: null,
    });
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

  it("항목 없이 도메인이 실패해도 그 요청의 상관 ID를 문의 코드로 남긴다", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    recordSyncFailure(failure({ requestId: "a".repeat(32), failedAt: 500 }));
    setSyncStatus("presentation", "error", "b".repeat(32));

    expect(getSyncSnapshot().failureRequestId).toBe("b".repeat(32));

    vi.setSystemTime(2_000);
    setSyncStatus("presentation", "error", "c".repeat(32));
    expect(getSyncSnapshot().failureRequestId).toBe("c".repeat(32));

    setSyncStatus("presentation", "synced");
    expect(getSyncSnapshot().failureRequestId).toBe("a".repeat(32));
    vi.useRealTimers();
  });

  it("가장 최근 실패에 상관 ID가 없으면 이전 실패의 코드를 보여 주지 않는다", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    recordSyncFailure(failure({ requestId: "a".repeat(32), failedAt: 500 }));
    setSyncStatus("deck", "error");

    expect(getSyncSnapshot().failureRequestId).toBeNull();
    vi.useRealTimers();
  });

  it("초기화하면 모든 도메인이 idle로 돌아간다", () => {
    recordSyncFailure(failure());
    setSyncStatus("deck", "offline");

    resetSyncStatus();

    expect(getSyncSnapshot()).toEqual({
      status: "idle",
      lastFailure: null,
      lastSyncedAt: null,
      failureRequestId: null,
    });
    expect(getSyncDomainStatus("deck")).toBe("idle");
  });

  describe("마지막 동기화 시각", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-06T09:30:00+09:00"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("모든 도메인이 동기화됨에 이르면 그 시각을 남긴다", () => {
      setSyncStatus("presentation", "syncing");
      expect(getSyncSnapshot().lastSyncedAt).toBeNull();

      setSyncStatus("presentation", "synced");

      expect(getSyncSnapshot().lastSyncedAt).toBe(Date.now());
    });

    it("다른 도메인이 실패나 오프라인이면 한 도메인이 성공해도 바꾸지 않는다", () => {
      setSyncStatus("presentation", "synced");
      const syncedAt = getSyncSnapshot().lastSyncedAt;
      vi.advanceTimersByTime(60_000);

      recordSyncFailure(failure({ kind: "folder", id: "F" }));
      setSyncStatus("presentation", "syncing");
      setSyncStatus("presentation", "synced");
      expect(getSyncSnapshot().lastSyncedAt).toBe(syncedAt);

      setSyncStatus("deck", "offline");
      clearSyncFailure("folder", "F");
      setSyncStatus("folder", "synced");
      expect(getSyncSnapshot().lastSyncedAt).toBe(syncedAt);

      setSyncStatus("deck", "synced");
      expect(getSyncSnapshot().lastSyncedAt).toBe(Date.now());
    });

    it("이미 동기화됨인 도메인이 다시 성공을 보고해도 시각을 새로 남긴다", () => {
      setSyncStatus("deck", "synced");
      vi.advanceTimersByTime(60_000);

      setSyncStatus("deck", "synced");

      expect(getSyncSnapshot().lastSyncedAt).toBe(Date.now());
    });

    it("초기화하면 지운다", () => {
      setSyncStatus("presentation", "synced");

      resetSyncStatus();

      expect(getSyncSnapshot().lastSyncedAt).toBeNull();
    });
  });
});
