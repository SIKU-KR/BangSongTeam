import { useSyncExternalStore } from "react";

/**
 * 서버 동기화 상태.
 *
 * `persistenceStatus`(로컬 저장 실패)와 슬롯을 나눈다. 로컬 저장 실패는
 * 작업이 사라질 수 있다는 경고지만, 오프라인은 정상 동작이다. 둘을 한 곳에
 * 담으면 예배 중에 빨간 배너가 뜬다.
 */
export type SyncStatus =
  | "idle"
  | "syncing"
  | "synced"
  /** 네트워크에 닿지 못함 — 실패가 아니라 정상 경로다 */
  | "offline"
  /** 서버가 거절함 (권한·검증 실패 등) */
  | "error";

let status: SyncStatus = "idle";
let lastSyncedAt: number | null = null;
const listeners = new Set<() => void>();

interface SyncSnapshot {
  status: SyncStatus;
  lastSyncedAt: number | null;
}

let snapshot: SyncSnapshot = { status, lastSyncedAt };

function emit(): void {
  snapshot = { status, lastSyncedAt };
  for (const listener of listeners) listener();
}

export function setSyncStatus(next: SyncStatus): void {
  if (status === next) return;
  status = next;
  if (next === "synced") lastSyncedAt = Date.now();
  emit();
}

export function getSyncStatus(): SyncStatus {
  return status;
}

export function getSyncSnapshot(): SyncSnapshot {
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 동기화 상태를 반응형으로 구독한다 (에디터 헤더 표시용) */
export function useSyncStatus(): SyncSnapshot {
  return useSyncExternalStore(subscribe, getSyncSnapshot, getSyncSnapshot);
}

/** 테스트 전용 */
export function __resetSyncStatusForTests(): void {
  status = "idle";
  lastSyncedAt = null;
  emit();
}
