import { useSyncExternalStore } from "react";
import type { Deck, Presentation, PresentationItem, Slide } from "#shared";
import {
  MAX_DECK_TITLE_LENGTH,
  MAX_PRESENTATION_TITLE_LENGTH,
  appendWithinLimit,
  clampText,
  createId,
  cycleItem,
  createSlideId,
  laterThan,
  mergeSlideLines,
  splitLinesAtCursor,
} from "#shared";
import {
  savePresentation,
  savePresentationIfUnchanged,
  saveSharedPresentation,
  loadAllPresentations,
  loadPresentation,
  deletePresentation,
  deleteSharedPresentation,
  reportPersistenceError,
  clearPersistenceError,
  reportCorruptedRecords,
  createWriteRetry,
  type LoadedRecord,
  type WriteOp,
} from "../../lib/storage";
import { announceStorageChange } from "../../lib/storage/storageChannel";
import { getCurrentUserId } from "../../lib/auth/sessionStore";
import {
  scheduleDocumentPush,
  cancelDocumentPush,
  isDocumentQueued,
} from "../../lib/sync/syncScheduler";
import {
  confirmVersion,
  contentFingerprint,
  forgetLineage,
  noteOwnVersion,
  resetLineage,
} from "../../lib/sync/presentationLineage";
import { getBackgrounds } from "../backgrounds/backgroundCatalog";
import { isProjecting } from "./fullscreen";
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
  hasUnsyncedEdits,
  isSyncedWithServer,
  repairDuplicateDeckIds,
  withCurrentPlacement,
  withEditStamp,
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
  return s.order.map((id) => s.byId[id]).filter((doc) => doc !== undefined);
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
  const current = readActive();
  if (!canEditPresentation(current)) return;
  commit({
    ...state,
    byId: { ...state.byId, [state.activeId]: withEditStamp(current, next) },
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

/**
 * 되돌리기. 되돌린 판도 새 편집이라 수정 시각은 기록의 옛 시각이 아니라 지금 판보다 뒤로 찍는다
 * (`withEditStamp`). 옛 시각으로 올리면 그사이의 판을 이미 받은 다른 기기가 다음 부팅 병합에서
 * 자기 판이 더 새롭다고 보고, 되돌린 내용을 모든 기기에서 다시 되돌린다.
 */
export function undo(): boolean {
  const current = readActive();
  const previous = takeUndo(state.activeId, current);
  if (!previous) return false;
  writeActive(withCurrentPlacement(previous, current));
  emitChange();
  return true;
}

/** 다시 하기. `undo`처럼 수정 시각을 지금 판보다 뒤로 찍는다. */
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
const writingIds = new Map<string, number>();
const skippedReloads = new Set<string>();
const repairedVersions = new Map<string, Presentation>();
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> = Promise.resolve();

type PresentationWriteOp = WriteOp | "deleteShared";

const writeRetry = createWriteRetry<PresentationWriteOp>(
  "presentation",
  (failed) => {
    if (!persistenceEnabled) {
      writeRetry.reset();
      return;
    }
    for (const [id, op] of failed) retryFailedWrite(id, op);
    runPendingWrites();
  },
);

function retryFailedWrite(id: string, op: PresentationWriteOp): void {
  if (state.byId[id]) {
    pendingIds.add(id);
    return;
  }
  if (op === "save") {
    writeRetry.succeeded(id);
    return;
  }
  inFlight = inFlight.then(() =>
    op === "deleteShared"
      ? removePersistedSharedPresentation(id)
      : removePersistedPresentation(id),
  );
}

function markWriting(ids: readonly string[]): void {
  for (const id of ids) writingIds.set(id, (writingIds.get(id) ?? 0) + 1);
}

function doneWriting(id: string): void {
  const remaining = (writingIds.get(id) ?? 1) - 1;
  if (remaining > 0) writingIds.set(id, remaining);
  else writingIds.delete(id);
}

function hasUnpersistedWrite(id: string): boolean {
  return pendingIds.has(id) || writingIds.has(id) || writeRetry.has(id);
}

async function writeDocument(
  doc: Presentation,
  repaired: boolean,
): Promise<boolean> {
  if (repaired) return savePresentationIfUnchanged(doc);
  await (doc.access ? saveSharedPresentation(doc) : savePresentation(doc));
  return true;
}

async function writeDocuments(ids: string[]): Promise<void> {
  const written: string[] = [];
  const superseded: string[] = [];
  for (const id of ids) {
    const doc = state.byId[id];
    const repaired = doc !== undefined && repairedVersions.get(id) === doc;
    repairedVersions.delete(id);
    try {
      if (!doc) {
        writeRetry.succeeded(id, "save");
        continue;
      }
      if (!(await writeDocument(doc, repaired))) {
        superseded.push(id);
        writeRetry.succeeded(id);
        continue;
      }
      written.push(id);
      writeRetry.succeeded(id);
      if (!doc.access) {
        noteOwnVersion(doc);
        skippedReloads.delete(id);
      }
    } catch (err) {
      if (repaired) repairedVersions.set(id, doc);
      writeRetry.failed(id, "save", err);
    } finally {
      doneWriting(id);
    }
  }
  announceStorageChange("presentations", written);
  for (const id of superseded) {
    skippedReloads.add(id);
    if (!isProjecting()) void reloadSkippedRecord(id);
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
  markWriting(ids);
  inFlight = inFlight.then(() => writeDocuments(ids));
}

function schedulePersist(id: string): void {
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

/**
 * 저장본으로 세션 사용자의 프레젠테이션을 싣는다.
 *
 * 싣기는 편집이 아니라서 열린 세트를 서버에 올리지 않는다. 계정을 바꾼 뒤 큐가 켜져 있으면
 * 병합도 하기 전에 새 계정의 세트를 올리게 된다.
 *
 * 싣다가 고친 세트(글 한도에 맞춰 줄인 판, 중복 덱 id를 고친 판)는 `updatedAt`을 그대로 두고 저장
 * 줄로 다시 써서, 실패하면 경고를 올리고 백오프 뒤에 다시 쓴다. 시각을 올리면 줄인 판이 다른 기기의
 * 온전한 판을 이긴다. 고친 그 객체가 메모리에 그대로 있는 동안에는 다시 쓸 때도 저장본이 읽은 판
 * 그대로일 때만 쓰고(`savePresentationIfUnchanged`), 그사이 다른 탭(이전 버전의 탭 포함)이 고쳐
 * 썼으면 덮지 않고 그 저장본을 다시 싣는다. 그 전에 고친 세트는 고친 판을 그대로 저장한다. 다른
 * 계정의 저장본은 싣지 않으므로 다시 쓰지도 않는다.
 *
 * 읽으면서 보관본에서 되살린 프레젠테이션(`loadAllPresentations`의 `restoredIds`)은 싣고 나서 다른
 * 탭에 알린다. 되살리기는 저장 줄 밖의 쓰기라, 알리지 않으면 다른 탭이 되살리기 전 판을 메모리에 든
 * 채 다음 편집으로 덮고, 보관본은 이미 지워져 되살린 판을 잃는다. 알림에는 세션 사용자 id가 붙으므로
 * 이 탭이 실은 프레젠테이션만 알린다.
 *
 * 읽지 못하면 메모리를 비우고 저장을 끈다. 앞 계정의 세트가 남으면 다음 병합이 그 세트를 새
 * 계정에 올리고, 저장을 켜 두면 읽지 못한 저장본을 병합 결과로 덮는다. 그 경고는 다시 불러올 때까지
 * 남긴다. 다른 저장소가 저장했다고 지우면 세트를 저장하지 않는 동안에도 저장된 줄 알게 된다.
 *
 * 싣기 전에 앞서 실패한 쓰기의 다시 시도와 그 경고를 버린다. 메모리를 저장본으로 새로 채우므로
 * 다시 쓸 사본이 남지 않는다.
 */
export async function hydrateFromStorage(): Promise<void> {
  writeRetry.reset();
  persistenceEnabled = false;
  skippedReloads.clear();
  repairedVersions.clear();
  const userId = getCurrentUserId();

  try {
    const {
      valid,
      corrupted,
      repairedIds: fittedIds,
      restoredIds,
    } = await loadAllPresentations();
    reportCorruptedRecords(corrupted);

    const mine = valid.filter((doc) => isVisibleTo(doc, userId));
    const sorted = [...mine].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    const { documents, repairedIds } = repairDuplicateDeckIds(sorted);

    replaceAll(documents);
    clearHistory();
    notifyListeners();
    announceStorageChange(
      "presentations",
      restoredIds.filter((id) => state.byId[id] !== undefined),
    );

    persistenceEnabled = true;
    clearPersistenceError("presentation:hydrate");

    for (const id of new Set([...repairedIds, ...fittedIds])) {
      const doc = state.byId[id];
      if (!doc) continue;
      repairedVersions.set(id, doc);
      pendingIds.add(id);
    }
    runPendingWrites();
  } catch (err) {
    persistenceEnabled = false;
    replaceAll([]);
    clearHistory();
    notifyListeners();
    reportPersistenceError(err, "presentation:hydrate");
  }
}

function replaceAll(documents: readonly Presentation[]): void {
  for (const id of state.order) forgetLineage(id);
  commit({
    byId: Object.fromEntries(documents.map((doc) => [doc.id, doc])),
    order: documents.map((doc) => doc.id),
    activeId: documents[0]?.id ?? "",
  });
  for (const doc of documents) {
    if (!doc.access) resetLineage(doc);
  }
}

function isVisibleTo(doc: Presentation, userId: string | null): boolean {
  return (
    userId !== null &&
    (doc.userId === userId || doc.access?.memberId === userId)
  );
}

/**
 * 메모리 상태 제거는 호출자 책임이다. 지운 뒤 다른 탭에 알린다. 지우지 못하면 경고를 올리고 백오프
 * 뒤에 다시 지운다. 그사이 그 세트가 메모리에 다시 생기면 지우지 않고 그 세트를 저장한다.
 */
export async function removePersistedPresentation(id: string): Promise<void> {
  try {
    await deletePresentation(id);
    writeRetry.succeeded(id);
    announceStorageChange("presentations", [id]);
  } catch (err) {
    writeRetry.failed(id, "delete", err);
  }
}

/**
 * 공유받은 사본의 저장본을 지운다. 같은 자리에 소유자 자신의 저장본이 있으면 남긴다
 * (`deleteSharedPresentation`). 한 브라우저를 함께 쓰는 소유자의 저장본을 공유받은 사람의 공유
 * 해제·부팅 병합이 지우면 안 된다. 지우지 못해 다시 지울 때도 이 규칙을 따른다. 메모리 상태 제거는
 * 호출자 책임이다.
 */
export async function removePersistedSharedPresentation(
  id: string,
): Promise<void> {
  try {
    await deleteSharedPresentation(id);
    writeRetry.succeeded(id);
    announceStorageChange("presentations", [id]);
  } catch (err) {
    writeRetry.failed(id, "deleteShared", err);
  }
}

function removePersisted(doc: Presentation): Promise<void> {
  return doc.access
    ? removePersistedSharedPresentation(doc.id)
    : removePersistedPresentation(doc.id);
}

function resetPersistenceForTests(): void {
  writeRetry.reset();
  persistenceEnabled = false;
  pendingIds = new Set();
  writingIds.clear();
  skippedReloads.clear();
  repairedVersions.clear();
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  inFlight = Promise.resolve();
}

function isServerChange(
  stored: Presentation | undefined,
  merged: Presentation,
): boolean {
  if (stored === merged) return false;
  return (
    !stored ||
    stored.updatedAt !== merged.updatedAt ||
    (stored.folderId ?? null) !== (merged.folderId ?? null) ||
    stored.access !== undefined ||
    merged.access !== undefined ||
    contentFingerprint(stored) !== contentFingerprint(merged)
  );
}

/**
 * 부팅 병합 결과로 바꾸고, 서버에서 온 변경만 저장 줄로 저장한다. `removedIds`는 다른
 * 기기에서 영구 삭제했거나 공유가 끝난 세트다.
 *
 * 활성 문서는 가능하면 유지한다. 동기화가 돌았다고 사용자가 보던 프레젠테이션이
 * 바뀌면 편집 중에 화면이 튄다.
 *
 * 저장은 새 세트, `updatedAt`이나 `folderId`나 내용이 바뀐 세트, 공유받은 세트, 공유받은 사본이던
 * 세트만 한다. 병합은 같은 판이면 서버 객체를 고르기도 하므로, 객체가 같은지만 보면 동기화된 세트를
 * 부팅마다 모두 다시 쓰고 그 뒤의 편집 저장이 그만큼 늦어진다. `folderId`(서버가 남의 폴더를 루트로
 * 옮김)와 공유받은 세트는 `updatedAt` 없이 바뀐다. 이 브라우저에 공유받은 사람의 사본만 있던 소유자의
 * 세트도 그렇다. 소유자 사본으로 다시 쓰지 않으면 다음 오프라인 부팅에서 소유자가 자기 세트를 다시 보기
 * 전용으로 연다. 시각이 같아도 서버가 내용을 고친 세트(없는 폴더·배경을 비움 등)도 쓴다. 기준 판만
 * 바뀐 세트(서버와 맞춘 판이 된 이전 저장본 등)는 쓰지 않는다. 다음 부팅 병합이 같은 기준 판을 다시
 * 붙이고 다음 편집이나 동기화 결과가 함께 쓴다. 이전 저장본을 모두 다시 쓰면 그 사이 다른 탭이 쓴
 * 저장본을 덮는다. 저장 줄은 쓰는 순간의 세트를 쓰므로 병합 뒤에 고친 내용을 병합 때의 사본으로
 * 덮지 않는다. 읽지 못한 저장본은 덮지 않도록 하이드레이션이 실패했으면 쓰지 않는다.
 *
 * 이렇게 서버에서 바뀐 세트는 되돌리기 기록도 지운다. 기록은 병합 전의 판들이라, 남기면 되돌리기가
 * 다른 기기의 수정을 병합 전 판으로 덮는다. 같은 내용의 서버 객체나 기준 판으로만 바뀐 세트는 같은
 * 판이라 기록을 남긴다. 서버 판으로 내용이 바뀐 세트는 그 판에서 계보를 새로 시작한다.
 *
 * 지운 세트는 되돌리기 기록·대기 중인 저장·서버 push를 버리고, 이미 줄을 선 저장 뒤에 저장본을
 * 지운다. push가 남으면 연결이 돌아올 때 서버에서 되살아나고, 줄을 선 저장이 뒤에 오면 저장본이
 * 되살아난다. 공유받은 세트는 같은 자리에 소유자 자신의 저장본이 없을 때만 쓰고 지운다. 한
 * 브라우저를 함께 쓰는 소유자의 저장본을 공유받은 사람의 병합이 덮거나 지우면 안 된다.
 */
export function applyServerDocuments(
  documents: Presentation[],
  removedIds: readonly string[] = [],
): void {
  const previous = state.byId;
  const previousActive = state.activeId;
  const byId = Object.fromEntries(documents.map((doc) => [doc.id, doc]));
  commit({
    byId,
    order: documents.map((doc) => doc.id),
    activeId: byId[previousActive] ? previousActive : (documents[0]?.id ?? ""),
  });
  const changed = documents.filter((doc) =>
    isServerChange(previous[doc.id], doc),
  );
  const removed = removedIds.filter((id) => !byId[id]);
  for (const doc of changed) {
    const stored = previous[doc.id];
    clearHistory(doc.id);
    if (
      !doc.access &&
      (!stored || contentFingerprint(stored) !== contentFingerprint(doc))
    ) {
      resetLineage(doc);
    }
  }
  for (const id of removed) {
    clearHistory(id);
    forgetLineage(id);
    pendingIds.delete(id);
    cancelDocumentPush(id);
  }
  notifyListeners();

  if (!persistenceEnabled) return;
  for (const doc of changed) pendingIds.add(doc.id);
  runPendingWrites();
  for (const id of removed) {
    const doc = previous[id];
    if (doc) inFlight = inFlight.then(() => removePersisted(doc));
  }
}

/**
 * 저장은 하지 않는다 (저장까지 원하면 저장소에 심고 hydrateFromStorage()를 부른다).
 */
export function __loadDocumentsForTests(documents: Presentation[]): void {
  replaceAll(
    documents.map((doc) => JSON.parse(JSON.stringify(doc)) as Presentation),
  );
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

function writeActiveItems(items: PresentationItem[]): void {
  writeActive({ ...readActive(), items });
  emitChange();
}

function readSongSlides(songIndex: number): Slide[] | undefined {
  return readActive().items[songIndex]?.deck?.slides;
}

function writeSongDeck(songIndex: number, changes: Partial<Deck>): void {
  const items = [...readActive().items];
  const item = items[songIndex];
  if (!item || !item.deck) return;

  items[songIndex] = {
    ...item,
    deck: { ...item.deck, ...changes, updatedAt: new Date().toISOString() },
  };
  writeActiveItems(items);
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
  const rotatedBackground = cycleItem(getBackgrounds(), active.items.length);
  const assignedBackgroundId =
    deck.backgroundId ||
    (!deck.style.backgroundColor && rotatedBackground
      ? rotatedBackground.id
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
    order: active.items.length,
    deck: resolvedDeck,
  };

  writeActiveItems([...readActive().items, newItem]);
  return newItem;
}

export function resetPresentationStore(): void {
  resetPersistenceForTests();
  clearHistory();
  replaceAll([]);
  emitChange();
}

const draftTitleFormat = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * pushHistory()를 호출하지 않는 것은 의도적이다 — 문서 추가는 "현재 문서의 편집"이
 * 아니므로, 기록하면 canUndo()가 허위로 true가 되어 유령 undo가 생긴다. `folderId`는
 * 드라이브에서 지금 보고 있는 폴더다 (없으면 루트). 제목은 만든 시각
 * ("2026. 9. 25. 오후 3:42")이 초안 제목이 된다.
 */
export function createNewPresentation(
  folderId: string | null = null,
): Presentation {
  const createdAt = new Date();
  const now = createdAt.toISOString();
  const created: Presentation = {
    id: createId(),
    userId: getCurrentUserId() ?? readActive().userId,
    title: draftTitleFormat.format(createdAt),
    serviceDate: now.slice(0, 10),
    items: [],
    folderId,
    trashedAt: null,
    createdAt: now,
    updatedAt: now,
    baseUpdatedAt: null,
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

/**
 * 여는 것은 편집이 아니라서 저장도 서버 전송도 하지 않고 구독자에게만 알린다.
 * 서버 PATCH는 문서 전체를 덮어쓰므로, 송출하려고 열기만 해도 올리면 다른 기기에서
 * 추가한 곡이 지워지고 송출 중에 요청이 나간다.
 */
export function openPresentation(id: string): boolean {
  if (!state.byId[id]) return false;
  if (state.activeId === id) return true;
  breakHistoryCoalescing();
  commit({ ...state, activeId: id });
  notifyListeners();
  return true;
}

/**
 * 편집기 헤더에서 고친 제목. 앞뒤 공백을 떼고 제목 한도로 줄이며, 비거나 그대로면 되돌리기
 * 기록도 남기지 않는다.
 *
 * 한도를 넘은 제목은 스키마를 통과하지 못해 그 프레젠테이션이 서버에 올라가지 않고, 다음에
 * 불러올 때 읽지 못한 저장본으로 남는다. 입력 칸의 `maxLength`는 코드로 넣은 값을 막지 못한다.
 */
export function updatePresentationTitle(title: string): void {
  const next = clampText(title.trim(), MAX_PRESENTATION_TITLE_LENGTH);
  if (!next || next === readActive().title) return;
  pushHistory();
  writeActive({ ...readActive(), title: next });
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
  lines: string[],
  afterIndex: number,
): void {
  const current = readSongSlides(songIndex);
  if (!current) return;

  pushHistory();

  const slides = [...current];
  const insertAt = afterIndex + 1;
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
  const selected = new Set(slideIndexes);
  const picked = slides.filter((_, index) => selected.has(index));
  const last = picked.at(-1);
  if (!last) return;

  insertSlides(
    songIndex,
    slides.indexOf(last) + 1,
    picked.map((slide) => slide.lines),
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
  const items = [...readActive().items];
  const movedItem = items[fromIndex];
  if (
    !movedItem ||
    toIndex < 0 ||
    toIndex >= items.length ||
    fromIndex === toIndex
  ) {
    return;
  }

  pushHistory();

  items.splice(fromIndex, 1);
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

/**
 * 곡을 바로 뒤에 복제한다. 사본 제목은 "제목 (사본)"이고, 사본 표시를 붙여도 곡 제목 한도를
 * 넘지 않게 원래 제목을 줄인다. 한도를 넘으면 그 프레젠테이션 전체가 서버에 올라가지 못한다.
 */
export function duplicateSongInPresentation(songIndex: number): Deck | null {
  const item = readActive().items[songIndex];
  if (!item || !item.deck) return null;

  pushHistory();

  const now = new Date().toISOString();
  const originalDeck = item.deck;
  const clonedDeck: Deck = {
    ...cloneDeck(originalDeck),
    id: createId(),
    title: appendWithinLimit(
      originalDeck.title,
      COMMON_COPY.copySuffix,
      MAX_DECK_TITLE_LENGTH,
    ),
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
  writeActiveItems(reindexOrder(items));
  return clonedDeck;
}

function updateDocumentById(
  id: string,
  update: (doc: Presentation) => Presentation,
): Presentation | undefined {
  const current = state.byId[id];
  if (!current || !canEditPresentation(current)) return undefined;
  const next = withEditStamp(current, update(current));
  commit({ ...state, byId: { ...state.byId, [id]: next } });
  notifyDocument(next);
  return next;
}

/** `folderId`가 `null`이면 루트로 옮긴다. */
export function movePresentation(id: string, folderId: string | null): void {
  updateDocumentById(id, (doc) =>
    (doc.folderId ?? null) === folderId ? doc : { ...doc, folderId },
  );
}

/**
 * 빈 이름은 무시하고 최대 길이로 자른다. 편집기 헤더의 제목 수정은 편집 기록을
 * 남기는 `updatePresentationTitle`을 쓴다.
 *
 * 이름이 바뀌면 그 세트의 되돌리기 기록을 지운다. 드라이브에서 바꾼 이름은 편집기의 되돌리기
 * 단계가 아니라, 기록을 남기면 편집기에서 되돌릴 때 기록의 옛 이름으로 돌아간다.
 */
export function renamePresentation(id: string, title: string): void {
  const trimmed = title.trim().slice(0, MAX_PRESENTATION_TITLE_LENGTH);
  if (!trimmed) return;
  const current = state.byId[id];
  const renamed = updateDocumentById(id, (doc) =>
    doc.title === trimmed ? doc : { ...doc, title: trimmed },
  );
  if (renamed && renamed !== current) clearHistory(id);
}

/** 휴지통으로 보낸다. 폴더 배치는 그대로 두어 복원 시 제자리로 돌아간다 */
export function trashPresentation(id: string): void {
  updateDocumentById(id, (doc) =>
    doc.trashedAt ? doc : { ...doc, trashedAt: new Date().toISOString() },
  );
}

/**
 * 휴지통에서 복원한다. 돌아갈 폴더는 호출자가 정한다 — 원래 폴더가 없거나
 * 휴지통에 있으면 루트다 (폴더 트리는 드라이브 기능 모듈이 안다).
 */
export function restorePresentation(id: string, folderId: string | null): void {
  updateDocumentById(id, (doc) =>
    doc.trashedAt ? { ...doc, folderId, trashedAt: null } : doc,
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

function defersSyncOutcome(id: string): boolean {
  if (!skippedReloads.has(id) || hasUnpersistedWrite(id)) return false;
  if (!isProjecting()) void reloadSkippedRecord(id);
  return true;
}

function writeSyncOutcome(next: Presentation): void {
  commit({ ...state, byId: { ...state.byId, [next.id]: next } });
  schedulePersist(next.id);
  notifyListeners();
}

async function reloadSkippedRecord(id: string): Promise<void> {
  const before = state.byId[id];
  let record: LoadedRecord<Presentation>;
  try {
    record = await loadPresentation(id);
  } catch {
    return;
  }
  if (
    state.byId[id] !== before ||
    !skippedReloads.has(id) ||
    hasUnpersistedWrite(id) ||
    isProjecting()
  ) {
    return;
  }
  if (record.status === "missing") {
    if (forgetPresentations([id]).length > 0) notifyListeners();
    return;
  }
  if (
    record.status === "unreadable" ||
    !isVisibleTo(record.value, getCurrentUserId())
  ) {
    return;
  }
  replaceFromStorage(record.value);
  notifyListeners();
}

/**
 * 서버가 받은 판(`sent`)을 확정한다. `stored`는 서버가 남긴 판(응답의 `updatedAt`)이다.
 *
 * 보낸 객체가 아직 지금 판이면 그 판이 서버와 맞춘 판이 된다(수정 시각과 기준 판 모두 `stored`).
 * 그사이 고쳤거나 바뀐 판이면 기준 판만 `stored`로 옮기고 올리지 않은 편집으로 남겨, 수정 시각이
 * 기준 판보다 늦도록 필요하면 `stored` + 1ms로 민다. 같은 밀리초에 고쳤거나 시계가 뒤로 가도 보내지
 * 않은 내용이 맞춘 판으로 보이지 않게, 시각이 아니라 객체가 같은지로 가른다(편집은 늘 새 객체를
 * 만든다). 기준 판은 뒤로 옮기지 않는다. 그사이 더 새 서버 판을 받았으면 아무것도 바꾸지 않는다.
 *
 * 이 탭이 올리기를 기다리느라 다른 탭이 쓴 저장본을 다시 읽지 않고 건너뛰었으면, 그 저장본을 이
 * 탭의 판으로 덮지 않고 다시 읽는다(송출 중에는 그대로 둔다). 그 판은 다른 탭이 올린다.
 */
export function markPresentationSynced(
  id: string,
  sent: Presentation,
  stored: string,
): void {
  const current = state.byId[id];
  if (!current || current.access) return;
  const base = current.baseUpdatedAt;
  if (typeof base === "string" && Date.parse(base) >= Date.parse(stored)) {
    return;
  }
  confirmVersion(sent);
  if (defersSyncOutcome(id)) return;
  writeSyncOutcome(
    current === sent
      ? { ...current, updatedAt: stored, baseUpdatedAt: stored }
      : {
          ...current,
          updatedAt: laterThan(stored, current.updatedAt),
          baseUpdatedAt: stored,
        },
  );
}

/**
 * 412가 돌려준 서버 판이 이 탭이 만든 판일 때, 지금 판을 그 판 위에 다시 얹는다. 기준 판을 `base`로
 * 옮기고 수정 시각을 그보다 늦게 둬, 다시 보낼 올리지 않은 편집으로 남긴다.
 */
export function rebasePresentation(id: string, base: string): void {
  const current = state.byId[id];
  if (!current || current.access) return;
  commit({
    ...state,
    byId: {
      ...state.byId,
      [id]: {
        ...current,
        updatedAt: laterThan(base, current.updatedAt),
        baseUpdatedAt: base,
      },
    },
  });
  schedulePersist(id);
  notifyListeners();
}

/**
 * 서버 판을 그 세트의 지금 판으로 받는다. 기준 판은 그 서버 판이다.
 *
 * 이 탭에 없는 세트나 지금 사용자의 것이 아닌 판은 넣지 않는다. 늦게 온 응답이 지운 세트를
 * 되살리거나, 로그아웃한 앞 계정의 세트를 다음 계정의 드라이브에 넣으면 안 된다. 대기 중인 push는
 * 버린다. 받기 전의 판들인 되돌리기 기록도 버리고, 계보는 그 판에서 새로 시작한다. 저장 줄로 저장해
 * 다른 탭에 알린다.
 *
 * 다른 탭의 저장본을 건너뛰었으면 받지 않고 그 저장본을 다시 읽는다(`markPresentationSynced`). 그때
 * 되돌리기 기록과 계보는 다시 읽기가 바꿀 때까지 그대로 둔다. 읽는 동안 고쳤거나 저장본을 읽지 못해
 * 이 탭의 판이 남았는데 계보만 서버 판에서 시작하면, 다음 412가 그 서버 판을 이 탭이 만든 판으로 보고
 * 그 위에 다시 보내 다른 기기의 수정을 덮는다.
 */
export function adoptServerPresentation(server: Presentation): void {
  const current = state.byId[server.id];
  if (
    !current ||
    current.access ||
    server.access ||
    server.userId !== getCurrentUserId()
  ) {
    return;
  }
  const adopted: Presentation = { ...server, baseUpdatedAt: server.updatedAt };
  cancelDocumentPush(server.id);
  if (defersSyncOutcome(server.id)) return;
  clearHistory(server.id);
  resetLineage(adopted);
  writeSyncOutcome(adopted);
}

/**
 * 이 기기에서 고쳤는데 서버에 올리지 못한 편집이 확실하면(`hasUnsyncedEdits`) 그 판을 새
 * 프레젠테이션 "제목 (사본)"으로 남기고 돌려준다. 같은 폴더·휴지통 자리에 두고 저장하고 올린다.
 * 그런 편집이 없거나 알 수 없으면(기준 판이 없는 이전 저장본) 남기지 않고 `null`이다.
 *
 * 다른 기기와 엇갈렸거나 다른 기기에서 영구 삭제한 세트를 서버 판으로 바꾸거나 지우기 전에 부른다.
 * 그 세트의 id는 공유 링크·멤버·다른 기기가 가리키므로 서버 판이 지니고, 이 기기의 편집은 조용히
 * 잃지 않고 사본으로 남긴다.
 */
export function keepUnsyncedCopy(id: string): Presentation | null {
  const current = state.byId[id];
  if (!current || current.access || !hasUnsyncedEdits(current)) return null;
  const copy = buildPresentationCopy(current, {
    userId: current.userId,
    folderId: current.folderId ?? null,
    trashedAt: current.trashedAt ?? null,
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
 * 다른 기기와 엇갈린 세트(412, 양쪽 다 고침)를 둘 다 지키며 푼다. 이 기기의 올리지 못한 편집은
 * "제목 (사본)"으로 남기고(`keepUnsyncedCopy`), 그 세트는 서버 판을 받는다
 * (`adoptServerPresentation`). 사본을 만들었으면 돌려준다.
 */
export function resolvePresentationConflict(
  server: Presentation,
): Presentation | null {
  const current = state.byId[server.id];
  if (
    !current ||
    current.access ||
    server.access ||
    server.userId !== getCurrentUserId()
  ) {
    return null;
  }
  const copy = keepUnsyncedCopy(server.id);
  adoptServerPresentation(server);
  return copy;
}

/**
 * 공유받은 프레젠테이션을 서버본으로 넣거나 바꾼다 (링크로 들어옴·최신본 받기).
 * 보기 전용이라 다시 push하지 않는다.
 *
 * 저장본은 같은 자리에 소유자 자신의 저장본이 없을 때만 쓴다(`saveSharedPresentation`). 한
 * 브라우저를 소유자와 함께 쓰면 공유받은 사본이 소유자가 아직 올리지 못한 편집을 덮는다.
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
 * 늦게 도착한 push가 서버에서 문서를 되살리면 안 된다. 공유가 끝난 사본은 그 자리에 소유자
 * 자신의 저장본이 없을 때만 저장소에서 지운다(`removePersistedSharedPresentation`).
 */
export async function removePresentationsLocally(
  ids: readonly string[],
): Promise<void> {
  const removed = forgetPresentations(ids);
  if (removed.length === 0) return;
  notifyListeners();

  for (const doc of removed) {
    await removePersisted(doc);
  }
}

function forgetPresentations(ids: readonly string[]): Presentation[] {
  const removed = new Map<string, Presentation>();
  for (const id of ids) {
    const doc = state.byId[id];
    if (doc) removed.set(id, doc);
  }
  if (removed.size === 0) return [];

  const byId = { ...state.byId };
  for (const id of removed.keys()) {
    delete byId[id];
    clearHistory(id);
    forgetLineage(id);
    pendingIds.delete(id);
    skippedReloads.delete(id);
    cancelDocumentPush(id);
  }
  const order = state.order.filter((id) => !removed.has(id));
  commit({
    byId,
    order,
    activeId: removed.has(state.activeId) ? (order[0] ?? "") : state.activeId,
  });
  return [...removed.values()];
}

function replaceFromStorage(doc: Presentation): void {
  const exists = Boolean(state.byId[doc.id]);
  commit({
    ...state,
    byId: { ...state.byId, [doc.id]: doc },
    order: exists ? state.order : [...state.order, doc.id],
  });
  clearHistory(doc.id);
  if (doc.access) forgetLineage(doc.id);
  else resetLineage(doc);
  skippedReloads.delete(doc.id);
}

function isOlderSyncedRecord(
  record: Presentation,
  memory: Presentation | undefined,
): boolean {
  return (
    memory !== undefined &&
    isSyncedWithServer(memory) &&
    isSyncedWithServer(record) &&
    Date.parse(record.updatedAt) < Date.parse(memory.updatedAt)
  );
}

/**
 * 다른 탭이 IndexedDB에 쓰거나 지운 세트를 저장본에서 다시 읽어 메모리를 맞춘다
 * (`storageSync`가 다른 탭의 알림을 받아 부른다). 맞추지 않으면 이 탭의 낡은 사본이 다음 편집
 * 때 다른 탭이 더한 곡과 고친 내용을 저장소와 서버에서 지운다.
 *
 * - 저장본이 있으면 하이드레이션과 같은 기준(세션 사용자의 세트와 공유받은 사본)으로 싣고, 그
 *   세트의 되돌리기 기록을 지우고 계보를 그 판에서 새로 시작한다. 기록은 바꾸기 전의 판이라,
 *   되돌리면 다른 탭의 수정을 덮는다.
 * - 서버와 맞춘 저장본이 이 탭의 맞춘 판보다 오래된 서버 판이면 바꾸지 않고 이 탭의 판을 다시
 *   저장한다. 다른 탭이 늦게 쓴 옛 판으로 이미 확정한 판을 되돌리면, 다음 편집이 낡은 기준 판으로
 *   올라가 사본이 생긴다. 다른 탭의 올리지 않은 편집은 이 탭의 맞춘 판을 바꾼다.
 * - 이 탭이 아직 저장하지 않았거나 저장하는 중인 세트는 바꾸지도 빼지도 않고 건너뛴 것으로
 *   기억한다. 곧 이 탭의 쓰기가 저장본을 다시 쓰고, 바꾸면 이 탭의 편집이 메모리에서 사라진다.
 *   읽는 동안 이 탭에서 고친 세트도 같다. 서버에 아직 올리지 못한 세트도 바꾸지 않고 기억했다가,
 *   그 올리기의 결과를 저장본에 덮어쓰지 않고 그때 다시 읽는다(`markPresentationSynced`).
 * - 저장본이 없으면 다른 탭에서 지운 것이라, 올리기를 기다리던 세트라도 메모리에서 빼고 대기 중인
 *   push를 버린다. 이 탭의 push가 남으면 지운 세트를 서버에 되살린다.
 * - 읽지 못한 저장본(깨졌거나 새 버전의 탭이 쓴 모양)은 지운 것이 아니라 메모리를 그대로 둔다.
 *
 * 그 밖에는 저장도 push도 하지 않는다. 저장본은 다른 탭이 이미 썼고, 올리기도 그 탭이 한다. 하이드레이션에
 * 실패한 탭은 다시 읽지 않는다. 메모리에만 있는 편집을 저장본으로 덮게 된다. 읽기에 실패하면
 * 메모리를 그대로 둔다. 잃는 것이 없어 저장 실패 경고는 올리지 않는다.
 *
 * 읽은 뒤 `isPaused()`가 참이면(그사이 송출을 시작함) 아무것도 바꾸지 않고 읽은 id를 돌려준다.
 * 송출 화면은 띄운 프레젠테이션의 변경을 따라 그리므로, 부른 쪽이 모아 두었다가 송출을 마친 뒤
 * 다시 읽는다. 그 밖에는 빈 목록이다.
 */
export async function reloadPresentationsFromStorage(
  ids: readonly string[],
  isPaused: () => boolean = () => false,
): Promise<string[]> {
  if (!persistenceEnabled) return [];
  const unique = [...new Set(ids)].filter((id) => !skipsUnpersisted(id));
  if (unique.length === 0) return [];
  let loaded: { id: string; record: LoadedRecord<Presentation> }[];
  try {
    loaded = await Promise.all(
      unique.map(async (id) => ({ id, record: await loadPresentation(id) })),
    );
  } catch {
    return [];
  }
  if (isPaused()) return unique;

  const userId = getCurrentUserId();
  const missing: string[] = [];
  let changed = false;
  for (const { id, record } of loaded) {
    if (skipsUnpersisted(id)) continue;
    if (record.status === "missing") {
      missing.push(id);
      continue;
    }
    if (record.status === "unreadable" || !isVisibleTo(record.value, userId)) {
      continue;
    }
    if (isDocumentQueued(id)) {
      skippedReloads.add(id);
      continue;
    }
    if (isOlderSyncedRecord(record.value, state.byId[id])) {
      schedulePersist(id);
      continue;
    }
    replaceFromStorage(record.value);
    changed = true;
  }
  if (forgetPresentations(missing).length > 0) changed = true;
  for (const id of missing) cancelDocumentPush(id);
  if (changed) notifyListeners();
  return [];
}

function skipsUnpersisted(id: string): boolean {
  if (!hasUnpersistedWrite(id)) return false;
  skippedReloads.add(id);
  return true;
}

/**
 * 이 탭의 그 세트가 저장본과 다를 수 있는지: 아직 저장하지 않았거나 저장하는 중이거나, 다른 탭이 쓴
 * 저장본을 다시 읽지 않고 건너뛰었다(`reloadPresentationsFromStorage`).
 *
 * 다시 받기(`refreshOwnDataIfStale`)는 이런 세트를 서버 판으로 바꾸지 않는다. 바꾼 판은 저장 줄이
 * 저장본에 쓰므로, 다른 탭이 저장만 하고 아직 올리지 못한 판을 서버 판으로 덮을 수 있다.
 */
export function mayDifferFromStorage(id: string): boolean {
  return hasUnpersistedWrite(id) || skippedReloads.has(id);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
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
