import { useSyncExternalStore } from "react";
import type { Deck } from "@repo/shared";
import { DeckSchema, DEFAULT_DECK_STYLE, splitLyricsIntoSlides } from "@repo/shared";
import { COMMUNITY_SONGS } from "../library/mockCommunityData";

const STORAGE_KEY = "worship_user_songs_v1";
const GUEST_USER_ID = "00000000-0000-4000-8000-000000000001";

export interface AvailableSongItem {
  deck: Deck;
  source: "mine" | "community";
}

let userSongsCache: Deck[] = loadUserSongs();
const listeners = new Set<() => void>();

function safeLocalStorageGet(): string | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage.getItem(STORAGE_KEY);
    }
  } catch {
    // Ignore storage exceptions (sandboxed, private mode, etc.)
  }
  return null;
}

function safeLocalStorageSet(value: string): void {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, value);
    }
  } catch {
    // Ignore storage exceptions
  }
}

function loadUserSongs(): Deck[] {
  const raw = safeLocalStorageGet();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => DeckSchema.parse(item));
    }
  } catch (err) {
    console.error("Failed to load user songs from localStorage:", err);
  }
  return [];
}

function emitChange(): void {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * 사용자가 등록한 곡 목록 반환
 */
export function getUserSongs(): Deck[] {
  return userSongsCache;
}

/**
 * 신규 찬양곡을 사용자 로컬 보관함에 저장
 */
export function saveSongToLibrary(
  songInput: {
    id?: string;
    title: string;
    artist?: string;
    lyricsRaw: string;
    backgroundId?: string | null;
  },
): Deck {
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

  safeLocalStorageSet(JSON.stringify(userSongsCache));
  emitChange();
  return newDeck;
}

/**
 * 사용자가 등록한 곡 삭제
 */
export function deleteUserSong(id: string): void {
  userSongsCache = userSongsCache.filter((d) => d.id !== id);
  safeLocalStorageSet(JSON.stringify(userSongsCache));
  emitChange();
}

/**
 * 테스트 격리용 초기화
 */
export function resetSongLibraryStore(): void {
  userSongsCache = [];
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Ignore
  }
  emitChange();
}

let cachedAvailableSongs: AvailableSongItem[] = [];
let cachedUserSongsRef: Deck[] = [];

function buildAvailableSongs(userSongs: Deck[]): AvailableSongItem[] {
  const mine: AvailableSongItem[] = userSongs.map((deck) => ({
    deck,
    source: "mine" as const,
  }));

  const userSongTitles = new Set(
    userSongs.map((s) => `${s.title.trim()}__${(s.artist ?? "").trim()}`),
  );

  const community: AvailableSongItem[] = COMMUNITY_SONGS.filter(
    (cs) => !userSongTitles.has(`${cs.title.trim()}__${(cs.artist ?? "").trim()}`),
  ).map((deck) => ({
    deck,
    source: "community" as const,
  }));

  return [...mine, ...community];
}

/**
 * 사용 가능한 전체 곡 목록 (내 보관함 + 공유 찬양)
 */
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

/**
 * 컴포넌트에서 반응형으로 전체 곡 목록을 구독하는 React Hook
 */
export function useAvailableSongs(): AvailableSongItem[] {
  return useSyncExternalStore(subscribe, getAvailableSongs, getAvailableSongs);
}
