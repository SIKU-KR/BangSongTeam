import { useSyncExternalStore } from "react";
import type { Deck, Presentation, PresentationItem } from "@repo/shared";
import { INITIAL_BACKGROUNDS } from "@repo/shared";
import {
  savePresentation,
  loadAllPresentations,
  deletePresentation,
  reportPersistenceError,
  clearPersistenceError,
  reportCorruptedRecords,
} from "../../lib/storage";
import { getCurrentUserId } from "../../lib/auth/sessionStore";
import { scheduleDocumentPush } from "../../lib/sync/syncScheduler";
import { mockDecks } from "./mockPresentation";

/** 멀티 문서 컬렉션 상태 */
interface PresentationStoreState {
  /** 문서 id -> 프레젠테이션 */
  byId: Record<string, Presentation>;
  /** 표시 순서 (생성 순서 유지, 정렬은 읽는 쪽에서 수행) */
  order: string[];
  /** 현재 열려 있는 문서 id */
  activeId: string;
}

/**
 * 빈 컬렉션.
 *
 * 예전에는 샘플 5개를 깔고 시작했다. 계정이 생긴 뒤로는 그러면 안 된다 —
 * 샘플이 사용자 데이터로 서버에 올라가 다른 기기에서 '내가 안 만든 세트'로
 * 보인다. 첫 로그인 사용자는 빈 대시보드에서 시작한다.
 */
function createEmptyState(): PresentationStoreState {
  return { byId: {}, order: [], activeId: "" };
}

/**
 * 문서가 하나도 없을 때 읽기용으로 돌려주는 자리표시자.
 * 저장 대상이 아니다 (id가 비어 있어 스케줄러가 걸러낸다).
 */
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
/**
 * listPresentations()가 매 호출마다 새 배열을 만들면 useSyncExternalStore가
 * "getSnapshot should be cached" 무한 루프로 터지므로, state 교체 시에만 재계산한다.
 */
let listSnapshot: Presentation[] = buildListSnapshot(state);
const listeners = new Set<() => void>();

/** 활성 문서 읽기 (내부 전용). 컬렉션이 비면 자리표시자를 돌려준다. */
function readActive(): Presentation {
  return state.byId[state.activeId] ?? EMPTY_PRESENTATION;
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

// ----------------------------------------------------------------------------
// IndexedDB 영속성 (TECH_SPEC §5.5 Phase 2)
//
// 모든 뮤테이터가 emitChange()로 끝나므로 저장 스케줄링도 여기 한 곳에서만 한다.
// 컴포넌트가 저장소를 직접 부르지 않는다.
// ----------------------------------------------------------------------------

const PERSIST_DEBOUNCE_MS = 300;

/** 하이드레이션 전에는 저장하지 않는다 (시드가 저장본을 덮어쓰는 것을 막는다) */
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

function schedulePersist(): void {
  if (!persistenceEnabled) return;
  if (!state.activeId) return; // 빈 컬렉션 — 저장할 문서가 없다
  pendingIds.add(state.activeId);
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(runPendingWrites, PERSIST_DEBOUNCE_MS);
}

/**
 * 대기 중인 쓰기를 즉시 시작하고 완료를 기다린다.
 *
 * IndexedDB는 비동기라 언로드 시점의 완료를 보장할 수 없다. 그래서 보장 대신
 * 디바운스를 300ms로 짧게 유지하고, 창이 숨겨질 때 타이머를 앞당기는 방식을 쓴다.
 */
export async function flushPendingWrites(): Promise<void> {
  runPendingWrites();
  await inFlight;
}

/**
 * 저장본으로 컬렉션을 복원한다.
 *
 * **세션 사용자의 문서만 싣는다.** 한 브라우저를 여러 사람이 쓰거나 계정을
 * 바꿨을 때 남의 세트가 보이면 안 된다. 로그아웃해도 로컬 저장본 자체는
 * 지우지 않으므로, 다시 로그인하면 그대로 돌아온다.
 *
 * 앱 부팅 시 세션이 정해진 뒤에 1회 호출하며, 완료 전까지 라우터를 렌더하지 않는다.
 */
/**
 * 한 문서 안에서 `deck.id`가 겹치는 저장본을 복구한다.
 *
 * Clone-on-Add가 없던 시절(같은 공유 곡을 두 번 추가한 경우) 만들어진 문서는
 * `deck.id`가 중복이라 서버에서 기본키·유니크 제약을 동시에 위반한다. 고쳐 놓지
 * 않으면 그 사용자의 세트는 **영원히** 동기화되지 않는다. 뒤에 온 중복본에 새 id를
 * 발급하고 `item.deckId`를 맞춘다 (곡을 지우지 않는다 — 봉사자가 일부러 같은 곡을
 * 두 번 넣었을 수 있다).
 */
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
        // deckId와 deck.id가 어긋난 저장본도 여기서 맞춘다.
        if (item.deckId === deck.id) return item;
        changed = true;
        return { ...item, deckId: deck.id };
      }

      changed = true;
      const newId = crypto.randomUUID();
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

    // 복구본은 저장소에도 바로 써 둔다. 다음 부팅마다 같은 복구를 반복하지 않고,
    // 서버 동기화가 그 순간부터 통과한다.
    for (const id of repairedIds) {
      const repaired = state.byId[id];
      if (repaired) await savePresentation(repaired).catch(() => {});
    }
  } catch (err) {
    // 저장소를 못 쓰는 환경이어도 편집 자체는 계속 가능해야 한다
    persistenceEnabled = false;
    reportPersistenceError(err);
  }
}

/** 저장소에서 문서를 지운다 (메모리 상태 제거는 호출자 책임) */
export async function removePersistedPresentation(id: string): Promise<void> {
  try {
    await deletePresentation(id);
  } catch (err) {
    reportPersistenceError(err);
  }
}

/** 테스트 격리 전용: 저장 스케줄러 상태를 비운다 */
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
 * 서버에서 받아 병합한 문서 목록을 스토어에 반영한다.
 *
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
 * 테스트 전용: 문서를 메모리에 직접 싣는다.
 *
 * 부팅 시 샘플 자동 생성이 사라지면서, 데이터가 필요한 테스트는 스스로
 * 상태를 만들어야 한다. 저장은 하지 않는다 (저장까지 원하면 저장소에 심고
 * hydrateFromStorage()를 부른다).
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

/**
 * 서버 push 예약.
 *
 * 로컬 저장(`schedulePersist`)과 나란히 두되 큐는 완전히 분리되어 있다.
 * 느린 네트워크가 IndexedDB 쓰기를 막으면 안 된다.
 */
function scheduleServerPush(): void {
  const active = state.byId[state.activeId];
  if (active) scheduleDocumentPush(active);
}

/**
 * 현재 활성 프레젠테이션 반환
 */
export function getActivePresentation(): Presentation {
  return readActive();
}

/**
 * 보관함·공유 곡을 이 프레젠테이션 전용 복제본으로 만든다 (Clone-on-Add).
 *
 * TECH_SPEC §4.0-1이 정한 모델이다. 예전에는 복제 없이 원본 덱을 그대로 넣었는데,
 * 그 결과 두 가지가 깨졌다.
 *
 * 1. **같은 곡을 두 번 넣으면 서버 저장이 통째로 실패한다.** `deck.id`가 같은 항목이
 *    두 개 생겨 `decks` 기본키와 `presentation_items`의 `unique(presentation_id, deck_id)`를
 *    동시에 위반한다.
 * 2. 세트 안의 덱이 공유 곡 주인의 `userId`와 `scope: "library"`를 그대로 달고 있어,
 *    보관함과 세트 복제본의 격리가 로컬에서만 무너져 있었다.
 *
 * 짧은 id를 쓰면 저장은 되지만 다음 부팅 `safeParse`에서 문서 전체가 격리되므로
 * 반드시 uuid를 쓴다 (`duplicateSongInPresentation`과 같은 이유).
 */
function cloneDeckForPresentation(deck: Deck, presentationId: string): Deck {
  const now = new Date().toISOString();
  return {
    ...(JSON.parse(JSON.stringify(deck)) as Deck),
    id: crypto.randomUUID(),
    userId: getCurrentUserId() ?? deck.userId,
    scope: "presentation",
    presentationId,
    // 세트 복제본의 `forkedFrom`은 '복제해 온 보관함 덱'이다 (M5). 편집기 '공유'가
    // 이 값으로 보관함 원본을 찾아 그 원본을 공개한다. 세트에서 세트로 옮긴 덱이면
    // 원래 가리키던 보관함 덱을 그대로 물려받는다.
    forkedFrom: deck.scope === "library" ? deck.id : (deck.forkedFrom ?? null),
    // 세트 복제본은 공유 대상이 아니다. 공개 곡을 담아도 복제본은 비공개다
    // (서버도 강제한다 — M5-1).
    visibility: "private",
    forkCount: 0,
    publishedAt: null,
    contributeToCatalog: false,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 세트 곡을 보관함 덱에 연결한다 (M5 공유).
 *
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
 * 인메모리 프레젠테이션에 신규 덱을 추가하고 모든 구독자에게 알림 (M1 실시간 연동).
 * 덱은 항상 이 세트 전용 복제본으로 들어간다 (Clone-on-Add).
 */
export function addDeckToPresentation(deck: Deck): PresentationItem {
  pushHistory();
  const active = readActive();
  const currentCount = active.items.length;
  // backgroundId가 없으면 10개 초기 배경 중 순환 할당
  const assignedBackgroundId =
    deck.backgroundId ||
    INITIAL_BACKGROUNDS[currentCount % INITIAL_BACKGROUNDS.length].id;

  const resolvedDeck: Deck = {
    ...cloneDeckForPresentation(deck, active.id),
    backgroundId: assignedBackgroundId,
  };

  const newItem: PresentationItem = {
    id: crypto.randomUUID(),
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

/**
 * 테스트 격리 전용: 컬렉션 전체를 시드 상태로 되돌리고 모든 히스토리를 비운다.
 */
export function resetPresentationStore(): void {
  resetPersistenceForTests();
  histories.clear();
  state = createEmptyState();
  listSnapshot = buildListSnapshot(state);
  emitChange();
}

/**
 * 기본 5곡 샘플 세트를 활성 문서에 불러온다 (에디터 '기본 5곡 세트 불러오기').
 *
 * 예전에는 같은 자리의 버튼이 `resetActivePresentation()`을 불러 **세트를 비웠다** —
 * 라벨과 정반대였다. 처음 쓰는 봉사자가 빈 화면에서 뭘 눌러야 할지 알기 위한
 * 버튼이므로, 라벨대로 샘플을 채우는 쪽으로 맞췄다.
 *
 * 샘플 덱은 `MOCK_USER_ID`와 `MOCK_PRESENTATION_ID`를 물고 있다. 복제 없이 넣으면
 * 남의 소유로 저장되고, 두 번 누르면 `deck.id`가 겹쳐 서버 저장이 깨진다.
 * 그래서 일반 곡 추가와 똑같이 Clone-on-Add 경로를 탄다.
 */
export function loadSampleSongsIntoActivePresentation(): PresentationItem[] {
  if (!state.activeId) return [];
  return mockDecks.map((deck) => addDeckToPresentation(deck));
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
    userId: getCurrentUserId() ?? readActive().userId,
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
    // DeckSchema.id는 uuid다. 접두사를 붙인 짧은 id를 쓰면 저장은 되지만
    // 다음 부팅의 safeParse에서 프레젠테이션 문서 전체가 격리된다.
    id: crypto.randomUUID(),
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
