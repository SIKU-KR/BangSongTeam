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
  reportCorruptedRecords,
} from "../../lib/storage";
import { getCurrentUserId } from "../../lib/auth/sessionStore";
import { scheduleDeckPush, scheduleDeckDelete } from "../../lib/sync/deckSync";
import { withServerFields } from "../../lib/sync/mergeLibraryDecks";

// 보관함 곡의 소유자는 세션 사용자다. 예전 게스트 상수는 제거했다
// (로그인이 편집의 전제 조건이 되었다 — 2026-09-22 결정).

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
  const userId = getCurrentUserId();
  try {
    await migrateLegacySongs();
    const { valid, corrupted } = await loadAllSongs();
    reportCorruptedRecords(corrupted);
    // 세션 사용자의 곡만 싣는다 (한 브라우저에서 계정을 바꿔도 격리된다).
    userSongsCache = userId
      ? valid.filter((deck) => deck.userId === userId)
      : [];
    emitChange();
    clearPersistenceError();
  } catch (err) {
    // 저장소를 못 쓰는 환경에서도 곡 추가 자체는 동작해야 한다 (세션 한정)
    reportPersistenceError(err);
  }
}

/** 보관함 곡 1건 조회 */
export function getLibraryDeck(id: string): Deck | undefined {
  return userSongsCache.find((deck) => deck.id === id);
}

/** 캐시에 곡을 넣거나 바꾼다 (같은 id면 제자리 교체, 없으면 맨 앞에 추가) */
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

/** 신규 찬양곡을 사용자 보관함에 저장 */
export function saveSongToLibrary(songInput: {
  id?: string;
  title: string;
  artist?: string;
  lyricsRaw: string;
  backgroundId?: string | null;
  /** '가사 라이브러리에 기여' 체크박스 (PRD 4.8, 기본 켜짐) */
  contributeToCatalog?: boolean;
  /** '이 곡이 맞나요?'에서 고른 가사 라이브러리 곡 */
  catalogId?: string | null;
}): Deck {
  const userId = getCurrentUserId();
  if (!userId) {
    // 로그인이 편집의 전제 조건이므로 여기 도달하면 게이트가 새는 것이다.
    // 빈 userId로 저장하면 DeckSchema(uuid)에서 터지거나, 더 나쁘게는
    // 아무에게도 안 보이는 곡이 저장된다.
    throw new Error("로그인이 필요합니다");
  }

  const now = new Date().toISOString();
  const slides = splitLyricsIntoSlides(songInput.lyricsRaw);

  const newDeck: Deck = DeckSchema.parse({
    id: songInput.id ?? crypto.randomUUID(),
    userId,
    catalogId: songInput.catalogId ?? null,
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
    // 직접 붙여넣어 만든 곡이다. 서버도 새 행을 'user'로 만든다 (루트 버전 후보).
    origin: "user",
    contributeToCatalog: songInput.contributeToCatalog ?? true,
    createdAt: now,
    updatedAt: now,
  });

  putInCache(newDeck);
  emitChange();
  void persist(() => saveSong(newDeck));
  scheduleDeckPush(newDeck);
  return newDeck;
}

/**
 * 완성된 덱을 보관함에 넣거나 바꾼다.
 *
 * 편집기 '공유'가 세트 곡 내용을 보관함 원본에 반영할 때, 가져오기(fork)로 받은
 * 덱을 보관함에 넣을 때 쓴다. 가져오기 결과는 이미 서버에 있으므로 `push: false`.
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
 * 서버와 병합한 보관함 전체로 교체한다 (부팅 동기화).
 * 다음 부팅에서 네트워크가 없어도 그대로 열리도록 로컬에도 적어 둔다.
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
 * 서버가 확정한 덱을 반영한다 (push 응답).
 *
 * 공유 필드와 카탈로그 연결만 입힌다. 응답을 기다리는 사이 사용자가 가사를
 * 더 고쳤을 수 있으므로 내용은 로컬 것을 지킨다.
 */
export function applyServerDeckFields(serverDeck: Deck): void {
  const local = getLibraryDeck(serverDeck.id);
  const next = local ? withServerFields(local, serverDeck) : serverDeck;
  if (next.userId !== getCurrentUserId()) return;
  putInCache(next);
  emitChange();
  void persist(() => saveSong(next));
}

/** 사용자가 등록한 곡 삭제 */
export function deleteUserSong(id: string): void {
  userSongsCache = userSongsCache.filter((d) => d.id !== id);
  emitChange();
  void persist(() => deleteSong(id));
  scheduleDeckDelete(id);
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

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

/**
 * 내 보관함 곡 목록을 구독한다.
 *
 * 공유 곡은 여기 섞지 않는다 (M5). 공유 라이브러리는 서버 검색 결과이고,
 * 곡 추가 모달이 따로 불러와 보여 준다.
 */
export function useUserSongs(): Deck[] {
  return useSyncExternalStore(subscribe, getUserSongs, getUserSongs);
}

/** 보관함 곡 1건을 구독한다 (편집기 '공유' 패널의 공개 상태) */
export function useLibraryDeck(
  id: string | null | undefined,
): Deck | undefined {
  const find = (): Deck | undefined =>
    id ? userSongsCache.find((deck) => deck.id === id) : undefined;
  return useSyncExternalStore(subscribe, find, find);
}
