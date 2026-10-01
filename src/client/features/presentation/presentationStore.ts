import { useSyncExternalStore } from "react";
import type { Deck, Presentation, PresentationItem, Slide } from "#shared";
import {
  MAX_PRESENTATION_TITLE_LENGTH,
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
import { PRESENTATION_COPY } from "#copy/presentation";
import { COMMON_COPY } from "#copy/common";
import {
  breakHistoryCoalescing,
  canRedoDocument,
  canUndoDocument,
  clearHistory,
  recordHistory,
  takeRedo,
  takeUndo,
} from "./presentationHistory";
import {
  buildPresentationCopy,
  cloneDeck,
  forkDeckIntoPresentation,
  repairDuplicateDeckIds,
  withCurrentPlacement,
} from "./presentationDocument";

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

function commit(next: PresentationStoreState): void {
  state = next;
  listSnapshot = buildListSnapshot(state);
}

function notifyListeners(): void {
  for (const listener of listeners) listener();
}

function readActive(): Presentation {
  return state.byId[state.activeId] ?? EMPTY_PRESENTATION;
}

/**
 * 링크로 공유받은 프레젠테이션(`access`)은 보기 전용이다. 편집 함수는 모두
 * `writeActive`·`pushHistory`·`updateDocumentById`를 거치므로 여기서 막으면
 * 화면에서 버튼을 빠뜨려도 문서가 바뀌지 않는다.
 */
export function canEditPresentation(doc: Presentation): boolean {
  return doc.access === undefined;
}

function writeActive(next: Presentation): void {
  if (!canEditPresentation(readActive())) return;
  commit({
    ...state,
    byId: { ...state.byId, [state.activeId]: next },
  });
}

function pushHistory(coalesceKey?: string): void {
  const active = readActive();
  if (!canEditPresentation(active)) return;
  recordHistory(state.activeId, active, coalesceKey);
}

export { breakHistoryCoalescing };

export function canUndo(): boolean {
  return canUndoDocument(state.activeId);
}

export function canRedo(): boolean {
  return canRedoDocument(state.activeId);
}

export function undo(): boolean {
  const current = readActive();
  const previous = takeUndo(state.activeId, current);
  if (!previous) return false;
  writeActive(withCurrentPlacement(previous, current));
  emitChange();
  return true;
}

export function redo(): boolean {
  const current = readActive();
  const next = takeRedo(state.activeId, current);
  if (!next) return false;
  writeActive(withCurrentPlacement(next, current));
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

    commit({
      byId: Object.fromEntries(documents.map((doc) => [doc.id, doc])),
      order: documents.map((doc) => doc.id),
      activeId: documents[0]?.id ?? "",
    });
    clearHistory();
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

function resetPersistenceForTests(): void {
  persistenceEnabled = false;
  pendingIds = new Set();
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  inFlight = Promise.resolve();
}

/**
 * 활성 문서는 가능하면 유지한다. 동기화가 돌았다고 사용자가 보던 프레젠테이션이
 * 바뀌면 편집 중에 화면이 튄다.
 */
export function applyServerDocuments(documents: Presentation[]): void {
  const previousActive = state.activeId;
  commit({
    byId: Object.fromEntries(documents.map((doc) => [doc.id, doc])),
    order: documents.map((doc) => doc.id),
    activeId: documents.some((doc) => doc.id === previousActive)
      ? previousActive
      : (documents[0]?.id ?? ""),
  });
  notifyListeners();
}

/**
 * 저장은 하지 않는다 (저장까지 원하면 저장소에 심고 hydrateFromStorage()를 부른다).
 */
export function __loadDocumentsForTests(documents: Presentation[]): void {
  const copies = documents.map(
    (doc) => JSON.parse(JSON.stringify(doc)) as Presentation,
  );
  commit({
    byId: Object.fromEntries(copies.map((doc) => [doc.id, doc])),
    order: copies.map((doc) => doc.id),
    activeId: copies[0]?.id ?? "",
  });
  clearHistory();
  notifyListeners();
}

function emitChange(): void {
  const active = state.byId[state.activeId];
  if (active) {
    notifyDocument(active);
  } else {
    notifyListeners();
  }
}

function notifyDocument(doc: Presentation): void {
  schedulePersist(doc.id);
  scheduleDocumentPush(doc);
  notifyListeners();
}

export function getActivePresentation(): Presentation {
  return readActive();
}

function reindexOrder<T extends { order: number }>(list: readonly T[]): T[] {
  return list.map((entry, idx) => ({ ...entry, order: idx }));
}

function writeActiveItems(
  items: PresentationItem[],
  now: string = new Date().toISOString(),
): void {
  writeActive({
    ...readActive(),
    items,
    updatedAt: now,
  });
  emitChange();
}

function readSongSlides(songIndex: number): Slide[] | undefined {
  return readActive().items[songIndex]?.deck?.slides;
}

function writeSongDeck(songIndex: number, changes: Partial<Deck>): void {
  const items = [...readActive().items];
  const item = items[songIndex];
  if (!item || !item.deck) return;

  const now = new Date().toISOString();
  items[songIndex] = {
    ...item,
    deck: { ...item.deck, ...changes, updatedAt: now },
  };
  writeActiveItems(items, now);
}

/**
 * 덱은 항상 이 프레젠테이션 전용 복제본으로 들어간다 (Clone-on-Add).
 *
 * 배경이 없는 곡에는 기본 제공 배경을 곡 순서대로 돌려 입힌다. 곡 전환을 배경
 * 교체로 구분하기 때문이다 (제목 슬라이드가 없다). 사용자가 단색을 고른 곡과,
 * 기본 제공 배경이 하나도 없을 때는 그대로 넣는다.
 */
export function addDeckToPresentation(deck: Deck): PresentationItem {
  pushHistory();
  const active = readActive();
  const currentCount = active.items.length;
  const serviceBackgrounds = getServiceBackgrounds();
  const assignedBackgroundId =
    deck.backgroundId ||
    (!deck.style.backgroundColor && serviceBackgrounds.length > 0
      ? serviceBackgrounds[currentCount % serviceBackgrounds.length].id
      : null);

  const now = new Date().toISOString();
  const resolvedDeck: Deck = {
    ...forkDeckIntoPresentation(
      deck,
      active.id,
      getCurrentUserId() ?? deck.userId,
      now,
    ),
    backgroundId: assignedBackgroundId,
  };

  const newItem: PresentationItem = {
    id: createId(),
    presentationId: active.id,
    deckId: resolvedDeck.id,
    order: currentCount,
    deck: resolvedDeck,
  };

  writeActiveItems([...readActive().items, newItem], now);
  return newItem;
}

export function resetPresentationStore(): void {
  resetPersistenceForTests();
  clearHistory();
  commit(createEmptyState());
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
  commit({
    byId: { ...state.byId, [created.id]: created },
    order: [...state.order, created.id],
    activeId: created.id,
  });
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
  breakHistoryCoalescing();
  commit({ ...state, activeId: id });
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

interface HistoryOptions {
  coalesceKey?: string;
}

/**
 * 곡 서식을 바꾼다. 서식은 곡 단위라 곡의 모든 슬라이드에 적용된다. 값이 그대로면
 * 되돌리기 기록도 남기지 않는다. `coalesceKey`가 같은 연속 변경은 되돌리기 한
 * 단계로 묶인다 (`breakHistoryCoalescing` 참고).
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
  writeSongDeck(songIndex, { style });
}

/**
 * 프레젠테이션 곡의 제목·아티스트만 바꾼다. 프레젠테이션 곡은 보관함 원본의
 * 복제본이라 원본은 그대로 두며, 원본은 곡 추가 창의 내 보관함에서 따로 고친다.
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
  writeSongDeck(songIndex, { title: info.title, artist: info.artist });
}

/** 곡 배경으로 고를 수 있는 것: 배경 갤러리의 영상·이미지, 또는 단색 */
export type BackgroundChoice = { backgroundId: string } | { color: string };

/** 단색을 고르면 배경 영상·이미지를 빼고 서식의 단색을 바꾼다. 되돌리기는 한 번에 된다 */
export function updateSongBackground(
  songIndex: number,
  choice: BackgroundChoice,
): void {
  const item = readActive().items[songIndex];
  if (!item || !item.deck) return;

  pushHistory();
  writeSongDeck(
    songIndex,
    "color" in choice
      ? {
          backgroundId: null,
          style: { ...item.deck.style, backgroundColor: choice.color },
        }
      : { backgroundId: choice.backgroundId },
  );
}

/**
 * 슬라이드 가사를 바꾼다. 값이 그대로면 되돌리기 기록도 남기지 않는다.
 * `coalesceKey`가 같은 연속 입력은 되돌리기 한 단계로 묶인다.
 */
export function updateSlideLines(
  songIndex: number,
  slideIndex: number,
  lines: string[],
  options: HistoryOptions = {},
): void {
  const current = readSongSlides(songIndex);
  if (!current) return;

  const slides = [...current];
  if (!slides[slideIndex]) return;
  if (JSON.stringify(slides[slideIndex].lines) === JSON.stringify(lines)) {
    return;
  }

  pushHistory(options.coalesceKey);

  slides[slideIndex] = {
    ...slides[slideIndex],
    lines,
  };
  writeSongDeck(songIndex, { slides });
}

export function addSlideToSong(
  songIndex: number,
  lines: string[] = [PRESENTATION_COPY.newSlidePlaceholder],
  afterIndex?: number,
): void {
  const current = readSongSlides(songIndex);
  if (!current) return;

  pushHistory();

  const slides = [...current];
  const insertAt = afterIndex !== undefined ? afterIndex + 1 : slides.length;
  slides.splice(insertAt, 0, {
    id: createSlideId(),
    order: insertAt,
    lines,
  });
  replaceSongSlides(songIndex, slides);
}

/**
 * 한 곡에서 여러 슬라이드를 한 번에 지운다(되돌리기 한 단계). 곡에는 슬라이드가
 * 한 장 이상 남아야 하므로, 모두 지우게 되면 아무것도 하지 않고 `false`를 돌려준다.
 */
export function removeSlides(
  songIndex: number,
  slideIndexes: readonly number[],
): boolean {
  const slides = readSongSlides(songIndex);
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
  const slides = readSongSlides(songIndex);
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
  const slides = readSongSlides(songIndex);
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
  const slides = readSongSlides(songIndex);
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
  writeSongDeck(songIndex, { slides: reindexOrder(slides) });
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
  const slides = readSongSlides(songIndex);
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
  const slides = readSongSlides(songIndex);
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
  writeActiveItems(reindexOrder(items));
}

export function removeSongFromPresentation(songIndex: number): void {
  if (songIndex < 0 || songIndex >= readActive().items.length) return;

  pushHistory();
  writeActiveItems(
    reindexOrder(readActive().items.filter((_, idx) => idx !== songIndex)),
  );
}

export function duplicateSongInPresentation(songIndex: number): Deck | null {
  const item = readActive().items[songIndex];
  if (!item || !item.deck) return null;

  pushHistory();

  const now = new Date().toISOString();
  const originalDeck = item.deck;
  const clonedDeck: Deck = {
    ...cloneDeck(originalDeck),
    id: createId(),
    title: `${originalDeck.title}${COMMON_COPY.copySuffix}`,
    createdAt: now,
    updatedAt: now,
  };

  const newItem: PresentationItem = {
    id: createId(),
    presentationId: readActive().id,
    deckId: clonedDeck.id,
    order: songIndex + 1,
    deck: clonedDeck,
  };

  const items = [...readActive().items];
  items.splice(songIndex + 1, 0, newItem);
  writeActiveItems(reindexOrder(items), now);
  return clonedDeck;
}

function updateDocumentById(
  id: string,
  update: (doc: Presentation) => Presentation,
): Presentation | undefined {
  const current = state.byId[id];
  if (!current || !canEditPresentation(current)) return undefined;
  const next = update(current);
  commit({ ...state, byId: { ...state.byId, [id]: next } });
  notifyDocument(next);
  return next;
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
 * 빈 이름은 무시하고 최대 길이로 자른다. 편집기 헤더의 제목 수정은 편집 기록을
 * 남기는 `updatePresentationTitle`을 쓴다.
 */
export function renamePresentation(id: string, title: string): void {
  const trimmed = title.trim().slice(0, MAX_PRESENTATION_TITLE_LENGTH);
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
 * 공유받은 프레젠테이션의 사본은 내 소유의 독립 문서다. 원본의 폴더는 소유자의
 * 드라이브라 쓰지 않고, 위치를 따로 주지 않으면 내 드라이브 맨 위에 둔다.
 */
export function duplicatePresentation(
  id: string,
  folderId?: string | null,
): Presentation | null {
  const source = state.byId[id];
  if (!source) return null;

  const shared = source.access !== undefined;
  const copy = buildPresentationCopy(source, {
    userId: shared ? (getCurrentUserId() ?? source.userId) : source.userId,
    folderId:
      folderId !== undefined
        ? folderId
        : shared
          ? null
          : (source.folderId ?? null),
    now: new Date().toISOString(),
  });

  commit({
    ...state,
    byId: { ...state.byId, [copy.id]: copy },
    order: [...state.order, copy.id],
  });
  notifyDocument(copy);
  return copy;
}

/**
 * 공유받은 프레젠테이션을 서버본으로 넣거나 바꾼다 (링크로 들어옴·최신본 받기).
 * 보기 전용이라 다시 push하지 않는다.
 */
export function replaceWithServerDocument(doc: Presentation): void {
  putSharedDocument(doc);
  schedulePersist(doc.id);
}

/**
 * 로그인 없이 링크로 보는 프레젠테이션을 메모리에만 넣는다.
 *
 * 저장소에 쓰지 않는다. 로그아웃 뒤에는 저장이 켜져 있을 수 있는데, 그대로
 * 두면 소유자 id가 달린 보기 전용 문서가 남아 소유자가 이 브라우저에서
 * 로그인할 때 자기 프레젠테이션을 보기 전용으로 읽게 된다.
 */
export function showSharedPreview(doc: Presentation): void {
  putSharedDocument(doc);
}

function putSharedDocument(doc: Presentation): void {
  const exists = Boolean(state.byId[doc.id]);
  commit({
    ...state,
    byId: { ...state.byId, [doc.id]: doc },
    order: exists ? state.order : [...state.order, doc.id],
  });
  notifyListeners();
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
    clearHistory(id);
    pendingIds.delete(id);
    cancelDocumentPush(id);
  }
  const order = state.order.filter((id) => !removed.has(id));
  commit({
    byId,
    order,
    activeId: removed.has(state.activeId) ? (order[0] ?? "") : state.activeId,
  });
  notifyListeners();

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
