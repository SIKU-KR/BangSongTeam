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
import { scheduleDeckPush, scheduleDeckDelete } from "../../lib/sync/deckSync";
import { withServerFields } from "../../lib/sync/mergeLibraryDecks";
import { createSongDeck } from "./songDeck";

let userSongsCache: Deck[] = [];
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
 */
export async function hydrateSongLibrary(): Promise<void> {
  const userId = getCurrentUserId();
  try {
    await migrateLegacySongs();
    const { valid, corrupted } = await loadAllSongs();
    reportCorruptedRecords(corrupted);
    userSongsCache = userId
      ? valid.filter((deck) => deck.userId === userId)
      : [];
    emitChange();
    clearPersistenceError();
  } catch (err) {
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
  id?: string;
  title: string;
  artist?: string;
  lyricsRaw: string;
  backgroundId?: string | null;
}): Deck {
  const userId = getCurrentUserId();
  if (!userId) {
    throw new Error(API_ERRORS.loginRequired);
  }

  return upsertLibraryDeck(
    createSongDeck({
      ...songInput,
      userId,
      scope: "library",
      origin: "user",
    }),
  );
}

/**
 * 완성된 곡을 보관함에 추가하거나 갱신.
 */
export function upsertLibraryDeck(
  deck: Deck,
  options: { push?: boolean } = {},
): Deck {
  const parsed = DeckSchema.parse(deck);
  putInCache(parsed);
  emitChange();
  void persist(() => saveSong(parsed));
  if (options.push ?? true) scheduleDeckPush(parsed);
  return parsed;
}

/**
 * 서버와 병합한 보관함 전체로 교체.
 */
export async function applyServerLibraryDecks(decks: Deck[]): Promise<void> {
  const userId = getCurrentUserId();
  userSongsCache = userId ? decks.filter((deck) => deck.userId === userId) : [];
  emitChange();
  for (const deck of userSongsCache) {
    await persist(() => saveSong(deck));
  }
}

/**
 * 서버가 확정한 덱 메타데이터 반영.
 */
export function applyServerDeckFields(serverDeck: Deck): void {
  const local = getLibraryDeck(serverDeck.id);
  const next = local ? withServerFields(local, serverDeck) : serverDeck;
  if (next.userId !== getCurrentUserId()) return;
  putInCache(next);
  emitChange();
  void persist(() => saveSong(next));
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

/**
 * 보관함 곡 1건 구독 훅.
 */
export function useLibraryDeck(
  id: string | null | undefined,
): Deck | undefined {
  const find = (): Deck | undefined =>
    id ? userSongsCache.find((deck) => deck.id === id) : undefined;
  return useSyncExternalStore(subscribe, find, find);
}
