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
