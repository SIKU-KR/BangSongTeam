import { useSyncExternalStore } from "react";
import {
  API_ERRORS,
  DeckSchema,
  editTimestamp,
  isFarFuture,
  toWellFormedText,
  type Deck,
} from "#shared";
import {
  saveSong,
  deleteSong,
  loadAllSongs,
  loadSong,
  clearAllSongs,
  migrateLegacySongs,
  reportPersistenceError,
  clearPersistenceError,
  reportCorruptedRecords,
  createWriteRetry,
  type LoadedRecord,
  type WriteOp,
} from "../../lib/storage";
import { announceStorageChange } from "../../lib/storage/storageChannel";
import { getCurrentUserId } from "../../lib/auth/sessionStore";
import { serverAlignedNow } from "../../lib/api/serverClock";
import {
  cancelDeckDelete,
  cancelDeckDeleteReaddedElsewhere,
  cancelDeckPush,
  deletedDeckIds,
  markDeckDeleted,
  resumeOtherTabsDeckDeletes,
  resumePendingDeckDeletes,
  scheduleDeckPush,
  scheduleDeckDelete,
  unmarkDeckDeleted,
} from "../../lib/sync/deckSync";
import {
  forgetDeckDelete,
  listPendingDeckDeletes,
} from "../../lib/sync/pendingDeckDeletes";
import {
  hasSameDeckContent,
  hasSameServerFields,
  withServerFields,
} from "../../lib/sync/mergeLibraryDecks";
import { createSongDeck } from "./songDeck";

let userSongsCache: Deck[] = [];
let hydrationFailed = false;
const unpersisted = new Map<string, number>();
const writing = new Set<Promise<void>>();
const listeners = new Set<() => void>();

const writeRetry = createWriteRetry("deck", (failed) => {
  for (const [id, op] of failed) {
    const latest = getLibraryDeck(id);
    if (latest) void persist(id, "save", () => saveSong(latest));
    else if (op === "delete") void persist(id, "delete", () => deleteSong(id));
    else writeRetry.succeeded(id);
  }
});

function emitChange(): void {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * 사용자가 등록한 곡 목록 반환.
 */
export function getUserSongs(): Deck[] {
  return userSongsCache;
}

/**
 * 저장소에서 보관함을 읽어 메모리 캐시를 채운다.
 *
 * 읽지 못하면 보관함을 비우고 부팅 병합이 저장소에 쓰지 않게 한다. 앞 계정의 곡이 남으면
 * 병합이 새 계정에 올리고, 병합 결과를 쓰면 읽지 못한 저장본(아직 올리지 못한 곡)을 덮는다.
 *
 * 지우고 서버에서 아직 지우지 못한 곡(`pendingDeckDeletes`)은 저장본에 남아 있어도 보관함에
 * 넣지 않고 저장본에서 지운다. 저장본 삭제는 비동기라 지운 직후 탭을 닫으면 끝나지 않는다.
 *
 * 읽기 전에 앞서 실패한 쓰기의 다시 시도와 그 경고를 버린다. 읽지 못한 경고는 다시 불러올 때까지
 * 남긴다. 곡을 저장했다고 지우면 읽지 못한 저장본이 있다는 것을 알 수 없다.
 */
export async function hydrateSongLibrary(): Promise<void> {
  writeRetry.reset();
  const userId = getCurrentUserId();
  try {
    await migrateLegacySongs();
    const { valid, corrupted } = await loadAllSongs();
    reportCorruptedRecords(corrupted);
    hydrationFailed = false;
    const own = userId ? valid.filter((deck) => deck.userId === userId) : [];
    const pendingDeletes = new Set(
      userId ? listPendingDeckDeletes(userId) : [],
    );
    userSongsCache = own.filter((deck) => !pendingDeletes.has(deck.id));
    emitChange();
    clearPersistenceError("deck:hydrate");
    for (const { id } of own) {
      if (pendingDeletes.has(id)) {
        await persist(id, "delete", () => deleteSong(id));
      }
    }
  } catch (err) {
    hydrationFailed = true;
    userSongsCache = [];
    emitChange();
    reportPersistenceError(err, "deck:hydrate");
  }
}

/**
 * 보관함 곡 1건 조회.
 */
export function getLibraryDeck(id: string): Deck | undefined {
  return userSongsCache.find((deck) => deck.id === id);
}

function putInCache(deck: Deck): void {
  const existingIdx = userSongsCache.findIndex((d) => d.id === deck.id);
  if (existingIdx >= 0) {
    userSongsCache = [
      ...userSongsCache.slice(0, existingIdx),
      deck,
      ...userSongsCache.slice(existingIdx + 1),
    ];
  } else {
    userSongsCache = [deck, ...userSongsCache];
  }
}

/**
 * 새 곡을 사용자 보관함에 저장. 로그인하지 않았으면 저장할 곳이 없으므로 던진다.
 */
export function saveSongToLibrary(songInput: {
  title: string;
  artist?: string;
  lyricsRaw: string;
}): Deck {
  const userId = getCurrentUserId();
  if (!userId) {
    throw new Error(API_ERRORS.loginRequired);
  }

  return upsertLibraryDeck(createSongDeck({ ...songInput, userId }));
}

/**
 * 완성된 곡을 보관함에 추가하거나 갱신. 서버 덱을 보관함에 새로 넣는 길은 이것뿐이다.
 *
 * 지우고 아직 서버에 DELETE를 보내지 않은 곡이면 그 DELETE를 거둔다. 공유 곡을 다시
 * 가져오면 서버는 남아 있는 첫 사본을 돌려주므로, 거두지 않으면 다시 가져온 곡이 서버에서
 * 지워지고 원작 표시도 잃는다.
 */
export function upsertLibraryDeck(
  deck: Deck,
  options: { push?: boolean } = {},
): Deck {
  const parsed = DeckSchema.parse(deck);
  cancelDeckDelete(parsed.id, parsed.userId);
  putInCache(parsed);
  emitChange();
  void persist(parsed.id, "save", () => saveSong(parsed));
  if (options.push ?? true) scheduleDeckPush(parsed);
  return parsed;
}

function isServerChange(local: Deck | undefined, merged: Deck): boolean {
  if (local === merged) return false;
  return (
    !local ||
    local.updatedAt !== merged.updatedAt ||
    !hasSameServerFields(local, merged)
  );
}

/**
 * 서버와 병합한 보관함 전체로 교체하고, 서버에서 온 변경만 저장한다. `removedIds`는 지운
 * 곡이라 저장본에서도 지운다.
 *
 * 새 곡, `updatedAt`이 바뀐 곡, 서버가 정하는 공유 필드가 바뀐 곡만 쓴다. 병합은 `updatedAt`이
 * 같으면 서버 객체를 고르므로, 객체가 같은지만 보면 동기화된 곡을 부팅마다 모두 다시 쓴다.
 * 곡마다 쓰기 직전에 지금 보관함에 있는 사본을 다시 찾아 쓰고 그사이 지운 곡은 건너뛴다.
 * 병합 때의 사본을 쓰면 그사이 고친 내용을 덮거나 지운 곡을 저장본에 되살린다.
 *
 * 보관함을 읽지 못했으면 메모리만 바꾸고 저장소에는 쓰지 않는다 (`hydrateSongLibrary`).
 */
export async function applyServerLibraryDecks(
  decks: Deck[],
  removedIds: readonly string[] = [],
): Promise<void> {
  const previous = new Map(userSongsCache.map((deck) => [deck.id, deck]));
  const userId = getCurrentUserId();
  userSongsCache = userId ? decks.filter((deck) => deck.userId === userId) : [];
  emitChange();
  if (hydrationFailed) return;

  for (const id of removedIds) {
    await persist(id, "delete", () => deleteSong(id));
  }
  const changed = userSongsCache.filter((deck) =>
    isServerChange(previous.get(deck.id), deck),
  );
  for (const { id } of changed) {
    const latest = getLibraryDeck(id);
    if (latest) await persist(id, "save", () => saveSong(latest));
  }
}

function adoptsServerDeck(local: Deck, server: Deck): boolean {
  return (
    server.updatedAt > local.updatedAt ||
    hasSameDeckContent(local, server) ||
    isFarFuture(local.updatedAt, serverAlignedNow())
  );
}

/**
 * 서버가 확정한 덱 반영 (push·공개 설정 응답).
 *
 * 서버 덱을 통째로 따르는 때:
 * - 서버 덱이 로컬보다 늦게 고친 것이다. 서버는 늦게 온 옛 수정을 쓰지 않고, 더 늦게 고친 다른
 *   기기의 곡을 돌려준다.
 * - 내용이 같고 시각만 다르다(`hasSameDeckContent`). 서버가 기기 시각을 줄이고 만든 시각을 처음 값으로
 *   지킨 것이라, 따르지 않으면 다음 부팅 병합에서 로컬 시각이 이겨 같은 곡을 다시 올린다.
 * - 로컬 시각이 서버에 맞춘 지금(`serverAlignedNow`)보다 한참 앞선다(`isFarFuture`). 빠른 시계가 남긴
 *   값이라 로컬이 더 새롭다고 볼 수 없다(`mergeLibraryDecks`도 서버 사본을 고른다). 시계가 늦은 기기의
 *   기기 시계로 가르면 서버 판 바로 뒤로 찍은 수정까지 걸린다. 서버 덱으로 바로 맞추고, 이 값을 읽는
 *   이전 버전의 탭이 병합에서 다시 올리지 않게 저장본도 고친다.
 *
 * 그 밖에는 서버가 정하는 공유 필드만 입히고 내용은 로컬을 지킨다. 그사이 로컬에서 더 고친 내용이 곧
 * 올라간다.
 *
 * 보관함에 없는 곡이면 무시한다. 올리는 동안 사용자가 지운 곡의 응답이 곡을 다시 넣으면
 * 서버에서는 지워진 곡이 이 기기에만 남고 다음 부팅에 다시 올라간다.
 */
export function applyServerDeckFields(serverDeck: Deck): void {
  const local = getLibraryDeck(serverDeck.id);
  if (!local) return;
  const next = adoptsServerDeck(local, serverDeck)
    ? serverDeck
    : withServerFields(local, serverDeck);
  if (next.userId !== getCurrentUserId()) return;
  putInCache(next);
  emitChange();
  void persist(next.id, "save", () => saveSong(next));
}

/**
 * 서버가 이미 지운 곡(410)을 보관함과 저장본에서 내려놓는다. 다른 기기나 탭에서 지운 곡이라
 * 서버에 DELETE를 다시 보내지 않는다.
 */
export function dropDeletedLibraryDeck(id: string): void {
  userSongsCache = userSongsCache.filter((deck) => deck.id !== id);
  emitChange();
  void persist(id, "delete", () => deleteSong(id));
}

/**
 * 다른 탭이 IndexedDB에 쓰거나 지운 보관함 곡을 저장본에서 다시 읽어 맞춘다(`storageSync`가
 * 부른다).
 *
 * 세션 사용자의 곡이면 보관함의 곡을 저장본으로 바꾸거나 더한다. 저장본이 없으면 다른 탭에서 지운
 * 곡이다. 보관함에서 빼고, 이 탭이 올리려던 PUT을 버리고, 지운 곡으로 기억한다(`markDeckDeleted`).
 * 남겨 두면 이 탭이 지운 곡을 서버에 다시 올리고, 부팅 병합이 서버 목록의 곡을 다시 넣는다. 이 탭이
 * 그 곡을 지우려고 기다리던 DELETE는 남긴다. 이 브라우저의 다른 탭이 지우고 서버가 아직 답하지 않은
 * 곡(`pendingDeckDeletes`)도 저장본이 남아 있으면 같게 본다. 하이드레이션도 그 곡을 싣지 않는다.
 *
 * 이 탭이 지웠거나 서버가 지웠다고 답한 곡은 저장본이 다시 생겨도 보관함에 넣지 않는다. 그 저장본은
 * 다른 탭의 늦은 쓰기(push 응답 등)라, 넣으면 서버에서 지운 곡이 이 탭에만 남는다. 다만 이 탭이 지운
 * 곡을 다른 탭이 다시 가져와 삭제 기록에서 뺐고 이 탭의 DELETE가 아직 나가지 않았으면, 그 DELETE를
 * 거두고 싣는다(`cancelDeckDeleteReaddedElsewhere`). 거두지 않으면 다시 가져온 곡을 서버에서 지운다.
 * 다른 탭에서 지운 곡으로만 기억한 곡은 저장본이 다시 생기면 기억을 지우고 싣는다(`unmarkDeckDeleted`).
 * 지운 탭이 같은 공유 곡을 다시 가져온 것이라, 기억을 남기면 이 탭의 다음 보관함 병합이 그 곡을 지운다.
 *
 * 이 탭이 아직 저장하지 않았거나 저장하는 중인 곡은 건너뛴다(읽는 동안 고친 곡도 같다). 곧 이 탭의
 * 쓰기가 저장본을 다시 쓰고, 지운 곡을 이 탭에서 다시 가져오는 중이면 다시 넣은 곡을 지운 알림이
 * 빼면 안 된다. 읽지 못한 저장본은 지운 것이 아니라 그대로 둔다. 저장도 push도 하지 않는다. 보관함을
 * 읽지 못한 탭은 다시 읽지 않는다.
 *
 * 읽은 뒤 `isPaused()`가 참이면(그사이 송출을 시작함) 아무것도 바꾸지 않고 읽은 id를 돌려준다.
 * 부른 쪽이 모아 두었다가 송출을 마친 뒤 다시 읽는다. 그 밖에는 빈 목록이다.
 */
export async function reloadSongsFromStorage(
  ids: readonly string[],
  isPaused: () => boolean = () => false,
): Promise<string[]> {
  if (hydrationFailed) return [];
  const userId = getCurrentUserId();
  if (!userId) return [];
  const unique = [...new Set(ids)].filter((id) => !unpersisted.has(id));
  if (unique.length === 0) return [];
  let loaded: { id: string; record: LoadedRecord<Deck> }[];
  try {
    loaded = await Promise.all(
      unique.map(async (id) => ({ id, record: await loadSong(id) })),
    );
  } catch {
    return [];
  }
  if (getCurrentUserId() !== userId) return [];
  if (isPaused()) return unique;

  const deleting = new Set(listPendingDeckDeletes(userId));
  let changed = false;
  for (const { id, record } of loaded) {
    if (unpersisted.has(id) || record.status === "unreadable") continue;
    if (record.status === "ok" && record.value.userId !== userId) continue;
    if (record.status === "missing" || deleting.has(id)) {
      cancelDeckPush(id);
      markDeckDeleted(id);
      if (getLibraryDeck(id)) {
        userSongsCache = userSongsCache.filter((deck) => deck.id !== id);
        changed = true;
      }
      continue;
    }
    if (!unmarkDeckDeleted(id) && !cancelDeckDeleteReaddedElsewhere(id)) {
      continue;
    }
    putInCache(record.value);
    changed = true;
  }
  if (changed) emitChange();
  return [];
}

/**
 * 이 계정에서 지운 곡 id. 보관함 병합이 서버 목록에서 받지도, 로컬에서 올리지도 않는다
 * (`deletedDeckIds`). 앞선 페이지에서 지우고 서버에서 아직 지우지 못한 곡도 넣는다. 서버
 * 목록에는 그 곡이 아직 있다.
 */
export function getDeletedSongIds(): ReadonlySet<string> {
  const userId = getCurrentUserId();
  if (!userId) return deletedDeckIds();
  return new Set([...deletedDeckIds(), ...listPendingDeckDeletes(userId)]);
}

/**
 * 앞선 페이지에서 지우고 서버에서 아직 지우지 못한 지금 계정의 곡을 다시 서버에서 지운다
 * (`resumePendingDeckDeletes`). 부팅 동기화가 곡 큐를 켜자마자 부른다.
 */
export function resumeSongDeletes(): void {
  const userId = getCurrentUserId();
  if (userId) resumePendingDeckDeletes(userId);
}

/**
 * 같은 브라우저의 다른 탭이 지우고 서버에 보내지 못한 지금 계정의 곡을 이 탭이 서버에서 지운다
 * (`resumeOtherTabsDeckDeletes`). 연결 회복 신호마다 부른다. 지운 탭이 보내지 못하고 닫혔으면 열려 있는
 * 탭은 그 곡을 감추기만 해, 다음 부팅까지 서버와 공유 라이브러리에 남는다.
 */
export function resumeOtherTabsSongDeletes(): void {
  const userId = getCurrentUserId();
  if (userId) resumeOtherTabsDeckDeletes(userId);
}

/**
 * 보관함 곡의 제목·아티스트 수정. 공개 곡이면 서버 동기화 뒤 공유 라이브러리에도
 * 그대로 보인다. 이미 프레젠테이션에 넣은 곡은 복제본이라 바뀌지 않는다.
 *
 * 수정 시각은 지금이되 이 기기가 본 판보다 뒤로 찍는다(`editTimestamp`). 가져오기는 서버 시각으로
 * 찍히므로, 시계가 뒤처진 기기가 가져오자마자 고친 이름을 지금으로 찍으면 서버가 옛 수정으로 보고
 * 버린다. 지금은 서버에 맞춘 시각이다(`serverAlignedNow`). 기기 시계로는 시계가 늦은 기기가 가져온
 * 시각 바로 뒤로 찍은 수정을 한참 앞선 값(`isFarFuture`)으로 봐, 늦게 온 앞 판 응답이 그 수정을 덮는다.
 */
export function updateLibrarySongInfo(
  id: string,
  input: { title: string; artist: string },
): Deck | undefined {
  const info = {
    title: toWellFormedText(input.title),
    artist: toWellFormedText(input.artist),
  };
  const deck = getLibraryDeck(id);
  if (!deck) return undefined;
  if (deck.title === info.title && deck.artist === info.artist) return deck;
  return upsertLibraryDeck({
    ...deck,
    title: info.title,
    artist: info.artist,
    updatedAt: editTimestamp(deck.updatedAt, serverAlignedNow()),
  });
}

/**
 * 사용자가 등록한 곡 삭제. 프레젠테이션에 넣은 곡은 복제본이라 남는다. 공개 곡이면
 * 서버에서 지워지면서 공유 라이브러리에서도 사라진다.
 *
 * 서버 삭제를 메모리·저장본에서 지우기보다 먼저 예약한다. 예약이 남기는 삭제 기록
 * (`pendingDeckDeletes`)이 있어야 오프라인이거나 곧바로 탭을 닫아도 다음 부팅이 서버의 곡을
 * 되살리지 않고 다시 지운다.
 */
export function deleteUserSong(id: string): void {
  const userId = getCurrentUserId();
  if (userId) scheduleDeckDelete(id, userId);
  userSongsCache = userSongsCache.filter((d) => d.id !== id);
  emitChange();
  void persist(id, "delete", () => deleteSong(id));
}

/**
 * 저장소에 쓰는 중인 곡 쓰기가 모두 끝날 때까지 기다린다. 창을 닫거나 숨길 때, 로그아웃하기 전,
 * 계정이 끝나 새로고침하기 전의 마지막 저장이라, 앞서 쓰지 못해 다시 시도를 기다리는 저장·지우기도
 * 백오프를 기다리지 않고 지금 다시 한다. 새로고침은 끝나지 않은 쓰기를 버리고, 다시 시도는 최대 1분
 * 뒤라 그사이 페이지가 사라지면 서버에 올리지 못한 곡을 잃는다. 바뀔 때마다 하는 쓰기는 실패한 쓰기를
 * 함께 하지 않는다.
 */
export async function flushSongWrites(): Promise<void> {
  writeRetry.retryNow();
  while (writing.size > 0) await Promise.all(writing);
}

function persist(
  id: string,
  op: WriteOp,
  operation: () => Promise<void>,
): Promise<void> {
  const write = writeSong(id, op, operation);
  writing.add(write);
  void write.finally(() => writing.delete(write));
  return write;
}

async function writeSong(
  id: string,
  op: WriteOp,
  operation: () => Promise<void>,
): Promise<void> {
  unpersisted.set(id, (unpersisted.get(id) ?? 0) + 1);
  try {
    await operation();
    writeRetry.succeeded(id);
    announceStorageChange("decks", [id]);
  } catch (err) {
    writeRetry.failed(id, op, err);
  } finally {
    const remaining = (unpersisted.get(id) ?? 1) - 1;
    if (remaining > 0) unpersisted.set(id, remaining);
    else unpersisted.delete(id);
  }
}

/**
 * 테스트 격리용 초기화.
 */
export async function resetSongLibraryStore(): Promise<void> {
  const userId = getCurrentUserId();
  if (userId) {
    for (const id of listPendingDeckDeletes(userId)) {
      forgetDeckDelete(userId, id);
    }
  }
  userSongsCache = [];
  hydrationFailed = false;
  unpersisted.clear();
  writing.clear();
  writeRetry.reset();
  emitChange();
  try {
    await clearAllSongs();
  } catch (error) {
    void error;
  }
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

/**
 * 내 보관함 곡 목록 구독 훅.
 */
export function useUserSongs(): Deck[] {
  return useSyncExternalStore(subscribe, getUserSongs, getUserSongs);
}
