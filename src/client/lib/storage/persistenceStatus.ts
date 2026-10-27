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

/**
 * 저장 실패를 남긴 곳. 세 스토어(프레젠테이션·곡 보관함·폴더)는 한 자리(`stores`)를 함께 쓰고,
 * 세션 캐시(`session`)는 따로 둔다. 세션 캐시를 다시 저장했다고 스토어가 저장하지 못한 경고를
 * 지우면 작업을 잃을 수 있고, 스토어가 저장했다고 세션 캐시를 읽지 못한 경고를 지우면 로그인
 * 화면에서 까닭을 알 수 없다.
 */
export type PersistenceSource = "stores" | "session";

const failures: Record<PersistenceSource, PersistenceError | null> = {
  stores: null,
  session: null,
};

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

/**
 * 저장 실패를 전역 상태로 올린다.
 *
 * 조용히 삼키지 않는 것이 핵심이다.
 * 사용자가 저장된 줄 알고 예배 당일에 잃는 것이 최악의 시나리오다.
 *
 * 연결이 끊겨 난 오류면 그 연결을 버려(`discardBrokenConnection`) 다음 저장이 다시 연다.
 */
export function reportPersistenceError(
  err: unknown,
  source: PersistenceSource = "stores",
): void {
  discardBrokenConnection(err);
  const kind = classify(err);
  if (failures[source]?.kind === kind) return;
  failures[source] = { kind, message: ERROR_COPY.persistence[kind] };
  emit();
}

/** `source`가 남긴 저장 실패만 지우고 다른 곳의 실패는 남긴다 */
export function clearPersistenceError(
  source: PersistenceSource = "stores",
): void {
  if (!failures[source]) return;
  failures[source] = null;
  emit();
}

/** 스토어의 저장 실패를 세션 캐시의 실패보다 먼저 보인다. 스토어의 실패는 작업을 잃을 수 있다 */
export function getPersistenceError(): PersistenceError | null {
  return failures.stores ?? failures.session;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 저장 실패 여부를 반응형으로 구독한다 (경고 배너용) */
export function usePersistenceError(): PersistenceError | null {
  return useSyncExternalStore(
    subscribe,
    getPersistenceError,
    getPersistenceError,
  );
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

export function clearCorruptedRecords(): void {
  if (corrupted.length === 0) return;
  corrupted = NO_CORRUPTED;
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
