/**
 * 영구 저장소 요청 (PRD 6.1, TECH_SPEC 5.4-3).
 *
 * 브라우저는 디스크가 부족하면 오래된 오리진의 Cache Storage/IndexedDB를 임의로
 * 지운다. 편집·송출 중에 조용히 받아 둔 배경이 주일 아침에 비어 있지 않도록,
 * 백그라운드 캐시를 처음 시작할 때 영구 저장소를 요청한다.
 *
 * 거부는 예외가 아니라 상태다. Chrome은 사용 이력·설치 여부로 자동 판단하므로
 * 처음 쓰는 사용자는 거부될 수 있다. 거부돼도 캐시는 그대로 담는다.
 */

export type StoragePersistenceState = "persisted" | "denied" | "unsupported";

function hasStorageManager(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.storage !== "undefined" &&
    navigator.storage !== null
  );
}

/** 영구 저장소를 요청한다. 이미 영구 상태면 다시 요청하지 않는다. */
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
