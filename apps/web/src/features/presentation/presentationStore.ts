import { useSyncExternalStore } from "react";
import type { Deck, Presentation, PresentationItem } from "@repo/shared";
import { INITIAL_BACKGROUNDS } from "@repo/shared";
import { SEED_PRESENTATIONS, SEED_USER_ID } from "./mockPresentations";

/** 멀티 문서 컬렉션 상태 */
interface PresentationStoreState {
  /** 문서 id -> 프레젠테이션 */
  byId: Record<string, Presentation>;
  /** 표시 순서 (생성 순서 유지, 정렬은 읽는 쪽에서 수행) */
  order: string[];
  /** 현재 열려 있는 문서 id */
  activeId: string;
}

function createSeedState(): PresentationStoreState {
  const seeds = SEED_PRESENTATIONS.map(
    (seed) => JSON.parse(JSON.stringify(seed)) as Presentation,
  );
  return {
    byId: Object.fromEntries(seeds.map((seed) => [seed.id, seed])),
    order: seeds.map((seed) => seed.id),
    activeId: seeds[0].id,
  };
}

function buildListSnapshot(s: PresentationStoreState): Presentation[] {
  return s.order.map((id) => s.byId[id]).filter(Boolean);
}

let state: PresentationStoreState = createSeedState();
/**
 * listPresentations()가 매 호출마다 새 배열을 만들면 useSyncExternalStore가
 * "getSnapshot should be cached" 무한 루프로 터지므로, state 교체 시에만 재계산한다.
 */
let listSnapshot: Presentation[] = buildListSnapshot(state);
const listeners = new Set<() => void>();

/** 활성 문서 읽기 (내부 전용) */
function readActive(): Presentation {
  return state.byId[state.activeId];
}

/**
 * 활성 문서 교체 — emit은 호출자(각 뮤테이터 말미의 emitChange)가 수행한다.
 * 기존 뮤테이터의 pushHistory / early-return 순서를 그대로 보존하기 위함.
 */
function writeActive(next: Presentation): void {
  state = {
    ...state,
    byId: { ...state.byId, [state.activeId]: next },
  };
  listSnapshot = buildListSnapshot(state);
}

// ----------------------------------------------------------------------------
// 문서별 Undo/Redo 히스토리
// 전역 스택을 쓰면 "문서 A 편집 -> B로 이동 -> Cmd+Z" 시 A의 스냅샷이 B 슬롯에
// 덮어써지므로, 문서가 주소 가능해진 이상 히스토리도 문서에 종속시킨다.
// ----------------------------------------------------------------------------
interface DocumentHistory {
  undo: string[];
  redo: string[];
}

const histories = new Map<string, DocumentHistory>();
const MAX_HISTORY = 25;

function historyFor(id: string): DocumentHistory {
  let history = histories.get(id);
  if (!history) {
    history = { undo: [], redo: [] };
    histories.set(id, history);
  }
  return history;
}

function pushHistory(): void {
  const history = historyFor(state.activeId);
  history.undo.push(JSON.stringify(readActive()));
  if (history.undo.length > MAX_HISTORY) {
    history.undo.shift();
  }
  history.redo.length = 0;
}

export function canUndo(): boolean {
  return (histories.get(state.activeId)?.undo.length ?? 0) > 0;
}

export function canRedo(): boolean {
  return (histories.get(state.activeId)?.redo.length ?? 0) > 0;
}

export function undo(): boolean {
  const history = historyFor(state.activeId);
  const prevSerialized = history.undo.pop();
  if (!prevSerialized) return false;
  history.redo.push(JSON.stringify(readActive()));
  writeActive(JSON.parse(prevSerialized) as Presentation);
  emitChange();
  return true;
}

export function redo(): boolean {
  const history = historyFor(state.activeId);
  const nextSerialized = history.redo.pop();
  if (!nextSerialized) return false;
  history.undo.push(JSON.stringify(readActive()));
  writeActive(JSON.parse(nextSerialized) as Presentation);
  emitChange();
  return true;
}

function emitChange(): void {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * 현재 활성 프레젠테이션 반환
 */
export function getActivePresentation(): Presentation {
  return readActive();
}

/**
 * 인메모리 프레젠테이션에 신규 덱을 추가하고 모든 구독자에게 알림 (M1 실시간 연동)
 */
export function addDeckToPresentation(deck: Deck): PresentationItem {
  pushHistory();
  const currentCount = readActive().items.length;
  // backgroundId가 없으면 10개 초기 배경 중 순환 할당
  const assignedBackgroundId =
    deck.backgroundId ||
    INITIAL_BACKGROUNDS[currentCount % INITIAL_BACKGROUNDS.length].id;

  const resolvedDeck: Deck = {
    ...deck,
    backgroundId: assignedBackgroundId,
  };

  const newItem: PresentationItem = {
    id: crypto.randomUUID(),
    presentationId: readActive().id,
    deckId: resolvedDeck.id,
    order: currentCount,
    deck: resolvedDeck,
  };

  writeActive({
    ...readActive(),
    items: [...readActive().items, newItem],
    updatedAt: new Date().toISOString(),
  });

  emitChange();
  return newItem;
}

/**
 * 테스트 격리 전용: 컬렉션 전체를 시드 상태로 되돌리고 모든 히스토리를 비운다.
 */
export function resetPresentationStore(): void {
  histories.clear();
  state = createSeedState();
  listSnapshot = buildListSnapshot(state);
  emitChange();
}

/**
 * 현재 활성 문서만 시드 내용으로 복원 (에디터 '기본 찬양 세트 복원' 메뉴).
 * 시드가 아닌 사용자 생성 문서라면 빈 프레젠테이션으로 초기화한다.
 * 컬렉션 전체를 날리지 않으므로 URL의 presentationId가 고아가 되지 않는다.
 */
export function resetActivePresentation(): void {
  const id = state.activeId;
  const seed = SEED_PRESENTATIONS.find((candidate) => candidate.id === id);
  const restored: Presentation = seed
    ? (JSON.parse(JSON.stringify(seed)) as Presentation)
    : { ...readActive(), items: [], updatedAt: new Date().toISOString() };
  histories.delete(id);
  writeActive(restored);
  emitChange();
}

/**
 * 신규 빈 프레젠테이션을 컬렉션에 추가하고 활성 문서로 전환한다.
 * 기존 문서는 보존된다 (멀티 문서 전환).
 *
 * pushHistory()를 호출하지 않는 것은 의도적이다 — 문서 추가는 "현재 문서의 편집"이
 * 아니므로, 기록하면 canUndo()가 허위로 true가 되어 유령 undo가 생긴다.
 *
 * 호출자는 반환된 id로 /editor/:presentationId 로 이동해야 한다.
 */
export function createNewPresentation(title = "새 프레젠테이션"): Presentation {
  const now = new Date().toISOString();
  const created: Presentation = {
    id: crypto.randomUUID(),
    userId: readActive()?.userId || SEED_USER_ID,
    title,
    serviceDate: now.slice(0, 10),
    items: [],
    createdAt: now,
    updatedAt: now,
  };
  state = {
    byId: { ...state.byId, [created.id]: created },
    order: [...state.order, created.id],
    activeId: created.id,
  };
  listSnapshot = buildListSnapshot(state);
  emitChange();
  return created;
}

/**
 * id로 프레젠테이션 조회 (없으면 undefined)
 */
export function getPresentationById(
  id: string | undefined,
): Presentation | undefined {
  return id ? state.byId[id] : undefined;
}

/**
 * 전체 프레젠테이션 목록 (캐시된 안정적 스냅샷)
 */
export function listPresentations(): Presentation[] {
  return listSnapshot;
}

/**
 * 현재 활성 문서 id
 */
export function getActivePresentationId(): string {
  return state.activeId;
}

/**
 * 활성 문서를 전환한다. 존재하지 않는 id면 아무것도 바꾸지 않고 false를 반환.
 */
export function openPresentation(id: string): boolean {
  if (!state.byId[id]) return false;
  if (state.activeId === id) return true;
  state = { ...state, activeId: id };
  listSnapshot = buildListSnapshot(state);
  emitChange();
  return true;
}

/**
 * 프레젠테이션 제목 변경
 */
export function updatePresentationTitle(title: string): void {
  pushHistory();
  writeActive({
    ...readActive(),
    title,
    updatedAt: new Date().toISOString(),
  });
  emitChange();
}

/**
 * 곡 스타일(DeckStyle) 부분 업데이트
 */
export function updateSongStyle(
  songIndex: number,
  styleUpdate: Partial<Deck["style"]>,
): void {
  const item = readActive().items[songIndex];
  if (!item || !item.deck) return;

  pushHistory();

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

  const updatedItems = [...readActive().items];
  updatedItems[songIndex] = { ...item, deck: updatedDeck };

  writeActive({
    ...readActive(),
    items: updatedItems,
    updatedAt: new Date().toISOString(),
  });
  emitChange();
}

/**
 * 곡 배경 영상 변경
 */
export function updateSongBackground(
  songIndex: number,
  backgroundId: string,
): void {
  const item = readActive().items[songIndex];
  if (!item || !item.deck) return;

  pushHistory();

  const updatedDeck: Deck = {
    ...item.deck,
    backgroundId,
    updatedAt: new Date().toISOString(),
  };

  const updatedItems = [...readActive().items];
  updatedItems[songIndex] = { ...item, deck: updatedDeck };

  writeActive({
    ...readActive(),
    items: updatedItems,
    updatedAt: new Date().toISOString(),
  });
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
  const item = readActive().items[songIndex];
  if (!item || !item.deck) return;

  const slides = [...item.deck.slides];
  if (!slides[slideIndex]) return;

  pushHistory();

  slides[slideIndex] = {
    ...slides[slideIndex],
    lines,
  };

  const updatedDeck: Deck = {
    ...item.deck,
    slides,
    updatedAt: new Date().toISOString(),
  };

  const updatedItems = [...readActive().items];
  updatedItems[songIndex] = { ...item, deck: updatedDeck };

  writeActive({
    ...readActive(),
    items: updatedItems,
    updatedAt: new Date().toISOString(),
  });
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
  const item = readActive().items[songIndex];
  if (!item || !item.deck) return;

  pushHistory();

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

  const updatedItems = [...readActive().items];
  updatedItems[songIndex] = { ...item, deck: updatedDeck };

  writeActive({
    ...readActive(),
    items: updatedItems,
    updatedAt: new Date().toISOString(),
  });
  emitChange();
}

/**
 * 슬라이드 삭제
 */
export function removeSlideFromSong(
  songIndex: number,
  slideIndex: number,
): void {
  const item = readActive().items[songIndex];
  if (!item || !item.deck || item.deck.slides.length <= 1) return;

  pushHistory();

  const slides = item.deck.slides.filter((_, idx) => idx !== slideIndex);
  const reorderedSlides = slides.map((s, idx) => ({ ...s, order: idx }));

  const updatedDeck: Deck = {
    ...item.deck,
    slides: reorderedSlides,
    updatedAt: new Date().toISOString(),
  };

  const updatedItems = [...readActive().items];
  updatedItems[songIndex] = { ...item, deck: updatedDeck };

  writeActive({
    ...readActive(),
    items: updatedItems,
    updatedAt: new Date().toISOString(),
  });
  emitChange();
}

/**
 * 슬라이드 복제
 */
export function duplicateSlide(songIndex: number, slideIndex: number): void {
  const item = readActive().items[songIndex];
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
    fromIndex >= readActive().items.length ||
    toIndex < 0 ||
    toIndex >= readActive().items.length ||
    fromIndex === toIndex
  ) {
    return;
  }

  pushHistory();

  const items = [...readActive().items];
  const [movedItem] = items.splice(fromIndex, 1);
  items.splice(toIndex, 0, movedItem);

  const reorderedItems = items.map((item, idx) => ({
    ...item,
    order: idx,
  }));

  writeActive({
    ...readActive(),
    items: reorderedItems,
    updatedAt: new Date().toISOString(),
  });
  emitChange();
}

/**
 * 곡 삭제
 */
export function removeSongFromPresentation(songIndex: number): void {
  if (songIndex < 0 || songIndex >= readActive().items.length) return;

  pushHistory();

  const filtered = readActive().items.filter((_, idx) => idx !== songIndex);
  const reorderedItems = filtered.map((item, idx) => ({
    ...item,
    order: idx,
  }));

  writeActive({
    ...readActive(),
    items: reorderedItems,
    updatedAt: new Date().toISOString(),
  });
  emitChange();
}

/**
 * 프레젠테이션 내 곡 복제
 */
export function duplicateSongInPresentation(songIndex: number): Deck | null {
  const item = readActive().items[songIndex];
  if (!item || !item.deck) return null;

  pushHistory();

  const originalDeck = item.deck;
  const clonedDeck: Deck = {
    ...JSON.parse(JSON.stringify(originalDeck)),
    id: `deck_${crypto.randomUUID().slice(0, 8)}`,
    title: `${originalDeck.title} (사본)`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const newItem: PresentationItem = {
    id: crypto.randomUUID(),
    presentationId: readActive().id,
    deckId: clonedDeck.id,
    order: songIndex + 1,
    deck: clonedDeck,
  };

  const updatedItems = [...readActive().items];
  updatedItems.splice(songIndex + 1, 0, newItem);
  const reorderedItems = updatedItems.map((it, idx) => ({ ...it, order: idx }));

  writeActive({
    ...readActive(),
    items: reorderedItems,
    updatedAt: new Date().toISOString(),
  });
  emitChange();
  return clonedDeck;
}

/**
 * 곡 내 슬라이드 순서 재정렬
 */
export function reorderSlides(
  songIndex: number,
  fromSlideIndex: number,
  toSlideIndex: number,
): void {
  const item = readActive().items[songIndex];
  if (!item || !item.deck) return;
  const slides = [...item.deck.slides];
  if (
    fromSlideIndex < 0 ||
    fromSlideIndex >= slides.length ||
    toSlideIndex < 0 ||
    toSlideIndex >= slides.length ||
    fromSlideIndex === toSlideIndex
  ) {
    return;
  }

  pushHistory();

  const [movedSlide] = slides.splice(fromSlideIndex, 1);
  slides.splice(toSlideIndex, 0, movedSlide);

  const reorderedSlides = slides.map((s, idx) => ({ ...s, order: idx }));

  const updatedDeck: Deck = {
    ...item.deck,
    slides: reorderedSlides,
    updatedAt: new Date().toISOString(),
  };

  const updatedItems = [...readActive().items];
  updatedItems[songIndex] = { ...item, deck: updatedDeck };

  writeActive({
    ...readActive(),
    items: updatedItems,
    updatedAt: new Date().toISOString(),
  });
  emitChange();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * React 컴포넌트에서 활성 프레젠테이션을 반응형으로 구독하는 훅
 */
export function useActivePresentation(): Presentation {
  return useSyncExternalStore(
    subscribe,
    getActivePresentation,
    getActivePresentation,
  );
}

/**
 * 전체 프레젠테이션 목록을 반응형으로 구독하는 훅 (홈 대시보드용)
 */
export function usePresentationList(): Presentation[] {
  return useSyncExternalStore(subscribe, listPresentations, listPresentations);
}

/**
 * 특정 id의 프레젠테이션을 반응형으로 구독하는 훅 (/editor/:presentationId 용).
 * 활성 문서가 아니라 URL의 id를 직접 읽으므로 첫 프레임부터 올바른 문서가 렌더된다.
 */
export function usePresentationById(
  id: string | undefined,
): Presentation | undefined {
  const getSnapshot = (): Presentation | undefined =>
    id ? state.byId[id] : undefined;
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
