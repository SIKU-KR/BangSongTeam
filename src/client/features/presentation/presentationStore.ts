import { useSyncExternalStore } from "react";
import type { Deck, Presentation, PresentationItem, Slide } from "#shared";
import {
  createId,
  createSlideId,
  mergeSlideLines,
  splitLinesAtCursor,
} from "#shared";
import {
  savePresentation,
  loadAllPresentations,
  deletePresentation,
  reportPersistenceError,
  clearPersistenceError,
  reportCorruptedRecords,
} from "../../lib/storage";
import { getCurrentUserId } from "../../lib/auth/sessionStore";
import {
  scheduleDocumentPush,
  cancelDocumentPush,
} from "../../lib/sync/syncScheduler";
import { getServiceBackgrounds } from "../backgrounds/backgroundCatalog";

interface PresentationStoreState {
  byId: Record<string, Presentation>;
  order: string[];
  activeId: string;
}

function createEmptyState(): PresentationStoreState {
  return { byId: {}, order: [], activeId: "" };
}

const EMPTY_PRESENTATION: Presentation = Object.freeze({
  id: "",
  userId: "",
  title: "",
  serviceDate: new Date().toISOString().slice(0, 10),
  items: [],
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
}) as Presentation;

function buildListSnapshot(s: PresentationStoreState): Presentation[] {
  return s.order.map((id) => s.byId[id]).filter(Boolean);
}

let state: PresentationStoreState = createEmptyState();
let listSnapshot: Presentation[] = buildListSnapshot(state);
const listeners = new Set<() => void>();

function readActive(): Presentation {
  return state.byId[state.activeId] ?? EMPTY_PRESENTATION;
}

/**
 * 링크로 공유받은 세트(`access`)는 보기 전용이다. 편집 함수는 모두
 * `writeActive`·`pushHistory`·`updateDocumentById`를 거치므로 여기서 막으면
 * 화면에서 버튼을 빠뜨려도 문서가 바뀌지 않는다.
 */
export function canEditPresentation(doc: Presentation): boolean {
  return doc.access === undefined;
}

function writeActive(next: Presentation): void {
  if (!canEditPresentation(readActive())) return;
  state = {
    ...state,
    byId: { ...state.byId, [state.activeId]: next },
  };
  listSnapshot = buildListSnapshot(state);
}

interface DocumentHistory {
  undo: string[];
  redo: string[];
}

const histories = new Map<string, DocumentHistory>();
const MAX_HISTORY = 100;
const COALESCE_WINDOW_MS = 1000;

let lastPush: { docId: string; key: string; at: number } | null = null;

function historyFor(id: string): DocumentHistory {
  let history = histories.get(id);
  if (!history) {
    history = { undo: [], redo: [] };
    histories.set(id, history);
  }
  return history;
}

function pushHistory(coalesceKey?: string): void {
  if (!canEditPresentation(readActive())) return;
  const now = Date.now();
  if (
    coalesceKey &&
    lastPush &&
    lastPush.docId === state.activeId &&
    lastPush.key === coalesceKey &&
    now - lastPush.at < COALESCE_WINDOW_MS
  ) {
    lastPush.at = now;
    return;
  }
  lastPush = coalesceKey
    ? { docId: state.activeId, key: coalesceKey, at: now }
    : null;

  const history = historyFor(state.activeId);
  history.undo.push(JSON.stringify(readActive()));
  if (history.undo.length > MAX_HISTORY) {
    history.undo.shift();
  }
  history.redo.length = 0;
}

/**
 * 되돌리기 묶음을 끊는다. 슬라이더를 끌거나 가사를 입력하는 동안의 연속 변경은
 * 같은 키로 1초 안에 들어오면 한 단계로 묶이는데, 편집 시작·종료처럼 사용자가
 * 한 동작을 마쳤다고 볼 수 있는 시점에 호출해 다음 변경을 새 단계로 만든다.
 */
export function breakHistoryCoalescing(): void {
  lastPush = null;
}

export function canUndo(): boolean {
  return (histories.get(state.activeId)?.undo.length ?? 0) > 0;
}

export function canRedo(): boolean {
  return (histories.get(state.activeId)?.redo.length ?? 0) > 0;
}

function withCurrentPlacement(
  snapshot: Presentation,
  current: Presentation,
): Presentation {
  const next: Presentation = { ...snapshot };
  delete next.folderId;
  delete next.trashedAt;
  if (current.folderId !== undefined) next.folderId = current.folderId;
  if (current.trashedAt !== undefined) next.trashedAt = current.trashedAt;
  return next;
}

export function undo(): boolean {
  lastPush = null;
  const history = historyFor(state.activeId);
  const prevSerialized = history.undo.pop();
  if (!prevSerialized) return false;
  const current = readActive();
  history.redo.push(JSON.stringify(current));
  writeActive(
    withCurrentPlacement(JSON.parse(prevSerialized) as Presentation, current),
  );
  emitChange();
  return true;
}

export function redo(): boolean {
  lastPush = null;
  const history = historyFor(state.activeId);
  const nextSerialized = history.redo.pop();
  if (!nextSerialized) return false;
  const current = readActive();
  history.undo.push(JSON.stringify(current));
  writeActive(
    withCurrentPlacement(JSON.parse(nextSerialized) as Presentation, current),
  );
  emitChange();
  return true;
}

const PERSIST_DEBOUNCE_MS = 300;

let persistenceEnabled = false;
let pendingIds = new Set<string>();
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> = Promise.resolve();

async function writeDocuments(ids: string[]): Promise<void> {
  let failed = false;
  for (const id of ids) {
    const doc = state.byId[id];
    if (!doc) continue;
    try {
      await savePresentation(doc);
    } catch (err) {
      failed = true;
      reportPersistenceError(err);
    }
  }
  if (!failed && ids.length > 0) {
    clearPersistenceError();
  }
}

function runPendingWrites(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (pendingIds.size === 0) return;

  const ids = [...pendingIds];
  pendingIds = new Set();
  inFlight = inFlight.then(() => writeDocuments(ids));
}

function schedulePersist(id: string = state.activeId): void {
  if (!persistenceEnabled) return;
  if (!id) return;
  pendingIds.add(id);
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(runPendingWrites, PERSIST_DEBOUNCE_MS);
}

/**
 * IndexedDB는 비동기라 언로드 시점의 완료를 보장할 수 없어, 디바운스를 300ms로
 * 짧게 유지하고 창이 숨겨질 때 타이머를 앞당기는 방식을 쓴다.
 */
export async function flushPendingWrites(): Promise<void> {
  runPendingWrites();
  await inFlight;
}

function repairDuplicateDeckIds(documents: Presentation[]): {
  documents: Presentation[];
  repairedIds: string[];
} {
  const repairedIds: string[] = [];

  const repaired = documents.map((doc) => {
    const seen = new Set<string>();
    let changed = false;

    const items = doc.items.map((item) => {
      const deck = item.deck;
      if (!deck) return item;

      if (!seen.has(deck.id)) {
        seen.add(deck.id);
        if (item.deckId === deck.id) return item;
        changed = true;
        return { ...item, deckId: deck.id };
      }

      changed = true;
      const newId = createId();
      seen.add(newId);
      return {
        ...item,
        deckId: newId,
        deck: { ...deck, id: newId, forkedFrom: deck.forkedFrom ?? deck.id },
      };
    });

    if (!changed) return doc;
    repairedIds.push(doc.id);
    return { ...doc, items };
  });

  return { documents: repaired, repairedIds };
}

export async function hydrateFromStorage(): Promise<void> {
  persistenceEnabled = false;
  const userId = getCurrentUserId();

  try {
    const { valid, corrupted } = await loadAllPresentations();
    reportCorruptedRecords(corrupted);

    const mine = userId
      ? valid.filter(
          (doc) => doc.userId === userId || doc.access?.memberId === userId,
        )
      : [];
    const sorted = [...mine].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    const { documents, repairedIds } = repairDuplicateDeckIds(sorted);

    state = {
      byId: Object.fromEntries(documents.map((doc) => [doc.id, doc])),
      order: documents.map((doc) => doc.id),
      activeId: documents[0]?.id ?? "",
    };
    listSnapshot = buildListSnapshot(state);
    histories.clear();
    lastPush = null;
    emitChange();

    persistenceEnabled = true;
    clearPersistenceError();

    for (const id of repairedIds) {
      const repaired = state.byId[id];
      if (repaired) await savePresentation(repaired).catch(() => {});
    }
  } catch (err) {
    persistenceEnabled = false;
    reportPersistenceError(err);
  }
}

/** 메모리 상태 제거는 호출자 책임이다. */
export async function removePersistedPresentation(id: string): Promise<void> {
  try {
    await deletePresentation(id);
  } catch (err) {
    reportPersistenceError(err);
  }
}

export function resetPersistenceForTests(): void {
  persistenceEnabled = false;
  pendingIds = new Set();
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  inFlight = Promise.resolve();
}

/**
 * 활성 문서는 가능하면 유지한다. 동기화가 돌았다고 사용자가 보던 세트가
 * 바뀌면 편집 중에 화면이 튄다.
 */
export function applyServerDocuments(documents: Presentation[]): void {
  const previousActive = state.activeId;
  state = {
    byId: Object.fromEntries(documents.map((doc) => [doc.id, doc])),
    order: documents.map((doc) => doc.id),
    activeId: documents.some((doc) => doc.id === previousActive)
      ? previousActive
      : (documents[0]?.id ?? ""),
  };
  listSnapshot = buildListSnapshot(state);
  for (const listener of listeners) listener();
}

/**
 * 저장은 하지 않는다 (저장까지 원하면 저장소에 심고 hydrateFromStorage()를 부른다).
 */
export function __loadDocumentsForTests(documents: Presentation[]): void {
  const copies = documents.map(
    (doc) => JSON.parse(JSON.stringify(doc)) as Presentation,
  );
  state = {
    byId: Object.fromEntries(copies.map((doc) => [doc.id, doc])),
    order: copies.map((doc) => doc.id),
    activeId: copies[0]?.id ?? "",
  };
  listSnapshot = buildListSnapshot(state);
  histories.clear();
  lastPush = null;
  for (const listener of listeners) listener();
}

function emitChange(): void {
  schedulePersist();
  scheduleServerPush();
  for (const listener of listeners) {
    listener();
  }
}

function scheduleServerPush(): void {
  const active = state.byId[state.activeId];
  if (active) scheduleDocumentPush(active);
}

export function getActivePresentation(): Presentation {
  return readActive();
}

function cloneDeckForPresentation(deck: Deck, presentationId: string): Deck {
  const now = new Date().toISOString();
  return {
    ...(JSON.parse(JSON.stringify(deck)) as Deck),
    id: createId(),
    userId: getCurrentUserId() ?? deck.userId,
    scope: "presentation",
    presentationId,
    forkedFrom: deck.scope === "library" ? deck.id : (deck.forkedFrom ?? null),
    visibility: "private",
    forkCount: 0,
    publishedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 덱은 항상 이 세트 전용 복제본으로 들어간다 (Clone-on-Add).
 *
 * 배경이 없는 곡에는 기본 제공 배경을 곡 순서대로 돌려 입힌다. 곡 전환을 배경
 * 교체로 구분하기 때문이다 (제목 슬라이드가 없다). 기본 제공 배경이 하나도 없으면
 * 배경 없이 넣는다.
 */
export function addDeckToPresentation(deck: Deck): PresentationItem {
  pushHistory();
  const active = readActive();
  const currentCount = active.items.length;
  const serviceBackgrounds = getServiceBackgrounds();
  const assignedBackgroundId =
    deck.backgroundId ||
    (serviceBackgrounds.length > 0
      ? serviceBackgrounds[currentCount % serviceBackgrounds.length].id
      : null);

  const resolvedDeck: Deck = {
    ...cloneDeckForPresentation(deck, active.id),
    backgroundId: assignedBackgroundId,
  };

  const newItem: PresentationItem = {
    id: createId(),
    presentationId: active.id,
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

export function resetPresentationStore(): void {
  resetPersistenceForTests();
  histories.clear();
  lastPush = null;
  state = createEmptyState();
  listSnapshot = buildListSnapshot(state);
  emitChange();
}

const draftTitleFormat = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * pushHistory()를 호출하지 않는 것은 의도적이다 — 문서 추가는 "현재 문서의 편집"이
 * 아니므로, 기록하면 canUndo()가 허위로 true가 되어 유령 undo가 생긴다. `folderId`는
 * 드라이브에서 지금 보고 있는 폴더다 (없으면 루트). 제목을 생략하면 만든 시각
 * ("2026. 9. 25. 오후 3:42")이 초안 제목이 된다.
 */
export function createNewPresentation(
  title?: string,
  folderId: string | null = null,
): Presentation {
  const createdAt = new Date();
  const now = createdAt.toISOString();
  const created: Presentation = {
    id: createId(),
    userId: getCurrentUserId() ?? readActive().userId,
    title: title ?? draftTitleFormat.format(createdAt),
    serviceDate: now.slice(0, 10),
    items: [],
    folderId,
    trashedAt: null,
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

export function getPresentationById(
  id: string | undefined,
): Presentation | undefined {
  return id ? state.byId[id] : undefined;
}

/**
 * 캐시된 안정적 스냅샷을 반환한다. 매 호출마다 새 배열을 만들면 useSyncExternalStore가
 * "getSnapshot should be cached" 무한 루프로 터진다.
 */
export function listPresentations(): Presentation[] {
  return listSnapshot;
}

export function getActivePresentationId(): string {
  return state.activeId;
}

export function openPresentation(id: string): boolean {
  if (!state.byId[id]) return false;
  if (state.activeId === id) return true;
  lastPush = null;
  state = { ...state, activeId: id };
  listSnapshot = buildListSnapshot(state);
  emitChange();
  return true;
}

export function updatePresentationTitle(title: string): void {
  pushHistory();
  writeActive({
    ...readActive(),
    title,
    updatedAt: new Date().toISOString(),
  });
  emitChange();
}

/** 연속 입력을 되돌리기 한 단계로 묶을 때 쓰는 키 (`breakHistoryCoalescing` 참고) */
export interface HistoryOptions {
  coalesceKey?: string;
}

/**
 * 곡 서식을 바꾼다. 서식은 곡 단위라 곡의 모든 슬라이드에 적용된다. 값이 그대로면
 * 되돌리기 기록도 남기지 않는다.
 */
export function updateSongStyle(
  songIndex: number,
  styleUpdate: Partial<Deck["style"]>,
  options: HistoryOptions = {},
): void {
  const item = readActive().items[songIndex];
  if (!item || !item.deck) return;

  const style: Deck["style"] = {
    ...item.deck.style,
    ...styleUpdate,
    position: {
      ...item.deck.style.position,
      ...(styleUpdate.position ?? {}),
    },
  };
  if (JSON.stringify(style) === JSON.stringify(item.deck.style)) return;

  pushHistory(options.coalesceKey);

  const updatedDeck: Deck = {
    ...item.deck,
    style,
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
 * 세트 곡의 제목·아티스트만 바꾼다. 세트 곡은 보관함 원본의 복제본이라 원본은
 * 그대로 두며, 원본은 곡 추가 창의 내 보관함에서 따로 고친다.
 */
export function updateSongInfo(
  songIndex: number,
  info: { title: string; artist: string },
): void {
  const item = readActive().items[songIndex];
  if (!item || !item.deck) return;
  if (item.deck.title === info.title && item.deck.artist === info.artist) {
    return;
  }

  pushHistory();

  const updatedDeck: Deck = {
    ...item.deck,
    title: info.title,
    artist: info.artist,
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

export function updateSongBackground(
  songIndex: number,
  backgroundId: string | null,
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

/** 슬라이드 가사를 바꾼다. 값이 그대로면 되돌리기 기록도 남기지 않는다. */
export function updateSlideLines(
  songIndex: number,
  slideIndex: number,
  lines: string[],
  options: HistoryOptions = {},
): void {
  const item = readActive().items[songIndex];
  if (!item || !item.deck) return;

  const slides = [...item.deck.slides];
  if (!slides[slideIndex]) return;
  if (JSON.stringify(slides[slideIndex].lines) === JSON.stringify(lines)) {
    return;
  }

  pushHistory(options.coalesceKey);

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
    id: createSlideId(),
    order: insertAt,
    lines,
  };

  slides.splice(insertAt, 0, newSlide);

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
 * 한 곡에서 여러 슬라이드를 한 번에 지운다(되돌리기 한 단계). 곡에는 슬라이드가
 * 한 장 이상 남아야 하므로, 모두 지우게 되면 아무것도 하지 않고 `false`를 돌려준다.
 */
export function removeSlides(
  songIndex: number,
  slideIndexes: readonly number[],
): boolean {
  const slides = readActive().items[songIndex]?.deck?.slides;
  if (!slides) return false;
  const targets = new Set(
    slideIndexes.filter((index) => index >= 0 && index < slides.length),
  );
  if (targets.size === 0 || targets.size >= slides.length) return false;

  pushHistory();
  replaceSongSlides(
    songIndex,
    slides.filter((_, index) => !targets.has(index)),
  );
  return true;
}

/**
 * 한 곡 안에서 여러 슬라이드를 순서를 지킨 채 한 덩어리로 옮긴다.
 * `insertBefore`는 옮기기 전 목록 기준의 틈 번호(0 = 맨 앞, length = 맨 뒤)다.
 * 순서가 그대로면 되돌리기 기록도 남기지 않는다.
 */
export function moveSlides(
  songIndex: number,
  slideIndexes: readonly number[],
  insertBefore: number,
): void {
  const slides = readActive().items[songIndex]?.deck?.slides;
  if (!slides) return;
  const targets = new Set(
    slideIndexes.filter((index) => index >= 0 && index < slides.length),
  );
  if (targets.size === 0) return;

  const at = Math.max(0, Math.min(insertBefore, slides.length));
  const moving = slides.filter((_, index) => targets.has(index));
  const before = slides.filter((_, index) => index < at && !targets.has(index));
  const after = slides.filter((_, index) => index >= at && !targets.has(index));
  const next = [...before, ...moving, ...after];
  if (next.every((slide, index) => slide === slides[index])) return;

  pushHistory();
  replaceSongSlides(songIndex, next);
}

/** 가사 목록으로 새 슬라이드들을 `atIndex` 자리에 넣는다(붙여넣기). 새 id를 받는다. */
export function insertSlides(
  songIndex: number,
  atIndex: number,
  linesList: readonly string[][],
): void {
  const slides = readActive().items[songIndex]?.deck?.slides;
  if (!slides || linesList.length === 0) return;

  pushHistory();
  const at = Math.max(0, Math.min(atIndex, slides.length));
  const inserted: Slide[] = linesList.map((lines, offset) => ({
    id: createSlideId(),
    order: at + offset,
    lines: [...lines],
  }));
  replaceSongSlides(songIndex, [
    ...slides.slice(0, at),
    ...inserted,
    ...slides.slice(at),
  ]);
}

/** 여러 슬라이드를 한 덩어리로 복제해 마지막 슬라이드 뒤에 넣는다. */
export function duplicateSlides(
  songIndex: number,
  slideIndexes: readonly number[],
): void {
  const slides = readActive().items[songIndex]?.deck?.slides;
  if (!slides) return;
  const sorted = [...new Set(slideIndexes)]
    .filter((index) => index >= 0 && index < slides.length)
    .sort((a, b) => a - b);
  if (sorted.length === 0) return;

  insertSlides(
    songIndex,
    sorted[sorted.length - 1] + 1,
    sorted.map((index) => slides[index].lines),
  );
}

function replaceSongSlides(songIndex: number, slides: Slide[]): void {
  const item = readActive().items[songIndex];
  if (!item || !item.deck) return;

  const updatedDeck: Deck = {
    ...item.deck,
    slides: slides.map((s, idx) => ({ ...s, order: idx })),
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
 * 가사 편집창의 커서 위치에서 슬라이드를 둘로 나눈다. 앞부분은 기존 슬라이드
 * id를 유지하고 뒷부분은 새 슬라이드로 바로 뒤에 들어간다. 커서가 맨 앞·맨
 * 끝이라 한쪽이 비면 아무것도 하지 않고 `false`를 돌려준다.
 */
export function splitSlideAtCursor(
  songIndex: number,
  slideIndex: number,
  offset: number,
): boolean {
  const slides = readActive().items[songIndex]?.deck?.slides;
  const target = slides?.[slideIndex];
  if (!slides || !target) return false;

  const parts = splitLinesAtCursor(target.lines, offset);
  if (!parts) return false;

  pushHistory();

  const next = [...slides];
  next.splice(
    slideIndex,
    1,
    { ...target, lines: parts[0] },
    { id: createSlideId(), order: slideIndex + 1, lines: parts[1] },
  );
  replaceSongSlides(songIndex, next);
  return true;
}

/**
 * 슬라이드를 다음 슬라이드와 합친다. 합친 줄 수가 슬라이드 최대 줄 수를 넘거나
 * 다음 슬라이드가 없으면 아무것도 하지 않고 `false`를 돌려준다.
 */
export function mergeSlideWithNext(
  songIndex: number,
  slideIndex: number,
): boolean {
  const slides = readActive().items[songIndex]?.deck?.slides;
  const target = slides?.[slideIndex];
  const following = slides?.[slideIndex + 1];
  if (!slides || !target || !following) return false;

  const lines = mergeSlideLines(target.lines, following.lines);
  if (!lines) return false;

  pushHistory();

  const next = [...slides];
  next.splice(slideIndex, 2, { ...target, lines });
  replaceSongSlides(songIndex, next);
  return true;
}

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

export function duplicateSongInPresentation(songIndex: number): Deck | null {
  const item = readActive().items[songIndex];
  if (!item || !item.deck) return null;

  pushHistory();

  const originalDeck = item.deck;
  const clonedDeck: Deck = {
    ...JSON.parse(JSON.stringify(originalDeck)),
    id: createId(),
    title: `${originalDeck.title} (사본)`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const newItem: PresentationItem = {
    id: createId(),
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

const MAX_TITLE_LENGTH = 100;
const COPY_SUFFIX = " (사본)";

function updateDocumentById(
  id: string,
  update: (doc: Presentation) => Presentation,
): Presentation | undefined {
  const current = state.byId[id];
  if (!current || !canEditPresentation(current)) return undefined;
  const next = update(current);
  state = { ...state, byId: { ...state.byId, [id]: next } };
  listSnapshot = buildListSnapshot(state);
  notifyDocument(next);
  return next;
}

function notifyDocument(doc: Presentation): void {
  schedulePersist(doc.id);
  scheduleDocumentPush(doc);
  for (const listener of listeners) listener();
}

/** `folderId`가 `null`이면 루트로 옮긴다. */
export function movePresentation(id: string, folderId: string | null): void {
  updateDocumentById(id, (doc) =>
    (doc.folderId ?? null) === folderId
      ? doc
      : { ...doc, folderId, updatedAt: new Date().toISOString() },
  );
}

/**
 * 빈 이름은 무시하고 100자로 자른다. 편집기 헤더의 제목 수정은 편집 기록을
 * 남기는 `updatePresentationTitle`을 쓴다.
 */
export function renamePresentation(id: string, title: string): void {
  const trimmed = title.trim().slice(0, MAX_TITLE_LENGTH);
  if (!trimmed) return;
  updateDocumentById(id, (doc) =>
    doc.title === trimmed
      ? doc
      : { ...doc, title: trimmed, updatedAt: new Date().toISOString() },
  );
}

/** 휴지통으로 보낸다. 폴더 배치는 그대로 두어 복원 시 제자리로 돌아간다 */
export function trashPresentation(id: string): void {
  updateDocumentById(id, (doc) => {
    if (doc.trashedAt) return doc;
    const now = new Date().toISOString();
    return { ...doc, trashedAt: now, updatedAt: now };
  });
}

/**
 * 휴지통에서 복원한다. 돌아갈 폴더는 호출자가 정한다 — 원래 폴더가 없거나
 * 휴지통에 있으면 루트다 (폴더 트리는 드라이브 기능 모듈이 안다).
 */
export function restorePresentation(id: string, folderId: string | null): void {
  updateDocumentById(id, (doc) =>
    doc.trashedAt
      ? {
          ...doc,
          folderId,
          trashedAt: null,
          updatedAt: new Date().toISOString(),
        }
      : doc,
  );
}

/**
 * 사본 만들기. "제목 (사본)"으로 `folderId`(생략하면 원본과 같은 폴더)에 만든다.
 *
 * 항목·덱 id를 모두 새로 발급한다. 덱 id가 원본과 같으면 서버의 `decks` 기본키를
 * 위반해 사본이 영영 저장되지 않는다 (Clone-on-Add와 같은 이유로 `createId()`).
 *
 * 공유받은 세트의 사본은 내 소유의 독립 문서다. 원본의 폴더는 소유자의
 * 드라이브라 쓰지 않고, 위치를 따로 주지 않으면 내 드라이브 맨 위에 둔다.
 */
export function duplicatePresentation(
  id: string,
  folderId?: string | null,
): Presentation | null {
  const source = state.byId[id];
  if (!source) return null;

  const shared = source.access !== undefined;
  const userId = shared ? (getCurrentUserId() ?? source.userId) : source.userId;
  const now = new Date().toISOString();
  const newId = createId();
  const items = source.items.map((item) => {
    const deckId = createId();
    return {
      ...item,
      id: createId(),
      presentationId: newId,
      deckId,
      deck: item.deck
        ? {
            ...(JSON.parse(JSON.stringify(item.deck)) as Deck),
            id: deckId,
            userId,
            presentationId: newId,
            createdAt: now,
            updatedAt: now,
          }
        : undefined,
    };
  });

  const copy: Presentation = {
    ...source,
    id: newId,
    userId,
    title: `${source.title.slice(0, MAX_TITLE_LENGTH - COPY_SUFFIX.length)}${COPY_SUFFIX}`,
    items,
    folderId:
      folderId !== undefined
        ? folderId
        : shared
          ? null
          : (source.folderId ?? null),
    trashedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  delete copy.access;

  state = {
    ...state,
    byId: { ...state.byId, [newId]: copy },
    order: [...state.order, newId],
  };
  listSnapshot = buildListSnapshot(state);
  notifyDocument(copy);
  return copy;
}

/**
 * 공유받은 세트를 서버본으로 넣거나 바꾼다 (링크로 들어옴·최신본 받기).
 * 보기 전용이라 다시 push하지 않는다.
 */
export function replaceWithServerDocument(doc: Presentation): void {
  const exists = Boolean(state.byId[doc.id]);
  state = {
    ...state,
    byId: { ...state.byId, [doc.id]: doc },
    order: exists ? state.order : [...state.order, doc.id],
  };
  listSnapshot = buildListSnapshot(state);
  schedulePersist(doc.id);
  for (const listener of listeners) listener();
}

/**
 * 영구 삭제가 끝난 문서를 메모리와 저장소에서 지운다.
 *
 * 서버 삭제가 성공한 뒤에만 부른다. 대기 중인 로컬 저장·서버 push도 취소한다 —
 * 늦게 도착한 push가 서버에서 문서를 되살리면 안 된다.
 */
export async function removePresentationsLocally(
  ids: readonly string[],
): Promise<void> {
  const removed = new Set(ids.filter((id) => state.byId[id]));
  if (removed.size === 0) return;

  const byId = { ...state.byId };
  for (const id of removed) {
    delete byId[id];
    histories.delete(id);
    pendingIds.delete(id);
    cancelDocumentPush(id);
  }
  const order = state.order.filter((id) => !removed.has(id));
  state = {
    byId,
    order,
    activeId: removed.has(state.activeId) ? (order[0] ?? "") : state.activeId,
  };
  listSnapshot = buildListSnapshot(state);
  for (const listener of listeners) listener();

  for (const id of removed) {
    await removePersistedPresentation(id);
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useActivePresentation(): Presentation {
  return useSyncExternalStore(
    subscribe,
    getActivePresentation,
    getActivePresentation,
  );
}

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
