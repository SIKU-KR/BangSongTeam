import { useSyncExternalStore } from "react";

/**
 * 서버 동기화 상태.
 *
 * `persistenceStatus`(로컬 저장 실패)와 슬롯을 나눈다. 로컬 저장 실패는
 * 작업이 사라질 수 있다는 경고지만, 오프라인은 정상 동작이다. 둘을 한 곳에
 * 담으면 예배 중에 빨간 배너가 뜬다.
 */
export type SyncStatus = "idle" | "syncing" | "synced" | "offline" | "error";

export interface SyncFailure {
  id: string;
  title?: string;
  kind?: "presentation" | "folder" | "deck";
  status?: number;
  message: string;
  failedAt: number;
}

export interface SyncSnapshot {
  status: SyncStatus;
  lastFailure: SyncFailure | null;
}

let status: SyncStatus = "idle";
let lastFailure: SyncFailure | null = null;
const listeners = new Set<() => void>();

let snapshot: SyncSnapshot = { status, lastFailure };

function emit(): void {
  snapshot = { status, lastFailure };
  for (const listener of listeners) listener();
}

export function setSyncStatus(
  next: SyncStatus,
  failure?: SyncFailure | null,
): void {
  const nextFailure =
    failure !== undefined
      ? failure
      : next === "synced" || next === "idle"
        ? null
        : lastFailure;
  if (status === next && lastFailure === nextFailure) return;
  status = next;
  lastFailure = nextFailure;
  emit();
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

export function __resetSyncStatusForTests(): void {
  status = "idle";
  lastFailure = null;
  emit();
}
