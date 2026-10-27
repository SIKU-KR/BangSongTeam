import { IdSchema } from "#shared";

function storageKey(userId: string): string {
  return `pending-deck-deletes:${userId}`;
}

function readIds(userId: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => IdSchema.safeParse(id).success);
  } catch {
    return [];
  }
}

function writeIds(userId: string, ids: readonly string[]): void {
  try {
    if (ids.length === 0) localStorage.removeItem(storageKey(userId));
    else localStorage.setItem(storageKey(userId), JSON.stringify(ids));
  } catch {
    return;
  }
}

/**
 * 지우고 서버가 아직 지운 곡으로 답하지 않은 보관함 곡을 사용자별로 남긴다. 곡 큐의 DELETE는
 * 메모리에만 있어, 오프라인에서 지우거나 2초 디바운스 안에 탭을 닫으면 사라지고 다음 부팅
 * 병합이 서버의 곡을 되살린다.
 *
 * `localStorage`에 둔다. 동기로 써지므로 지운 직후 탭을 닫아도 남고, IndexedDB 버전을 올리지
 * 않아도 된다(버전을 올리면 옛 버전을 연 탭이 있는 동안 새 탭이 열리지 않는다). 저장소를 쓸 수
 * 없으면 기록 없이 메모리 큐만으로 지운다.
 */
export function rememberDeckDelete(userId: string, id: string): void {
  if (!IdSchema.safeParse(id).success) return;
  const ids = readIds(userId);
  if (ids.includes(id)) return;
  writeIds(userId, [...ids, id]);
}

/** 서버가 지웠거나 다시는 지울 수 없는 곡, 다시 넣은 곡의 기록을 지운다 */
export function forgetDeckDelete(userId: string, id: string): void {
  const ids = readIds(userId);
  if (!ids.includes(id)) return;
  writeIds(
    userId,
    ids.filter((candidate) => candidate !== id),
  );
}

/** 그 사용자가 지우고 서버에서 아직 지우지 못한 곡 id. 읽을 수 없으면 빈 목록이다 */
export function listPendingDeckDeletes(userId: string): string[] {
  return readIds(userId);
}
