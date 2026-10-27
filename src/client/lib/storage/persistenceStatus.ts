import { useSyncExternalStore } from "react";
import { discardBrokenConnection, PersistenceUnavailableError } from "./db";
import type { CorruptedRecord } from "./presentationRepository";
import { ERROR_COPY } from "#copy/common";
import { isQuotaExceededError } from "../browser/quotaError";

type PersistenceErrorKind =
  "unavailable" | "blocked" | "outdated" | "quota" | "unknown";

interface PersistenceError {
  kind: PersistenceErrorKind;
  message: string;
}

/** 저장 실패를 따로 세는 저장소: 프레젠테이션·곡 보관함·폴더 스토어와 세션 캐시 */
export type PersistenceStore = "presentation" | "deck" | "folder" | "session";

/**
 * 저장 실패를 남긴 곳. 저장소의 쓰기(`presentation` 등)와 불러오기(`presentation:hydrate` 등)를
 * 따로 둔다.
 *
 * 한 저장소가 저장했다고 다른 저장소가 저장하지 못한 경고를 지우면, 아직 저장하지 못한 작업을
 * 저장된 줄 알게 된다. 쓰기 실패는 그 저장소에 저장하지 못한 항목이 하나도 남지 않을 때 지우고
 * (`createWriteRetry`), 불러오기 실패는 저장소를 다시 불러올 때까지 남긴다. 불러오지 못한
 * 저장소는 그때까지 저장하지 않거나(프레젠테이션), 읽지 못한 저장본을 병합 결과로 덮지 않으려고
 * 부팅 병합을 저장하지 않는다(곡 보관함·폴더).
 */
export type PersistenceSource =
  PersistenceStore | `${PersistenceStore}:hydrate`;

const failures = new Map<PersistenceSource, PersistenceError>();

const NO_CORRUPTED: readonly CorruptedRecord[] = Object.freeze([]);
let corrupted: readonly CorruptedRecord[] = NO_CORRUPTED;

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function classify(err: unknown): PersistenceErrorKind {
  if (err instanceof PersistenceUnavailableError) return err.reason;
  if (isQuotaExceededError(err)) return "quota";
  return "unknown";
}

function latestSource(): PersistenceSource | undefined {
  return [...failures.keys()].at(-1);
}

/**
 * `source`의 저장 실패를 전역 상태로 올린다.
 *
 * 조용히 삼키지 않는 것이 핵심이다.
 * 사용자가 저장된 줄 알고 예배 당일에 잃는 것이 최악의 시나리오다.
 *
 * 연결이 끊겨 난 오류면 그 연결을 버려(`discardBrokenConnection`) 다음 저장이 다시 연다. 같은
 * 종류의 실패를 다시 알려도 같은 객체를 두어, 구독하는 화면이 다시 그리지 않는다.
 */
export function reportPersistenceError(
  err: unknown,
  source: PersistenceSource,
): void {
  discardBrokenConnection(err);
  const kind = classify(err);
  const current = failures.get(source);
  if (current?.kind === kind && latestSource() === source) return;
  failures.delete(source);
  failures.set(
    source,
    current?.kind === kind
      ? current
      : { kind, message: ERROR_COPY.persistence[kind] },
  );
  emit();
}

/** `source`가 남긴 저장 실패만 지우고 다른 곳의 실패는 남긴다 */
export function clearPersistenceError(source: PersistenceSource): void {
  if (!failures.delete(source)) return;
  emit();
}

function belongsTo(
  source: PersistenceSource,
  store: PersistenceStore | undefined,
): boolean {
  return (
    store === undefined || source === store || source === `${store}:hydrate`
  );
}

/**
 * 아직 풀리지 않은 저장 실패 가운데 가장 나중에 알린 것. `store`를 주면 그 저장소의 쓰기와
 * 불러오기 실패만 본다.
 */
export function getPersistenceError(
  store?: PersistenceStore,
): PersistenceError | null {
  const latest = [...failures]
    .reverse()
    .find(([source]) => belongsTo(source, store));
  return latest?.[1] ?? null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 저장 실패를 반응형으로 구독한다 (경고 배너용). `store`는 `getPersistenceError`와 같다 */
export function usePersistenceError(
  store?: PersistenceStore,
): PersistenceError | null {
  const getSnapshot = (): PersistenceError | null => getPersistenceError(store);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * 읽지 못하고 격리한 저장본을 알린다 (삭제하지 않는다).
 *
 * 교체가 아니라 id 기준 누적이다. 프레젠테이션 하이드레이션과 곡 보관함
 * 하이드레이션이 부팅 시 동시에 돌기 때문에, 나중에 끝난 쪽이 먼저 끝난 쪽의
 * 보고를 지워 버리면 안 된다.
 */
export function reportCorruptedRecords(
  records: readonly CorruptedRecord[],
): void {
  if (records.length === 0) return;

  const merged = [...corrupted];
  const seen = new Set(merged.map((record) => record.id));
  for (const record of records) {
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    merged.push(record);
  }
  if (merged.length === corrupted.length) return;

  corrupted = merged;
  emit();
}

function getCorruptedRecords(): readonly CorruptedRecord[] {
  return corrupted;
}

/** 격리된 저장본을 반응형으로 구독한다 (경고 배너용) */
export function useCorruptedRecords(): readonly CorruptedRecord[] {
  return useSyncExternalStore(
    subscribe,
    getCorruptedRecords,
    getCorruptedRecords,
  );
}

/** 테스트 격리용: 모든 저장소의 저장 실패와 격리 알림을 지운다 */
export function __resetPersistenceStatusForTests(): void {
  failures.clear();
  corrupted = NO_CORRUPTED;
  emit();
}
