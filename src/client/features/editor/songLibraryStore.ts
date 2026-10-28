import { useSyncExternalStore } from "react";
import { API_ERRORS, DeckSchema, type Deck } from "#shared";
import {
  saveSong,
  deleteSong,
  loadAllSongs,
  clearAllSongs,
  migrateLegacySongs,
  reportPersistenceError,
  clearPersistenceError,
  reportCorruptedRecords,
} from "../../lib/storage";
import { getCurrentUserId } from "../../lib/auth/sessionStore";
import {
  cancelDeckDelete,
  deletedDeckIds,
  scheduleDeckPush,
  scheduleDeckDelete,
} from "../../lib/sync/deckSync";
import {
  hasSameServerFields,
  withServerFields,
} from "../../lib/sync/mergeLibraryDecks";
import { createSongDeck } from "./songDeck";

let userSongsCache: Deck[] = [];
let hydrationFailed = false;
const listeners = new Set<() => void>();

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
 */
export async function hydrateSongLibrary(): Promise<void> {
  const userId = getCurrentUserId();
  try {
    await migrateLegacySongs();
    const { valid, corrupted } = await loadAllSongs();
    reportCorruptedRecords(corrupted);
    hydrationFailed = false;
    userSongsCache = userId
      ? valid.filter((deck) => deck.userId === userId)
      : [];
    emitChange();
    clearPersistenceError();
  } catch (err) {
    hydrationFailed = true;
    userSongsCache = [];
    emitChange();
    reportPersistenceError(err);
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
  cancelDeckDelete(parsed.id);
  putInCache(parsed);
  emitChange();
  void persist(() => saveSong(parsed));
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
    await persist(() => deleteSong(id));
  }
  const changed = userSongsCache.filter((deck) =>
    isServerChange(previous.get(deck.id), deck),
  );
  for (const { id } of changed) {
    const latest = getLibraryDeck(id);
    if (latest) await persist(() => saveSong(latest));
  }
}

/**
 * 서버가 확정한 덱 메타데이터 반영.
 *
 * 보관함에 없는 곡이면 무시한다. 올리는 동안 사용자가 지운 곡의 응답이 곡을 다시 넣으면
 * 서버에서는 지워진 곡이 이 기기에만 남고 다음 부팅에 다시 올라간다.
 */
export function applyServerDeckFields(serverDeck: Deck): void {
  const local = getLibraryDeck(serverDeck.id);
  if (!local) return;
  const next = withServerFields(local, serverDeck);
  if (next.userId !== getCurrentUserId()) return;
  putInCache(next);
  emitChange();
  void persist(() => saveSong(next));
}

/**
 * 서버가 이미 지운 곡(410)을 보관함과 저장본에서 내려놓는다. 다른 기기나 탭에서 지운 곡이라
 * 서버에 DELETE를 다시 보내지 않는다.
 */
export function dropDeletedLibraryDeck(id: string): void {
  userSongsCache = userSongsCache.filter((deck) => deck.id !== id);
  emitChange();
  void persist(() => deleteSong(id));
}

/**
 * 이 계정에서 지운 곡 id. 보관함 병합이 서버 목록에서 받지도, 로컬에서 올리지도 않는다
 * (`deletedDeckIds`).
 */
export function getDeletedSongIds(): ReadonlySet<string> {
  return deletedDeckIds();
}

/**
 * 보관함 곡의 제목·아티스트 수정. 공개 곡이면 서버 동기화 뒤 공유 라이브러리에도
 * 그대로 보인다. 이미 프레젠테이션에 넣은 곡은 복제본이라 바뀌지 않는다.
 */
export function updateLibrarySongInfo(
  id: string,
  info: { title: string; artist: string },
): Deck | undefined {
  const deck = getLibraryDeck(id);
  if (!deck) return undefined;
  if (deck.title === info.title && deck.artist === info.artist) return deck;
  return upsertLibraryDeck({
    ...deck,
    title: info.title,
    artist: info.artist,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * 사용자가 등록한 곡 삭제. 프레젠테이션에 넣은 곡은 복제본이라 남는다. 공개 곡이면
 * 서버에서 지워지면서 공유 라이브러리에서도 사라진다.
 */
export function deleteUserSong(id: string): void {
  userSongsCache = userSongsCache.filter((d) => d.id !== id);
  emitChange();
  void persist(() => deleteSong(id));
  scheduleDeckDelete(id);
}

async function persist(operation: () => Promise<void>): Promise<void> {
  try {
    await operation();
    clearPersistenceError();
  } catch (err) {
    reportPersistenceError(err);
  }
}

/**
 * 테스트 격리용 초기화.
 */
export async function resetSongLibraryStore(): Promise<void> {
  userSongsCache = [];
  hydrationFailed = false;
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
