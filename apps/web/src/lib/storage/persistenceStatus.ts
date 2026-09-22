import { useSyncExternalStore } from "react";
import { PersistenceUnavailableError } from "./db";
import type { CorruptedRecord } from "./presentationRepository";

export type PersistenceErrorKind = "unavailable" | "quota" | "unknown";

export interface PersistenceError {
  kind: PersistenceErrorKind;
  message: string;
}

const MESSAGES: Record<PersistenceErrorKind, string> = {
  unavailable:
    "이 브라우저에 저장할 수 없습니다 (시크릿 모드이거나 저장소가 차단되었습니다). 새로고침하면 작업이 사라집니다.",
  quota:
    "저장 공간이 가득 찼습니다. 오래된 프레젠테이션을 정리하지 않으면 작업이 저장되지 않습니다.",
  unknown: "이 브라우저에 저장하지 못했습니다. 작업이 사라질 수 있습니다.",
};

let current: PersistenceError | null = null;

/**
 * 스키마 검증에 실패해 격리된 저장본.
 *
 * 저장 실패(`current`)와 슬롯을 나눈 이유: 격리는 '다음 저장이 성공하면 해소되는
 * 상태'가 아니다. 저장이 다시 잘 되더라도 열지 못한 문서는 그대로 남아 있으므로
 * `clearPersistenceError()`에 휩쓸려 사라지면 안 된다.
 */
const NO_CORRUPTED: readonly CorruptedRecord[] = Object.freeze([]);
let corrupted: readonly CorruptedRecord[] = NO_CORRUPTED;

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function classify(err: unknown): PersistenceErrorKind {
  if (err instanceof PersistenceUnavailableError) return "unavailable";
  if (err instanceof DOMException && err.name === "QuotaExceededError") {
    return "quota";
  }
  if (err instanceof Error && err.name === "QuotaExceededError") return "quota";
  return "unknown";
}

/**
 * 저장 실패를 전역 상태로 올린다.
 *
 * 조용히 삼키지 않는 것이 핵심이다 (TECH_SPEC §5.5 Phase 2 규칙 4).
 * 사용자가 저장된 줄 알고 예배 당일에 잃는 것이 최악의 시나리오다.
 */
export function reportPersistenceError(err: unknown): void {
  const kind = classify(err);
  if (current?.kind === kind) return;
  current = { kind, message: MESSAGES[kind] };
  emit();
}

/** 저장이 다시 성공했을 때 경고를 내린다 */
export function clearPersistenceError(): void {
  if (!current) return;
  current = null;
  emit();
}

export function getPersistenceError(): PersistenceError | null {
  return current;
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

export function getCorruptedRecords(): readonly CorruptedRecord[] {
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
