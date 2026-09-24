import { useSyncExternalStore } from "react";
import type { Deck, Presentation, PresentationItem } from "#shared";
import { createId, createSlideId } from "#shared";
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
import { mockDecks } from "./mockPresentation";

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

function writeActive(next: Presentation): void {
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

    const mine = userId ? valid.filter((doc) => doc.userId === userId) : [];
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
 * 붙여넣기로 바로 세트에 넣은 곡처럼 보관함 원본이 없던 곡을 공개하면, 편집기가
 * 새 보관함 덱을 만들고 이 함수로 연결한다. 다음 공개·'공개본 업데이트'는 같은
 * 원본을 갱신한다. 내용은 바꾸지 않으므로 되돌리기 기록을 남기지 않는다.
 */
export function linkSongToLibraryDeck(
  songIndex: number,
  libraryDeckId: string,
): void {
  const item = readActive().items[songIndex];
  if (!item || !item.deck) return;
  if (item.deck.forkedFrom === libraryDeckId) return;

  const updatedItems = [...readActive().items];
  updatedItems[songIndex] = {
    ...item,
    deck: { ...item.deck, forkedFrom: libraryDeckId },
  };
  writeActive({
    ...readActive(),
    items: updatedItems,
    updatedAt: new Date().toISOString(),
  });
  emitChange();
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
  state = createEmptyState();
  listSnapshot = buildListSnapshot(state);
  emitChange();
}

/**
 * 예전에는 같은 버튼이 `resetActivePresentation()`을 불러 세트를 비웠다 — 라벨과
 * 정반대였다. 샘플 덱은 `MOCK_USER_ID`/`MOCK_PRESENTATION_ID`를 물고 있어 복제 없이
 * 넣으면 소유권이 꼬이고, 두 번 누르면 `deck.id`가 겹쳐 저장이 깨지므로 일반 곡
 * 추가와 같은 Clone-on-Add 경로를 탄다.
 */
export function loadSampleSongsIntoActivePresentation(): PresentationItem[] {
  if (!state.activeId) return [];
  return mockDecks.map((deck) => addDeckToPresentation(deck));
}

/**
 * pushHistory()를 호출하지 않는 것은 의도적이다 — 문서 추가는 "현재 문서의 편집"이
 * 아니므로, 기록하면 canUndo()가 허위로 true가 되어 유령 undo가 생긴다. `folderId`는
 * 드라이브에서 지금 보고 있는 폴더다 (없으면 루트).
 */
export function createNewPresentation(
  title = "새 프레젠테이션",
  folderId: string | null = null,
): Presentation {
  const now = new Date().toISOString();
  const created: Presentation = {
    id: createId(),
    userId: getCurrentUserId() ?? readActive().userId,
    title,
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

export function duplicateSlide(songIndex: number, slideIndex: number): void {
  const item = readActive().items[songIndex];
  if (!item || !item.deck || !item.deck.slides[slideIndex]) return;

  const targetSlide = item.deck.slides[slideIndex];
  addSlideToSong(songIndex, [...targetSlide.lines], slideIndex);
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

const MAX_TITLE_LENGTH = 100;
const COPY_SUFFIX = " (사본)";

function updateDocumentById(
  id: string,
  update: (doc: Presentation) => Presentation,
): Presentation | undefined {
  const current = state.byId[id];
  if (!current) return undefined;
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
 * 사본 만들기. 같은 폴더에 "제목 (사본)"으로 만든다.
 *
 * 항목·덱 id를 모두 새로 발급한다. 덱 id가 원본과 같으면 서버의 `decks` 기본키를
 * 위반해 사본이 영영 저장되지 않는다 (Clone-on-Add와 같은 이유로 `createId()`).
 */
export function duplicatePresentation(id: string): Presentation | null {
  const source = state.byId[id];
  if (!source) return null;

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
    title: `${source.title.slice(0, MAX_TITLE_LENGTH - COPY_SUFFIX.length)}${COPY_SUFFIX}`,
    items,
    folderId: source.folderId ?? null,
    trashedAt: null,
    createdAt: now,
    updatedAt: now,
  };

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
