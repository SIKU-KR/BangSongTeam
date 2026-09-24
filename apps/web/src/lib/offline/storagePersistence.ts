/** 브라우저 영구 저장소 상태 */
export type StoragePersistenceState = "persisted" | "denied" | "unsupported";

function hasStorageManager(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.storage !== "undefined" &&
    navigator.storage !== null
  );
}

/** 브라우저 영구 저장소 권한 요청 */
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
    return "unsupported";
  }
}
