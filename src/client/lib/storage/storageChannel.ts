import {
  StorageChangeSchema,
  type StorageChange,
  type StorageChangeKind,
} from "#shared";
import { getCurrentUserId } from "../auth/sessionStore";
import { createBroadcast, type Broadcast } from "../browser/broadcast";

const STORAGE_CHANNEL = "chiton:storage";

let channel: Broadcast<StorageChange> | null = null;

function storageChannel(): Broadcast<StorageChange> {
  channel ??= createBroadcast(STORAGE_CHANNEL, StorageChangeSchema);
  return channel;
}

/**
 * 이 탭이 IndexedDB에 쓰거나 지운 저장본의 id를 같은 브라우저의 다른 탭에 알린다. 받은 탭은 그
 * 저장본을 다시 읽어, 낡은 메모리 사본으로 이 탭의 쓰기를 덮거나 서버에 올리지 않는다.
 *
 * 지금 사용자 id를 붙여 다른 계정의 탭이 따르지 않게 한다. 로그인하지 않았거나 id가 없으면 보내지
 * 않는다. 알리기와 받기는 탭마다 채널 하나를 함께 쓴다. 따로 열면 이 탭이 방금 쓴 저장본을 다시
 * 읽어 되돌리기 기록을 잃는다. `BroadcastChannel`이 없는 브라우저(Safari 15.4 전)에서는 아무것도
 * 하지 않고, 탭끼리 맞추지 않던 때처럼 동작한다.
 */
export function announceStorageChange(
  kind: StorageChangeKind,
  ids: readonly string[],
): void {
  const userId = getCurrentUserId();
  if (!userId || ids.length === 0) return;
  storageChannel().post({ v: 1, userId, kind, ids: [...new Set(ids)] });
}

/**
 * 다른 탭이 알린 저장본 변화를 받는다. 형식이 맞지 않거나 모르는 판의 메시지는 버리고, 사용자
 * id는 받는 쪽이 자기 사용자와 견준다. 구독을 푸는 함수를 돌려준다.
 */
export function subscribeStorageChanges(
  listener: (change: StorageChange) => void,
): () => void {
  return storageChannel().subscribe(listener);
}

export function __resetStorageChannelForTests(): void {
  channel?.close();
  channel = null;
}
