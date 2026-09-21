import { useSyncExternalStore } from "react";
import { PersistenceUnavailableError } from "./db";

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
