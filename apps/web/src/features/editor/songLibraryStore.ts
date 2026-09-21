import { useSyncExternalStore } from "react";
import type { Deck } from "@repo/shared";
import {
  DeckSchema,
  DEFAULT_DECK_STYLE,
  splitLyricsIntoSlides,
} from "@repo/shared";
import {
  saveSong,
  deleteSong,
  loadAllSongs,
  clearAllSongs,
  migrateLegacySongs,
  reportPersistenceError,
  clearPersistenceError,
} from "../../lib/storage";
import { COMMUNITY_SONGS } from "../library/mockCommunityData";

const GUEST_USER_ID = "00000000-0000-4000-8000-000000000001";

export interface AvailableSongItem {
  deck: Deck;
  source: "mine" | "community";
}

/**
 * 보관함 곡은 IndexedDB(`worship-offline-db`의 decks 스토어)에 저장한다.
 * 이 캐시는 동기 렌더를 위한 읽기 전용 사본이며, 원천은 항상 저장소다.
 */
let userSongsCache: Deck[] = [];
const listeners = new Set<() => void>();

function emitChange(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** 사용자가 등록한 곡 목록 반환 */
export function getUserSongs(): Deck[] {
  return userSongsCache;
}

/**
 * 저장소에서 보관함을 읽어 메모리 캐시를 채운다.
 * 구 localStorage 보관함이 남아 있으면 먼저 이관한다.
 */
export async function hydrateSongLibrary(): Promise<void> {
  try {
    await migrateLegacySongs();
    const { valid } = await loadAllSongs();
    userSongsCache = valid;
    emitChange();
    clearPersistenceError();
  } catch (err) {
    // 저장소를 못 쓰는 환경에서도 곡 추가 자체는 동작해야 한다 (세션 한정)
    reportPersistenceError(err);
  }
}

/** 신규 찬양곡을 사용자 보관함에 저장 */
export function saveSongToLibrary(songInput: {
  id?: string;
  title: string;
  artist?: string;
  lyricsRaw: string;
  backgroundId?: string | null;
}): Deck {
  const now = new Date().toISOString();
  const slides = splitLyricsIntoSlides(songInput.lyricsRaw);

  const newDeck: Deck = DeckSchema.parse({
    id: songInput.id ?? crypto.randomUUID(),
    userId: GUEST_USER_ID,
    catalogId: null,
    scope: "library",
    presentationId: null,
    title: songInput.title.trim(),
    artist: songInput.artist?.trim() ?? "",
    lyricsRaw: songInput.lyricsRaw,
    slides,
    backgroundId: songInput.backgroundId ?? null,
    style: DEFAULT_DECK_STYLE,
    visibility: "private",
    forkedFrom: null,
    forkCount: 0,
    createdAt: now,
    updatedAt: now,
  });

  // 중복 ID 방지 (동일 ID가 있으면 수정, 없으면 앞에 추가)
  const existingIdx = userSongsCache.findIndex((d) => d.id === newDeck.id);
  if (existingIdx >= 0) {
    userSongsCache = [
      ...userSongsCache.slice(0, existingIdx),
      newDeck,
      ...userSongsCache.slice(existingIdx + 1),
    ];
  } else {
    userSongsCache = [newDeck, ...userSongsCache];
  }

  emitChange();
  void persist(() => saveSong(newDeck));
  return newDeck;
}

/** 사용자가 등록한 곡 삭제 */
export function deleteUserSong(id: string): void {
  userSongsCache = userSongsCache.filter((d) => d.id !== id);
  emitChange();
  void persist(() => deleteSong(id));
}

/** 저장 실패를 삼키지 않고 경고 상태로 올린다 */
async function persist(operation: () => Promise<void>): Promise<void> {
  try {
    await operation();
    clearPersistenceError();
  } catch (err) {
    reportPersistenceError(err);
  }
}

/** 테스트 격리용 초기화 */
export async function resetSongLibraryStore(): Promise<void> {
  userSongsCache = [];
  emitChange();
  try {
    await clearAllSongs();
  } catch {
    // 저장소를 쓸 수 없는 환경에서는 메모리 초기화만으로 충분하다
  }
}

let cachedAvailableSongs: AvailableSongItem[] = [];
let cachedUserSongsRef: Deck[] | null = null;

function buildAvailableSongs(userSongs: Deck[]): AvailableSongItem[] {
  const mine: AvailableSongItem[] = userSongs.map((deck) => ({
    deck,
    source: "mine" as const,
  }));

  const userSongTitles = new Set(
    userSongs.map((s) => `${s.title.trim()}__${(s.artist ?? "").trim()}`),
  );

  const community: AvailableSongItem[] = COMMUNITY_SONGS.filter(
    (cs) =>
      !userSongTitles.has(`${cs.title.trim()}__${(cs.artist ?? "").trim()}`),
  ).map((deck) => ({
    deck,
    source: "community" as const,
  }));

  return [...mine, ...community];
}

/** 사용 가능한 전체 곡 목록 (내 보관함 + 공유 찬양) */
export function getAvailableSongs(): AvailableSongItem[] {
  if (cachedUserSongsRef !== userSongsCache) {
    cachedUserSongsRef = userSongsCache;
    cachedAvailableSongs = buildAvailableSongs(userSongsCache);
  }
  return cachedAvailableSongs;
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

/** 컴포넌트에서 반응형으로 전체 곡 목록을 구독하는 React Hook */
export function useAvailableSongs(): AvailableSongItem[] {
  return useSyncExternalStore(subscribe, getAvailableSongs, getAvailableSongs);
}
