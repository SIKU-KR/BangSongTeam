import { useSyncExternalStore } from "react";

/**
 * 서버 동기화 상태.
 *
 * `persistenceStatus`(로컬 저장 실패)와 슬롯을 나눈다. 로컬 저장 실패는
 * 작업이 사라질 수 있다는 경고지만, 오프라인은 정상 동작이다. 둘을 한 곳에
 * 담으면 예배 중에 빨간 배너가 뜬다.
 */
export type SyncStatus = "idle" | "syncing" | "synced" | "offline" | "error";

/**
 * 동기화 상태를 따로 보고하는 곳. 세트·폴더·보관함 곡은 각자 다른 시점에
 * 서버와 통신하므로, 한 큐의 결과가 다른 큐의 결과를 덮지 않도록 나눠 담는다.
 * 공유받은 세트 새로고침(`shared`)도 세트 push 큐와 나눈다. 같이 두면 새로고침
 * 한 번의 성공이 오프라인으로 밀려 있는 세트 push를 가린다.
 */
export type SyncDomain = "presentation" | "folder" | "deck" | "shared";

export interface SyncFailure {
  id: string;
  title?: string;
  kind: SyncDomain;
  status?: number;
  message: string;
  failedAt: number;
}

export interface SyncSnapshot {
  status: SyncStatus;
  lastFailure: SyncFailure | null;
}

interface DomainState {
  phase: SyncStatus;
  failures: Map<string, SyncFailure>;
}

const PRIORITY: readonly SyncStatus[] = [
  "error",
  "offline",
  "syncing",
  "synced",
];

function idleDomain(): DomainState {
  return { phase: "idle", failures: new Map() };
}

function createDomains(): Record<SyncDomain, DomainState> {
  return {
    presentation: idleDomain(),
    folder: idleDomain(),
    deck: idleDomain(),
    shared: idleDomain(),
  };
}

let domains = createDomains();
const listeners = new Set<() => void>();
let snapshot: SyncSnapshot = { status: "idle", lastFailure: null };

function aggregateStatus(): SyncStatus {
  const effective = Object.values(domains).map((state) =>
    state.failures.size > 0 ? "error" : state.phase,
  );
  return PRIORITY.find((status) => effective.includes(status)) ?? "idle";
}

function latestFailure(): SyncFailure | null {
  let latest: SyncFailure | null = null;
  for (const state of Object.values(domains)) {
    for (const failure of state.failures.values()) {
      if (!latest || failure.failedAt >= latest.failedAt) latest = failure;
    }
  }
  return latest;
}

function emit(): void {
  const status = aggregateStatus();
  const lastFailure = latestFailure();
  if (snapshot.status === status && snapshot.lastFailure === lastFailure) {
    return;
  }
  snapshot = { status, lastFailure };
  for (const listener of listeners) listener();
}

/**
 * 한 도메인의 진행 단계를 바꾼다. 헤더는 모든 도메인을 우선순위
 * (error > offline > syncing > synced > idle)로 모아 보여 준다.
 *
 * 폴더가 'synced'를 보고해도 세트의 'error'·'offline'은 그대로 남는다.
 * 한 큐의 성공이 다른 큐의 실패를 덮으면 세트 저장이 실패했는데도 헤더가
 * '동기화됨'으로 바뀌어, 사용자는 저장된 줄 알고 기기를 끈다.
 */
export function setSyncStatus(domain: SyncDomain, next: SyncStatus): void {
  const state = domains[domain];
  if (state.phase === next) return;
  state.phase = next;
  emit();
}

/**
 * 항목 1건의 영구 실패를 남긴다. 같은 도메인의 다른 항목이 성공해도 지워지지 않고,
 * 그 항목이 다시 올라가거나 취소·삭제될 때(`clearSyncFailure`)만 지운다.
 * 서버에 실제로 없는 항목이 남아 있는 한 헤더는 실패를 보여 줘야 한다.
 */
export function recordSyncFailure(failure: SyncFailure): void {
  domains[failure.kind].failures.set(failure.id, failure);
  emit();
}

/** 항목이 성공했거나 더는 올릴 필요가 없을 때 그 항목의 실패 기록을 지운다 */
export function clearSyncFailure(domain: SyncDomain, id: string): void {
  if (!domains[domain].failures.delete(id)) return;
  emit();
}

/**
 * 도메인이 마지막으로 보고한 진행 단계 (항목 실패는 섞지 않는다).
 * 큐가 '아직 syncing이면 synced로' 같은 판단을 할 때 다른 도메인 상태가 끼어들지
 * 않게 하려고 쓴다.
 */
export function getSyncDomainStatus(domain: SyncDomain): SyncStatus {
  return domains[domain].phase;
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

/**
 * 모든 도메인을 처음 상태로 되돌린다. 부팅 동기화가 큐를 켜기 전에 부른다.
 * 새로고침 없이 계정을 바꿨을 때 앞 사용자의 실패 기록이 남으면 안 된다.
 */
export function resetSyncStatus(): void {
  domains = createDomains();
  emit();
}
