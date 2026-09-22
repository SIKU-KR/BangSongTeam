import { getOfflineDB, type WorshipOfflineDB } from "./db";

type SyncMetaRecord = WorshipOfflineDB["sync_meta"]["value"];

/** 예배 준비 단계가 기록하는 오프라인 캐시 상태 (TECH_SPEC §5.4-4) */
export interface OfflineStatus {
  /** 세트의 모든 배경 자산이 캐시에 들어갔는지 */
  isReady: boolean;
  /** 캐시에 담긴 미디어 URL 목록 */
  cachedVideos: string[];
  /** 마지막으로 캐시를 채운 시각 (epoch ms) */
  cachedAt: number;
  /** navigator.storage.persist() 성공 여부 */
  storagePersisted: boolean;
}

export type OfflineStatusPatch = Partial<OfflineStatus>;

const EMPTY: OfflineStatus = {
  isReady: false,
  cachedVideos: [],
  cachedAt: 0,
  storagePersisted: false,
};

function toStatus(record: SyncMetaRecord | undefined): OfflineStatus {
  if (!record) return EMPTY;
  return {
    isReady: record.isReady ?? false,
    cachedVideos: record.cachedVideos ?? [],
    cachedAt: record.cachedAt ?? 0,
    storagePersisted: record.storagePersisted ?? false,
  };
}

/**
 * 오프라인 캐시 상태를 기록한다.
 *
 * **반드시 병합이다.** `sync_meta`의 같은 레코드에 M3-B의 서버 동기화 필드
 * (`serverUpdatedAt`·`dirty`·`lastSyncedAt`)가 함께 들어 있다. 통째로 put하면
 * 예배 준비를 한 번 돌린 것만으로 그 세트의 동기화 메타데이터가 날아간다.
 */
export async function saveOfflineStatus(
  presentationId: string,
  patch: OfflineStatusPatch,
): Promise<void> {
  const db = await getOfflineDB();
  const tx = db.transaction("sync_meta", "readwrite");
  const store = tx.objectStore("sync_meta");
  const existing = await store.get(presentationId);

  await store.put({
    ...existing,
    presentationId,
    ...patch,
  });
  await tx.done;
}

/** 저장된 오프라인 캐시 상태를 읽는다. 기록이 없으면 '준비 안 됨'이다. */
export async function loadOfflineStatus(
  presentationId: string,
): Promise<OfflineStatus> {
  const db = await getOfflineDB();
  const record = await db.get("sync_meta", presentationId);
  return toStatus(record);
}

/**
 * 오프라인 캐시 상태만 지운다 (동기화 필드는 남긴다).
 * 세트의 배경이 바뀌어 캐시가 더 이상 유효하지 않을 때 쓴다.
 */
export async function clearOfflineStatus(
  presentationId: string,
): Promise<void> {
  const db = await getOfflineDB();
  const tx = db.transaction("sync_meta", "readwrite");
  const store = tx.objectStore("sync_meta");
  const existing = await store.get(presentationId);
  if (!existing) {
    await tx.done;
    return;
  }

  // 캐시 필드만 떨어뜨리고 동기화 필드는 그대로 옮긴다.
  await store.put({
    presentationId,
    serverUpdatedAt: existing.serverUpdatedAt,
    dirty: existing.dirty,
    lastSyncedAt: existing.lastSyncedAt,
  });
  await tx.done;
}
