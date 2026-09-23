/**
 * 영구 저장소 요청 (PRD 6.1, TECH_SPEC 5.4-3).
 *
 * 브라우저는 디스크가 부족하면 오래된 오리진의 Cache Storage/IndexedDB를 임의로
 * 지운다. 예배 준비에서 20MB짜리 배경을 다 받아 놓고 주일 아침에 비어 있으면
 * 준비를 한 의미가 없다. 그래서 준비 단계에서 영구 저장소를 요청한다.
 *
 * 거부는 예외가 아니라 상태다. Chrome은 사용 이력·설치 여부로 자동 판단하므로
 * 처음 쓰는 사용자는 거부될 수 있다. 준비 화면이 경고로 알린다.
 */

export type StoragePersistenceState = "persisted" | "denied" | "unsupported";

export interface StorageEstimate {
  usageBytes: number;
  quotaBytes: number;
}

function hasStorageManager(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.storage !== "undefined" &&
    navigator.storage !== null
  );
}

/**
 * 영구 저장소를 요청한다. 이미 영구 상태면 다시 요청하지 않는다.
 *
 * `persist()`는 사용자 제스처 안에서 불러야 승인 확률이 높으므로, 준비 화면의
 * 버튼 클릭 흐름에서 호출한다.
 */
export async function requestPersistentStorage(): Promise<StoragePersistenceState> {
  if (!hasStorageManager() || typeof navigator.storage.persist !== "function") {
    return "unsupported";
  }

  try {
    if (typeof navigator.storage.persisted === "function") {
      const already = await navigator.storage.persisted();
      if (already) return "persisted";
    }
    const granted = await navigator.storage.persist();
    return granted ? "persisted" : "denied";
  } catch {
    // 권한 요청 자체가 실패하는 환경(시크릿 모드 등)은 미지원과 같이 다룬다.
    return "unsupported";
  }
}

/** 현재 영구 저장소 상태만 확인한다 (요청하지 않는다) */
export async function checkPersistentStorage(): Promise<StoragePersistenceState> {
  if (
    !hasStorageManager() ||
    typeof navigator.storage.persisted !== "function"
  ) {
    return "unsupported";
  }
  try {
    return (await navigator.storage.persisted()) ? "persisted" : "denied";
  } catch {
    return "unsupported";
  }
}

/** 저장소 사용량·할당량 (준비 화면의 용량 표시용) */
export async function estimateStorageUsage(): Promise<StorageEstimate | null> {
  if (
    !hasStorageManager() ||
    typeof navigator.storage.estimate !== "function"
  ) {
    return null;
  }
  try {
    const estimate = await navigator.storage.estimate();
    return {
      usageBytes: estimate.usage ?? 0,
      quotaBytes: estimate.quota ?? 0,
    };
  } catch {
    return null;
  }
}
