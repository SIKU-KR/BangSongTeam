import { useSyncExternalStore } from "react";
import type { Deck, Setlist, SetlistItem } from "@repo/shared";
import { INITIAL_BACKGROUNDS } from "@repo/shared";
import { mockSetlist } from "./mockSetlist";

// 깊은 복사 헬퍼로 초기 상태 격리
function cloneMockSetlist(): Setlist {
  return JSON.parse(JSON.stringify(mockSetlist)) as Setlist;
}

let activeSetlist: Setlist = cloneMockSetlist();
const listeners = new Set<() => void>();

function emitChange(): void {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * 현재 활성 세트리스트 반환
 */
export function getActiveSetlist(): Setlist {
  return activeSetlist;
}

/**
 * 인메모리 세트리스트에 신규 덱을 추가하고 모든 구독자에게 알림 (M1 실시간 연동)
 */
export function addDeckToSetlist(deck: Deck): SetlistItem {
  const currentCount = activeSetlist.items.length;
  // backgroundId가 없으면 10개 초기 배경 중 순환 할당
  const assignedBackgroundId =
    deck.backgroundId ||
    INITIAL_BACKGROUNDS[currentCount % INITIAL_BACKGROUNDS.length].id;

  const resolvedDeck: Deck = {
    ...deck,
    backgroundId: assignedBackgroundId,
  };

  const newItem: SetlistItem = {
    id: crypto.randomUUID(),
    setlistId: activeSetlist.id,
    deckId: resolvedDeck.id,
    order: currentCount,
    deck: resolvedDeck,
  };

  activeSetlist = {
    ...activeSetlist,
    items: [...activeSetlist.items, newItem],
    updatedAt: new Date().toISOString(),
  };

  emitChange();
  return newItem;
}

/**
 * 테스트 격리 및 리셋을 위한 함수
 */
export function resetActiveSetlist(): void {
  activeSetlist = cloneMockSetlist();
  emitChange();
}

/**
 * 활성 세트리스트 전체 교체
 */
export function setActiveSetlist(newSetlist: Setlist): void {
  activeSetlist = {
    ...newSetlist,
    updatedAt: new Date().toISOString(),
  };
  emitChange();
}

/**
 * 신규 빈 세트리스트 생성
 */
export function createNewSetlist(title = "새 프레젠테이션 (콘티)"): Setlist {
  const newSetlist: Setlist = {
    id: crypto.randomUUID(),
    userId: activeSetlist.userId,
    title,
    serviceDate: new Date().toISOString().slice(0, 10),
    items: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  activeSetlist = newSetlist;
  emitChange();
  return newSetlist;
}

/**
 * 세트리스트 제목 변경
 */
export function updateSetlistTitle(title: string): void {
  activeSetlist = {
    ...activeSetlist,
    title,
    updatedAt: new Date().toISOString(),
  };
  emitChange();
}

/**
 * 곡(Deck) 메타 정보(제목, 아티스트) 변경
 */
export function updateSongInfo(
  songIndex: number,
  title: string,
  artist?: string,
): void {
  const item = activeSetlist.items[songIndex];
  if (!item || !item.deck) return;

  const updatedDeck: Deck = {
    ...item.deck,
    title,
    artist: artist !== undefined ? artist : item.deck.artist,
    updatedAt: new Date().toISOString(),
  };

  const updatedItems = [...activeSetlist.items];
  updatedItems[songIndex] = { ...item, deck: updatedDeck };

  activeSetlist = {
    ...activeSetlist,
    items: updatedItems,
    updatedAt: new Date().toISOString(),
  };
  emitChange();
}

/**
 * 곡 스타일(DeckStyle) 부분 업데이트
 */
export function updateSongStyle(
  songIndex: number,
  styleUpdate: Partial<Deck["style"]>,
): void {
  const item = activeSetlist.items[songIndex];
  if (!item || !item.deck) return;

  const updatedDeck: Deck = {
    ...item.deck,
    style: {
      ...item.deck.style,
      ...styleUpdate,
      position: {
        ...item.deck.style.position,
        ...(styleUpdate.position ?? {}),
      },
    },
    updatedAt: new Date().toISOString(),
  };

  const updatedItems = [...activeSetlist.items];
  updatedItems[songIndex] = { ...item, deck: updatedDeck };

  activeSetlist = {
    ...activeSetlist,
    items: updatedItems,
    updatedAt: new Date().toISOString(),
  };
  emitChange();
}

/**
 * 곡 배경 영상 변경
 */
export function updateSongBackground(
  songIndex: number,
  backgroundId: string,
): void {
  const item = activeSetlist.items[songIndex];
  if (!item || !item.deck) return;

  const updatedDeck: Deck = {
    ...item.deck,
    backgroundId,
    updatedAt: new Date().toISOString(),
  };

  const updatedItems = [...activeSetlist.items];
  updatedItems[songIndex] = { ...item, deck: updatedDeck };

  activeSetlist = {
    ...activeSetlist,
    items: updatedItems,
    updatedAt: new Date().toISOString(),
  };
  emitChange();
}

/**
 * 슬라이드 줄 가사 업데이트
 */
export function updateSlideLines(
  songIndex: number,
  slideIndex: number,
  lines: string[],
): void {
  const item = activeSetlist.items[songIndex];
  if (!item || !item.deck) return;

  const slides = [...item.deck.slides];
  if (!slides[slideIndex]) return;

  slides[slideIndex] = {
    ...slides[slideIndex],
    lines,
  };

  const updatedDeck: Deck = {
    ...item.deck,
    slides,
    updatedAt: new Date().toISOString(),
  };

  const updatedItems = [...activeSetlist.items];
  updatedItems[songIndex] = { ...item, deck: updatedDeck };

  activeSetlist = {
    ...activeSetlist,
    items: updatedItems,
    updatedAt: new Date().toISOString(),
  };
  emitChange();
}

/**
 * 슬라이드 추가
 */
export function addSlideToSong(
  songIndex: number,
  lines: string[] = ["새 슬라이드 가사를 입력하세요"],
  afterIndex?: number,
): void {
  const item = activeSetlist.items[songIndex];
  if (!item || !item.deck) return;

  const slides = [...item.deck.slides];
  const insertAt = afterIndex !== undefined ? afterIndex + 1 : slides.length;

  const newSlide = {
    id: `slide_${crypto.randomUUID().slice(0, 8)}`,
    order: insertAt,
    lines,
  };

  slides.splice(insertAt, 0, newSlide);

  // order 재정렬
  const reorderedSlides = slides.map((s, idx) => ({ ...s, order: idx }));

  const updatedDeck: Deck = {
    ...item.deck,
    slides: reorderedSlides,
    updatedAt: new Date().toISOString(),
  };

  const updatedItems = [...activeSetlist.items];
  updatedItems[songIndex] = { ...item, deck: updatedDeck };

  activeSetlist = {
    ...activeSetlist,
    items: updatedItems,
    updatedAt: new Date().toISOString(),
  };
  emitChange();
}

/**
 * 슬라이드 삭제
 */
export function removeSlideFromSong(
  songIndex: number,
  slideIndex: number,
): void {
  const item = activeSetlist.items[songIndex];
  if (!item || !item.deck || item.deck.slides.length <= 1) return;

  const slides = item.deck.slides.filter((_, idx) => idx !== slideIndex);
  const reorderedSlides = slides.map((s, idx) => ({ ...s, order: idx }));

  const updatedDeck: Deck = {
    ...item.deck,
    slides: reorderedSlides,
    updatedAt: new Date().toISOString(),
  };

  const updatedItems = [...activeSetlist.items];
  updatedItems[songIndex] = { ...item, deck: updatedDeck };

  activeSetlist = {
    ...activeSetlist,
    items: updatedItems,
    updatedAt: new Date().toISOString(),
  };
  emitChange();
}

/**
 * 슬라이드 복제
 */
export function duplicateSlide(songIndex: number, slideIndex: number): void {
  const item = activeSetlist.items[songIndex];
  if (!item || !item.deck || !item.deck.slides[slideIndex]) return;

  const targetSlide = item.deck.slides[slideIndex];
  addSlideToSong(songIndex, [...targetSlide.lines], slideIndex);
}

/**
 * 곡 순서 재정렬 (드래그/버튼)
 */
export function reorderSongs(fromIndex: number, toIndex: number): void {
  if (
    fromIndex < 0 ||
    fromIndex >= activeSetlist.items.length ||
    toIndex < 0 ||
    toIndex >= activeSetlist.items.length ||
    fromIndex === toIndex
  ) {
    return;
  }

  const items = [...activeSetlist.items];
  const [movedItem] = items.splice(fromIndex, 1);
  items.splice(toIndex, 0, movedItem);

  const reorderedItems = items.map((item, idx) => ({
    ...item,
    order: idx,
  }));

  activeSetlist = {
    ...activeSetlist,
    items: reorderedItems,
    updatedAt: new Date().toISOString(),
  };
  emitChange();
}

/**
 * 곡 삭제
 */
export function removeSongFromSetlist(songIndex: number): void {
  if (songIndex < 0 || songIndex >= activeSetlist.items.length) return;

  const filtered = activeSetlist.items.filter((_, idx) => idx !== songIndex);
  const reorderedItems = filtered.map((item, idx) => ({
    ...item,
    order: idx,
  }));

  activeSetlist = {
    ...activeSetlist,
    items: reorderedItems,
    updatedAt: new Date().toISOString(),
  };
  emitChange();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * React 컴포넌트에서 활성 세트리스트를 반응형으로 구독하는 훅
 */
export function useActiveSetlist(): Setlist {
  return useSyncExternalStore(subscribe, getActiveSetlist, getActiveSetlist);
}
