import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { signInAsTestUser } from "../../test/sessionFixture";
import { renderHook, act } from "@testing-library/react";
import {
  DeckSchema,
  DEFAULT_DECK_STYLE,
  PresentationDocumentSchema,
  PresentationSchema,
  type Presentation,
} from "#shared";
import {
  getActivePresentation,
  addDeckToPresentation,
  applyServerDocuments,
  resetPresentationStore,
  __loadDocumentsForTests,
  createNewPresentation,
  getPresentationById,
  listPresentations,
  openPresentation,
  usePresentationList,
  usePresentationById,
  updatePresentationTitle,
  updateSongStyle,
  updateSongBackground,
  updateSongInfo,
  updateSlideLines,
  addSlideToSong,
  removeSlides,
  moveSlides,
  insertSlides,
  duplicateSlides,
  splitSlideAtCursor,
  mergeSlideWithNext,
  reorderSongs,
  removeSongFromPresentation,
  duplicateSongInPresentation,
  undo,
  redo,
  canUndo,
  canRedo,
  breakHistoryCoalescing,
  adoptServerPresentation,
  duplicatePresentation,
  keepUnsyncedCopy,
  markPresentationSynced,
  rebasePresentation,
  renamePresentation,
  resolvePresentationConflict,
} from "./presentationStore";
import { hasUnsyncedEdits, isSyncedWithServer } from "./presentationDocument";
import {
  __resetSyncSchedulerForTests,
  __setPusherForTests,
  flushPendingSync,
  setSyncEnabled,
} from "../../lib/sync/syncScheduler";
import { COMMON_COPY } from "#copy/common";
import {
  resetBackgroundCatalogForTests,
  setBackgroundCatalogForTests,
} from "../backgrounds/backgroundCatalog";
import { TEST_SERVICE_BACKGROUNDS } from "../../test/backgroundFixture";
import {
  SEED_PRESENTATION_IDS,
  SEED_PRESENTATIONS,
  SEED_USER_ID,
} from "../../test/presentationFixture";

function useSeedPresentation(): Presentation {
  return usePresentationById(SEED_PRESENTATION_IDS[0])!;
}

describe("presentationStore (In-memory reactive presentation)", () => {
  beforeEach(() => {
    signInAsTestUser();
    resetPresentationStore();
    __loadDocumentsForTests(SEED_PRESENTATIONS);
    setBackgroundCatalogForTests(TEST_SERVICE_BACKGROUNDS);
  });

  it("should initialize with the 5 mock songs", () => {
    const presentation = getActivePresentation();
    expect(presentation.items).toHaveLength(5);
    expect(presentation.items[0].deck?.title).toBe("은혜로다");
  });

  it("should append a new deck to the presentation and assign a default background if missing", () => {
    const newDeck = DeckSchema.parse({
      id: "900000000000000000001",
      userId: "00000000x000000000001",
      scope: "presentation",
      presentationId: null,
      title: "아침 안개 눈 앞 가리듯",
      artist: "CCM",
      lyricsRaw: "아침 안개 눈 앞 가리듯",
      slides: [
        {
          id: "slide-1",
          order: 0,
          lines: ["아침 안개 눈 앞 가리듯"],
        },
      ],
      backgroundId: null,
      style: DEFAULT_DECK_STYLE,
      visibility: "private",
      forkedFrom: null,
      forkCount: 0,
      createdAt: "2026-09-20T00:00:00.000Z",
      updatedAt: "2026-09-20T00:00:00.000Z",
    });

    const item = addDeckToPresentation(newDeck);
    expect(item.order).toBe(5);
    expect(item.deck?.title).toBe("아침 안개 눈 앞 가리듯");
    expect(item.deck?.backgroundId).toBe(
      TEST_SERVICE_BACKGROUNDS[5 % TEST_SERVICE_BACKGROUNDS.length].id,
    );

    const updated = getActivePresentation();
    expect(updated.items).toHaveLength(6);
  });

  it("기본 제공 배경이 없으면 배경 없이 곡을 넣는다", () => {
    setBackgroundCatalogForTests([]);
    const item = addDeckToPresentation(
      DeckSchema.parse({
        id: "900000000000000000003",
        userId: "00000000x000000000001",
        scope: "presentation",
        presentationId: null,
        title: "배경 없는 곡",
        artist: "",
        lyricsRaw: "가사",
        slides: [{ id: "s-1", order: 0, lines: ["가사"] }],
        backgroundId: null,
        style: DEFAULT_DECK_STYLE,
        createdAt: "2026-09-20T00:00:00.000Z",
        updatedAt: "2026-09-20T00:00:00.000Z",
      }),
    );
    expect(item.deck?.backgroundId).toBeNull();
    resetBackgroundCatalogForTests();
  });

  it("단색을 고른 곡에는 기본 제공 배경을 입히지 않는다", () => {
    const item = addDeckToPresentation(
      DeckSchema.parse({
        id: "900000000000000000004",
        userId: "00000000x000000000001",
        scope: "presentation",
        presentationId: null,
        title: "단색 곡",
        artist: "",
        lyricsRaw: "가사",
        slides: [{ id: "s-1", order: 0, lines: ["가사"] }],
        backgroundId: null,
        style: { ...DEFAULT_DECK_STYLE, backgroundColor: "#002060" },
        createdAt: "2026-09-20T00:00:00.000Z",
        updatedAt: "2026-09-20T00:00:00.000Z",
      }),
    );
    expect(item.deck?.backgroundId).toBeNull();
    expect(item.deck?.style.backgroundColor).toBe("#002060");
  });

  it("should notify presentation hook subscribers on addDeckToPresentation", () => {
    const { result } = renderHook(() => useSeedPresentation());
    expect(result.current.items).toHaveLength(5);

    const newDeck = DeckSchema.parse({
      id: "900000000000000000002",
      userId: "00000000x000000000001",
      scope: "presentation",
      presentationId: null,
      title: "새 노래로",
      artist: "찬양",
      lyricsRaw: "새 노래로 주 찬양해",
      slides: [
        {
          id: "s-1",
          order: 0,
          lines: ["새 노래로 주 찬양해"],
        },
      ],
      backgroundId: TEST_SERVICE_BACKGROUNDS[2].id,
      style: DEFAULT_DECK_STYLE,
      visibility: "private",
      forkedFrom: null,
      forkCount: 0,
      createdAt: "2026-09-20T00:00:00.000Z",
      updatedAt: "2026-09-20T00:00:00.000Z",
    });

    act(() => {
      addDeckToPresentation(newDeck);
    });

    expect(result.current.items).toHaveLength(6);
    expect(result.current.items[5].deck?.title).toBe("새 노래로");
    expect(result.current.items[5].deck?.backgroundId).toBe(
      TEST_SERVICE_BACKGROUNDS[2].id,
    );
  });

  it("should update presentation title and notify subscribers", () => {
    const { result } = renderHook(() => useSeedPresentation());
    act(() => {
      updatePresentationTitle("2026 청년부 금요 찬양");
    });
    expect(result.current.title).toBe("2026 청년부 금요 찬양");
  });

  it("편집기 제목은 한도로 줄여 저장해 서버가 받을 수 있는 문서로 남는다", () => {
    updatePresentationTitle("가".repeat(101));

    expect(getActivePresentation().title).toBe("가".repeat(100));
    expect(
      PresentationDocumentSchema.safeParse(getActivePresentation()).success,
    ).toBe(true);
  });

  it("공백뿐인 제목이나 같은 제목은 바꾸지 않고 되돌리기 기록도 남기지 않는다", () => {
    const before = getActivePresentation();

    updatePresentationTitle("   ");
    updatePresentationTitle(`  ${before.title}  `);

    expect(getActivePresentation()).toBe(before);
    expect(canUndo()).toBe(false);
  });

  it("should update song style and background", () => {
    const { result } = renderHook(() => useSeedPresentation());
    act(() => {
      updateSongStyle(0, {
        overlayOpacity: 70,
        fontFamily: "Noto Sans KR",
        position: {
          anchor: "bottom-center",
          xPercent: 50,
          yPercent: 90,
          widthPercent: 85,
        },
      });
      updateSongBackground(0, {
        backgroundId: TEST_SERVICE_BACKGROUNDS[3].id,
      });
    });

    const song = result.current.items[0].deck;
    expect(song?.style.overlayOpacity).toBe(70);
    expect(song?.style.fontFamily).toBe("Noto Sans KR");
    expect(song?.style.position.anchor).toBe("bottom-center");
    expect(song?.backgroundId).toBe(TEST_SERVICE_BACKGROUNDS[3].id);

    act(() => {
      updateSongBackground(0, { color: "#002060" });
    });
    expect(result.current.items[0].deck?.backgroundId).toBeNull();
    expect(result.current.items[0].deck?.style.backgroundColor).toBe("#002060");

    act(() => {
      undo();
    });
    expect(result.current.items[0].deck?.backgroundId).toBe(
      TEST_SERVICE_BACKGROUNDS[3].id,
    );
    expect(result.current.items[0].deck?.style.backgroundColor).toBeUndefined();
  });

  it("세트 곡의 제목·아티스트를 바꾸고 되돌릴 수 있다", () => {
    const before = getActivePresentation().items[1].deck!;

    updateSongInfo(1, { title: before.title, artist: before.artist });
    expect(canUndo()).toBe(false);

    updateSongInfo(1, { title: "새 제목", artist: "새 아티스트" });
    const after = getActivePresentation().items[1].deck!;
    expect(after).toMatchObject({
      id: before.id,
      title: "새 제목",
      artist: "새 아티스트",
      slides: before.slides,
    });

    undo();
    expect(getActivePresentation().items[1].deck?.title).toBe(before.title);
  });

  it("should manage slides (update, add, duplicate, remove)", () => {
    const { result } = renderHook(() => useSeedPresentation());
    const initialSlideCount = result.current.items[0].deck?.slides.length ?? 0;

    act(() => {
      updateSlideLines(0, 0, ["첫 번째 줄 수정", "두 번째 줄 수정"]);
    });
    expect(result.current.items[0].deck?.slides[0].lines).toEqual([
      "첫 번째 줄 수정",
      "두 번째 줄 수정",
    ]);

    act(() => {
      addSlideToSong(0, ["새로운 슬라이드"], 0);
    });
    expect(result.current.items[0].deck?.slides.length).toBe(
      initialSlideCount + 1,
    );
    expect(result.current.items[0].deck?.slides[1].lines).toEqual([
      "새로운 슬라이드",
    ]);

    act(() => {
      duplicateSlides(0, [1]);
    });
    expect(result.current.items[0].deck?.slides.length).toBe(
      initialSlideCount + 2,
    );
    expect(result.current.items[0].deck?.slides[2].lines).toEqual([
      "새로운 슬라이드",
    ]);

    act(() => {
      removeSlides(0, [2]);
    });
    expect(result.current.items[0].deck?.slides.length).toBe(
      initialSlideCount + 1,
    );
  });

  it("should reorder and remove songs", () => {
    const { result } = renderHook(() => useSeedPresentation());
    const firstSongTitle = result.current.items[0].deck?.title;
    const secondSongTitle = result.current.items[1].deck?.title;

    act(() => {
      reorderSongs(0, 1);
    });
    expect(result.current.items[0].deck?.title).toBe(secondSongTitle);
    expect(result.current.items[1].deck?.title).toBe(firstSongTitle);

    act(() => {
      removeSongFromPresentation(0);
    });
    expect(result.current.items).toHaveLength(4);
    expect(result.current.items[0].deck?.title).toBe(firstSongTitle);
  });

  it("should duplicate a song within presentation", () => {
    const { result } = renderHook(() => useSeedPresentation());
    const initialSongCount = result.current.items.length;

    act(() => {
      duplicateSongInPresentation(0);
    });

    expect(result.current.items).toHaveLength(initialSongCount + 1);
    expect(result.current.items[1].deck?.title).toBe("은혜로다 (사본)");
    expect(result.current.items[1].deck?.slides).toHaveLength(
      result.current.items[0].deck?.slides.length ?? 0,
    );
  });

  it("긴 제목의 곡을 복제해도 사본 제목이 곡 제목 한도를 넘지 않는다", () => {
    updateSongInfo(0, { title: "가".repeat(96), artist: "" });

    const copy = duplicateSongInPresentation(0);

    expect(copy?.title.length).toBeLessThanOrEqual(100);
    expect(copy?.title.endsWith(" (사본)")).toBe(true);
    expect(
      PresentationDocumentSchema.safeParse(getActivePresentation()).success,
    ).toBe(true);
  });

  it("커서 위치에서 슬라이드를 나누고 되돌릴 수 있다", () => {
    const { result } = renderHook(() => useSeedPresentation());
    act(() => {
      updateSlideLines(0, 0, ["첫째 줄", "둘째 줄", "셋째 줄"]);
    });
    const before = result.current.items[0].deck!.slides;
    const originalId = before[0].id;
    const nextId = before[1].id;

    let didSplit = false;
    act(() => {
      didSplit = splitSlideAtCursor(0, 0, "첫째 줄\n".length);
    });

    const slides = result.current.items[0].deck!.slides;
    expect(didSplit).toBe(true);
    expect(slides).toHaveLength(before.length + 1);
    expect(slides[0]).toMatchObject({ id: originalId, order: 0 });
    expect(slides[0].lines).toEqual(["첫째 줄"]);
    expect(slides[1].lines).toEqual(["둘째 줄", "셋째 줄"]);
    expect(slides[1].id).not.toBe(originalId);
    expect(slides[1].order).toBe(1);
    expect(slides[2]).toMatchObject({ id: nextId, order: 2 });

    act(() => {
      undo();
    });
    expect(result.current.items[0].deck!.slides).toEqual(before);
  });

  it("커서가 맨 앞이면 나누지 않고 기록도 남기지 않는다", () => {
    const { result } = renderHook(() => useSeedPresentation());
    const before = result.current.items[0].deck!.slides;

    let didSplit = true;
    act(() => {
      didSplit = splitSlideAtCursor(0, 0, 0);
    });

    expect(didSplit).toBe(false);
    expect(result.current.items[0].deck!.slides).toBe(before);
    expect(canUndo()).toBe(false);
  });

  it("다음 슬라이드와 합치고, 4줄을 넘으면 합치지 않는다", () => {
    const { result } = renderHook(() => useSeedPresentation());
    act(() => {
      updateSlideLines(0, 0, ["가", "나"]);
      updateSlideLines(0, 1, ["다", "라"]);
    });
    const before = result.current.items[0].deck!.slides;

    let didMerge = false;
    act(() => {
      didMerge = mergeSlideWithNext(0, 0);
    });

    const slides = result.current.items[0].deck!.slides;
    expect(didMerge).toBe(true);
    expect(slides).toHaveLength(before.length - 1);
    expect(slides[0]).toMatchObject({
      id: before[0].id,
      order: 0,
      lines: ["가", "나", "다", "라"],
    });
    expect(slides[1]).toMatchObject({ id: before[2].id, order: 1 });

    act(() => {
      didMerge = mergeSlideWithNext(0, 0);
    });
    expect(didMerge).toBe(false);
    expect(result.current.items[0].deck!.slides).toHaveLength(
      before.length - 1,
    );
  });

  it("곡의 마지막 슬라이드는 합칠 대상이 없다", () => {
    const { result } = renderHook(() => useSeedPresentation());
    const lastIndex = result.current.items[0].deck!.slides.length - 1;

    let didMerge = true;
    act(() => {
      didMerge = mergeSlideWithNext(0, lastIndex);
    });
    expect(didMerge).toBe(false);
  });

  describe("여러 슬라이드 한 번에 다루기", () => {
    const slideIds = (songIndex = 0) =>
      getActivePresentation().items[songIndex].deck!.slides.map((s) => s.id);

    beforeEach(() => {
      insertSlides(0, 0, [["가"], ["나"], ["다"], ["라"], ["마"]]);
      while (slideIds().length > 5) {
        removeSlides(0, [5]);
      }
    });

    it("moveSlides는 흩어진 선택을 순서대로 모아 틈 자리로 옮긴다", () => {
      const [a, b, c, d, e] = slideIds();

      moveSlides(0, [3, 0], 5);
      expect(slideIds()).toEqual([b, c, e, a, d]);

      moveSlides(0, [2, 4], 0);
      expect(slideIds()).toEqual([e, d, b, c, a]);

      const orders = getActivePresentation().items[0].deck!.slides.map(
        (s) => s.order,
      );
      expect(orders).toEqual([0, 1, 2, 3, 4]);
    });

    it("moveSlides는 순서가 그대로면 되돌리기 기록을 남기지 않는다", () => {
      const before = slideIds();

      moveSlides(0, [1, 2], 1);
      moveSlides(0, [1, 2], 3);
      expect(slideIds()).toEqual(before);

      undo();
      expect(slideIds()).not.toEqual(before);
    });

    it("removeSlides는 여러 장을 한 단계로 지우고, 곡을 비우게 되면 거부한다", () => {
      const [a, , c, , e] = slideIds();

      expect(removeSlides(0, [1, 3])).toBe(true);
      expect(slideIds()).toEqual([a, c, e]);

      expect(removeSlides(0, [0, 1, 2])).toBe(false);
      expect(slideIds()).toEqual([a, c, e]);

      undo();
      expect(slideIds()).toHaveLength(5);
    });

    it("insertSlides는 새 id로 넣는다", () => {
      const before = slideIds();
      insertSlides(0, 1, [["새 1"], ["새 2"]]);

      const after = getActivePresentation().items[0].deck!.slides;
      expect(after[1].lines).toEqual(["새 1"]);
      expect(after[2].lines).toEqual(["새 2"]);
      expect(before).not.toContain(after[1].id);
      expect(after[1].id).not.toBe(after[2].id);
    });

    it("duplicateSlides는 선택을 한 덩어리로 마지막 선택 뒤에 복제하고 한 단계로 되돌린다", () => {
      duplicateSlides(0, [3, 1]);

      const lines = getActivePresentation().items[0].deck!.slides.map(
        (s) => s.lines[0],
      );
      expect(lines).toEqual(["가", "나", "다", "라", "나", "라", "마"]);

      undo();
      expect(slideIds()).toHaveLength(5);
    });
  });

  it("should support undo and redo", () => {
    const { result } = renderHook(() => useSeedPresentation());
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(false);

    act(() => {
      updatePresentationTitle("수정된 제목");
    });
    expect(result.current.title).toBe("수정된 제목");
    expect(canUndo()).toBe(true);
    expect(canRedo()).toBe(false);

    act(() => {
      undo();
    });
    expect(result.current.title).toBe("2026 주일 3부 예배");
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(true);

    act(() => {
      redo();
    });
    expect(result.current.title).toBe("수정된 제목");
    expect(canUndo()).toBe(true);
    expect(canRedo()).toBe(false);
  });

  it("되돌리기·다시 실행 뒤에도 바뀌지 않은 곡은 같은 객체를 유지한다", () => {
    const before = getActivePresentation();
    updateSlideLines(0, 0, ["고친 가사"]);
    const edited = getActivePresentation();
    expect(edited.items[1].deck).toBe(before.items[1].deck);

    undo();
    const undone = getActivePresentation();
    expect(undone.items[0].deck).toBe(before.items[0].deck);
    expect(undone.items[1].deck).toBe(before.items[1].deck);

    redo();
    expect(getActivePresentation().items[0].deck).toBe(edited.items[0].deck);
  });
});

describe("멀티 문서 컬렉션", () => {
  beforeEach(() => {
    signInAsTestUser();
    resetPresentationStore();
    __loadDocumentsForTests(SEED_PRESENTATIONS);
  });

  it("시드 5개 문서로 초기화되고 첫 번째가 활성 문서다", () => {
    expect(listPresentations()).toHaveLength(5);
    expect(getActivePresentation().id).toBe(SEED_PRESENTATION_IDS[0]);
    expect(getActivePresentation().id).toBe(SEED_PRESENTATION_IDS[0]);
  });

  it("getPresentationById는 존재하는 id만 반환한다", () => {
    expect(getPresentationById(SEED_PRESENTATION_IDS[2])?.id).toBe(
      SEED_PRESENTATION_IDS[2],
    );
    expect(getPresentationById("존재하지-않는-id")).toBeUndefined();
    expect(getPresentationById(undefined)).toBeUndefined();
  });

  it("listPresentations는 상태가 바뀌지 않으면 동일한 배열 참조를 반환한다", () => {
    expect(listPresentations()).toBe(listPresentations());
  });

  it("openPresentation이 활성 문서를 전환하고 구독자에게 알린다", () => {
    const { result } = renderHook(() => {
      usePresentationList();
      return getActivePresentation().id;
    });
    expect(result.current).toBe(SEED_PRESENTATION_IDS[0]);

    act(() => {
      expect(openPresentation(SEED_PRESENTATION_IDS[1])).toBe(true);
    });

    expect(result.current).toBe(SEED_PRESENTATION_IDS[1]);
    expect(getActivePresentation().id).toBe(SEED_PRESENTATION_IDS[1]);
  });

  it("openPresentation은 없는 id에 대해 false를 반환하고 활성 문서를 유지한다", () => {
    expect(openPresentation("존재하지-않는-id")).toBe(false);
    expect(getActivePresentation().id).toBe(SEED_PRESENTATION_IDS[0]);
  });

  it("usePresentationById는 활성 문서와 무관하게 해당 id를 구독한다", () => {
    const targetId = SEED_PRESENTATION_IDS[3];
    const { result } = renderHook(() => usePresentationById(targetId));
    expect(result.current?.id).toBe(targetId);

    act(() => {
      openPresentation(targetId);
      updatePresentationTitle("원격 수정");
    });

    expect(result.current?.title).toBe("원격 수정");
  });

  it("createNewPresentation은 기존 문서를 파괴하지 않고 추가한다", () => {
    const before = getPresentationById(SEED_PRESENTATION_IDS[0]);
    expect(before?.items).toHaveLength(5);

    const created = createNewPresentation();

    expect(listPresentations()).toHaveLength(6);
    expect(created.items).toEqual([]);
    expect(getActivePresentation().id).toBe(created.id);
    expect(getPresentationById(SEED_PRESENTATION_IDS[0])?.items).toHaveLength(
      5,
    );
  });

  it("createNewPresentation의 id는 스키마가 요구하는 NanoID 형식이다", () => {
    const created = createNewPresentation();
    expect(() => PresentationSchema.parse(created)).not.toThrow();
  });

  it("제목 없이 만든 프레젠테이션은 만든 날짜와 시간이 제목이 된다", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const createdAt = new Date(2026, 8, 25, 15, 42);
      vi.setSystemTime(createdAt);

      const created = createNewPresentation();

      expect(created.title).toBe(
        new Intl.DateTimeFormat("ko-KR", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(createdAt),
      );
      expect(created.title).toContain("2026");
      expect(created.title).toContain("3:42");
    } finally {
      vi.useRealTimers();
    }
  });

  it("usePresentationList는 문서 추가 시 리렌더된다", () => {
    const { result } = renderHook(() => usePresentationList());
    expect(result.current).toHaveLength(5);

    act(() => {
      createNewPresentation();
    });

    expect(result.current).toHaveLength(6);
  });

  it("한 문서의 편집이 다른 문서에 새지 않는다", () => {
    act(() => {
      openPresentation(SEED_PRESENTATION_IDS[1]);
      updatePresentationTitle("B 문서만 수정");
    });

    expect(getPresentationById(SEED_PRESENTATION_IDS[1])?.title).toBe(
      "B 문서만 수정",
    );
    expect(getPresentationById(SEED_PRESENTATION_IDS[0])?.title).toBe(
      "2026 주일 3부 예배",
    );
  });
});

describe("문서별 Undo/Redo 격리", () => {
  const [docA, docB] = SEED_PRESENTATION_IDS;

  beforeEach(() => {
    signInAsTestUser();
    resetPresentationStore();
    __loadDocumentsForTests(SEED_PRESENTATIONS);
  });

  it("다른 문서로 전환하면 그 문서의 히스토리를 본다", () => {
    act(() => {
      openPresentation(docA);
      updatePresentationTitle("A 수정");
    });
    expect(canUndo()).toBe(true);

    act(() => {
      openPresentation(docB);
    });
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(false);

    act(() => {
      openPresentation(docA);
    });
    expect(canUndo()).toBe(true);
  });

  it("undo가 다른 문서를 건드리지 않는다", () => {
    const originalB = getPresentationById(docB)?.title;

    act(() => {
      openPresentation(docA);
      updatePresentationTitle("A 수정");
      openPresentation(docB);
      updatePresentationTitle("B 수정");
      openPresentation(docA);
      undo();
    });

    expect(getPresentationById(docA)?.title).toBe("2026 주일 3부 예배");
    expect(getPresentationById(docB)?.title).toBe("B 수정");
    expect(getPresentationById(docB)?.title).not.toBe(originalB);
  });

  it("createNewPresentation은 히스토리를 남기지 않는다 (유령 undo 방지)", () => {
    act(() => {
      createNewPresentation();
    });
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(false);
  });

  describe("공유 필드와 보관함 연결", () => {
    const libraryDeck = () =>
      DeckSchema.parse({
        id: "9000000000000000000aa",
        userId: SEED_USER_ID,
        scope: "library",
        title: "공개된 보관함 곡",
        lyricsRaw: "가사",
        slides: [{ id: "s1", order: 0, lines: ["가사"] }],
        backgroundId: TEST_SERVICE_BACKGROUNDS[0].id,
        style: DEFAULT_DECK_STYLE,
        visibility: "public",
        forkCount: 42,
        origin: "fork",
        forkedFrom: "9000000000000000000bb",
        forkedFromAuthorName: "원작자",
        publishedAt: "2026-09-22T00:00:00.000Z",
        createdAt: "2026-09-20T00:00:00.000Z",
        updatedAt: "2026-09-20T00:00:00.000Z",
      });

    it("세트 복제본은 비공개이고 복제해 온 보관함 덱을 가리킨다", () => {
      const item = addDeckToPresentation(libraryDeck());
      expect(item.deck).toMatchObject({
        visibility: "private",
        forkCount: 0,
        publishedAt: null,
        forkedFrom: "9000000000000000000aa",
        forkedFromAuthorName: "원작자",
      });
    });

    it("세트 덱을 다시 담으면 원래의 보관함 덱을 물려받는다", () => {
      const first = addDeckToPresentation(libraryDeck());
      const second = addDeckToPresentation(first.deck!);
      expect(second.deck?.forkedFrom).toBe("9000000000000000000aa");
    });
  });
});

describe("수정 시각", () => {
  const T0 = "2026-09-25T00:00:00.000Z";

  beforeEach(() => {
    signInAsTestUser();
    resetPresentationStore();
    __loadDocumentsForTests(SEED_PRESENTATIONS);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(T0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("되돌리기·다시 하기는 지금 판보다 늦은 시각으로 찍는다", () => {
    const fontSize = () =>
      getActivePresentation().items[0].deck?.style.fontSizeVw;
    const original = fontSize();
    updateSongStyle(0, { fontSizeVw: 8 });
    expect(getActivePresentation().updatedAt).toBe(T0);

    vi.setSystemTime(new Date("2026-09-25T00:00:10.000Z"));
    undo();
    expect(fontSize()).toBe(original);
    expect(getActivePresentation().updatedAt).toBe("2026-09-25T00:00:10.000Z");

    vi.setSystemTime(new Date("2026-09-25T00:00:20.000Z"));
    redo();
    expect(fontSize()).toBe(8);
    expect(getActivePresentation().updatedAt).toBe("2026-09-25T00:00:20.000Z");
  });

  it("시계가 뒤로 가도 되돌리기와 편집은 지금 판보다 1ms 뒤로 찍는다", () => {
    updateSongStyle(0, { fontSizeVw: 8 });

    vi.setSystemTime(new Date("2026-09-24T23:59:00.000Z"));
    undo();
    expect(getActivePresentation().updatedAt).toBe("2026-09-25T00:00:00.001Z");

    updatePresentationTitle("시계가 뒤로 간 뒤의 편집");
    expect(getActivePresentation().updatedAt).toBe("2026-09-25T00:00:00.002Z");
  });

  it("같은 밀리초에 두 번 고쳐도 수정 시각이 늘어난다", () => {
    updateSongStyle(0, { fontSizeVw: 8 });
    updateSongStyle(0, { fontSizeVw: 9 });

    expect(getActivePresentation().updatedAt).toBe("2026-09-25T00:00:00.001Z");
  });

  it("병합이 서버본으로 바꾼 세트는 되돌리기 기록을 지운다", () => {
    updatePresentationTitle("로컬 편집");
    const newer: Presentation = {
      ...getActivePresentation(),
      title: "다른 기기의 편집",
      updatedAt: "2026-09-25T00:01:00.000Z",
    };

    applyServerDocuments(
      listPresentations().map((doc) => (doc.id === newer.id ? newer : doc)),
    );

    expect(getActivePresentation().title).toBe("다른 기기의 편집");
    expect(canUndo()).toBe(false);
  });

  it("병합이 그대로 두거나 같은 판의 서버 객체로 바꾼 세트는 되돌리기 기록을 지킨다", () => {
    updatePresentationTitle("로컬 편집");

    applyServerDocuments(listPresentations());
    expect(canUndo()).toBe(true);

    applyServerDocuments(listPresentations().map((doc) => ({ ...doc })));
    expect(canUndo()).toBe(true);
  });
});

describe("되돌리기 묶음", () => {
  beforeEach(() => {
    signInAsTestUser();
    resetPresentationStore();
    __loadDocumentsForTests(SEED_PRESENTATIONS);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-25T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const opacity = () =>
    getActivePresentation().items[0].deck?.style.overlayOpacity;
  const firstLines = () =>
    getActivePresentation().items[0].deck?.slides[0].lines;

  function undoAll(): number {
    let steps = 0;
    while (undo()) steps += 1;
    return steps;
  }

  it("같은 키로 1초 안에 들어온 변경은 한 단계다", () => {
    const original = opacity();
    updateSongStyle(0, { overlayOpacity: 10 }, { coalesceKey: "opacity" });
    vi.advanceTimersByTime(300);
    updateSongStyle(0, { overlayOpacity: 20 }, { coalesceKey: "opacity" });
    vi.advanceTimersByTime(300);
    updateSongStyle(0, { overlayOpacity: 30 }, { coalesceKey: "opacity" });

    expect(undoAll()).toBe(1);
    expect(opacity()).toBe(original);
  });

  it("키가 다르거나 1초 넘게 쉬면 새 단계다", () => {
    updateSongStyle(0, { overlayOpacity: 10 }, { coalesceKey: "opacity" });
    updateSongStyle(0, { fontSizeVw: 5 }, { coalesceKey: "size" });
    vi.advanceTimersByTime(1500);
    updateSongStyle(0, { fontSizeVw: 6 }, { coalesceKey: "size" });

    expect(undoAll()).toBe(3);
  });

  it("undo가 끼면 묶음이 끊긴다", () => {
    updateSlideLines(0, 0, ["가"], { coalesceKey: "lines" });
    updateSlideLines(0, 0, ["가나"], { coalesceKey: "lines" });
    undo();
    updateSlideLines(0, 0, ["다"], { coalesceKey: "lines" });
    updateSlideLines(0, 0, ["다라"], { coalesceKey: "lines" });

    expect(firstLines()).toEqual(["다라"]);
    expect(undoAll()).toBe(1);
  });

  it("breakHistoryCoalescing 뒤의 변경은 새 단계다", () => {
    updateSlideLines(0, 0, ["가"], { coalesceKey: "lines" });
    breakHistoryCoalescing();
    updateSlideLines(0, 0, ["가나"], { coalesceKey: "lines" });

    expect(undoAll()).toBe(2);
  });

  it("값이 그대로면 기록하지 않는다", () => {
    const style = getActivePresentation().items[0].deck!.style;
    updateSongStyle(0, { textAlign: style.textAlign });
    updateSlideLines(0, 0, [...firstLines()!]);

    expect(canUndo()).toBe(false);
  });

  it("키 없는 변경은 앞의 묶음을 끊는다", () => {
    updateSongStyle(0, { overlayOpacity: 10 }, { coalesceKey: "opacity" });
    updatePresentationTitle("제목");
    updateSongStyle(0, { overlayOpacity: 20 }, { coalesceKey: "opacity" });

    expect(undoAll()).toBe(3);
  });
});

describe("서버가 확정한 판 (기준 판)", () => {
  const [SEED] = SEED_PRESENTATIONS;
  const T1 = "2026-10-01T00:00:00.000Z";
  const T2 = "2026-10-01T00:05:00.000Z";
  const S = "2026-10-01T00:07:00.000Z";
  const LATER = "2026-10-01T00:09:00.000Z";
  const FOLDER = "f00000000000000000001";
  const OTHER_USER = "999999999999999999999";
  const push = vi.fn(async (doc: Presentation) => doc.id);

  function load(changes: Partial<Presentation>): Presentation {
    __loadDocumentsForTests([{ ...SEED, ...changes }, SEED_PRESENTATIONS[1]]);
    return getPresentationById(SEED.id)!;
  }

  function serverCopy(changes: Partial<Presentation> = {}): Presentation {
    return {
      ...structuredClone(SEED),
      title: "다른 기기에서 고친 제목",
      updatedAt: LATER,
      ...changes,
    };
  }

  beforeEach(() => {
    signInAsTestUser();
    resetPresentationStore();
    __resetSyncSchedulerForTests();
    push.mockClear();
    __setPusherForTests(push);
    setSyncEnabled(true);
  });

  afterEach(() => {
    __resetSyncSchedulerForTests();
  });

  it("새 프레젠테이션과 사본은 서버가 확정한 적 없는 판이다", () => {
    load({ baseUpdatedAt: T1, updatedAt: T1 });

    expect(createNewPresentation().baseUpdatedAt).toBeNull();
    expect(duplicatePresentation(SEED.id)?.baseUpdatedAt).toBeNull();
  });

  it("편집은 기준 판을 그대로 두고 그보다 늦은 시각을 찍어 올리지 않은 편집으로 남긴다", () => {
    load({ baseUpdatedAt: T1, updatedAt: T1 });

    renamePresentation(SEED.id, "고친 제목");

    const edited = getPresentationById(SEED.id)!;
    expect(edited.baseUpdatedAt).toBe(T1);
    expect(hasUnsyncedEdits(edited)).toBe(true);
  });

  it("보낸 판 그대로면 서버가 남긴 판에서 맞춘 판이 되고 곡 목록 객체는 그대로다", () => {
    const sent = load({ baseUpdatedAt: T1, updatedAt: T2 });

    markPresentationSynced(SEED.id, sent, S);

    const synced = getPresentationById(SEED.id)!;
    expect(synced).toMatchObject({ updatedAt: S, baseUpdatedAt: S });
    expect(isSyncedWithServer(synced)).toBe(true);
    expect(synced.items).toBe(sent.items);
  });

  it("보낸 뒤 바뀐 판은 시각이 같아도 기준 판만 옮기고 올리지 않은 편집으로 남긴다", () => {
    const sent = load({ baseUpdatedAt: T1, updatedAt: T2 });
    applyServerDocuments([
      { ...sent, title: "보낸 뒤 바뀐 제목" },
      SEED_PRESENTATIONS[1],
    ]);

    markPresentationSynced(SEED.id, sent, T2);

    const current = getPresentationById(SEED.id)!;
    expect(current.title).toBe("보낸 뒤 바뀐 제목");
    expect(current.baseUpdatedAt).toBe(T2);
    expect(Date.parse(current.updatedAt)).toBeGreaterThan(Date.parse(T2));
    expect(hasUnsyncedEdits(current)).toBe(true);
  });

  it("보낸 뒤 고친 판은 더 늦은 시각을 지키고 기준 판만 옮긴다", () => {
    const sent = load({ baseUpdatedAt: T1, updatedAt: T2 });
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(LATER));
      renamePresentation(SEED.id, "보낸 뒤 고친 제목");
    } finally {
      vi.useRealTimers();
    }

    markPresentationSynced(SEED.id, sent, S);

    expect(getPresentationById(SEED.id)).toMatchObject({
      title: "보낸 뒤 고친 제목",
      baseUpdatedAt: S,
      updatedAt: LATER,
    });
  });

  it("기준 판을 뒤로 옮기지 않는다", () => {
    const sent = load({ baseUpdatedAt: T1, updatedAt: T2 });
    adoptServerPresentation(serverCopy());
    const adopted = getPresentationById(SEED.id);

    markPresentationSynced(SEED.id, sent, S);

    expect(getPresentationById(SEED.id)).toBe(adopted);
    expect(adopted?.baseUpdatedAt).toBe(LATER);
  });

  it("다시 보낼 기준 판으로 옮기면 수정 시각을 그보다 뒤로 찍는다", () => {
    load({ baseUpdatedAt: T1, updatedAt: T2 });

    rebasePresentation(SEED.id, S);

    expect(getPresentationById(SEED.id)).toMatchObject({
      baseUpdatedAt: S,
      updatedAt: "2026-10-01T00:07:00.001Z",
    });

    rebasePresentation(SEED.id, T1);
    expect(getPresentationById(SEED.id)?.updatedAt).toBe(
      "2026-10-01T00:07:00.001Z",
    );
  });

  it("서버 판을 받으면 되돌리기 기록과 대기 중인 push를 버리고, 없거나 남의 세트는 넣지 않는다", async () => {
    load({ baseUpdatedAt: T1, updatedAt: T1 });
    openPresentation(SEED.id);
    updatePresentationTitle("받기 전 편집");
    expect(canUndo()).toBe(true);

    adoptServerPresentation(serverCopy());
    adoptServerPresentation(serverCopy({ id: "100000000000000000099" }));
    adoptServerPresentation(
      serverCopy({ userId: OTHER_USER, title: "남의 판" }),
    );
    await flushPendingSync();

    expect(getPresentationById(SEED.id)).toMatchObject({
      title: "다른 기기에서 고친 제목",
      updatedAt: LATER,
      baseUpdatedAt: LATER,
    });
    expect(canUndo()).toBe(false);
    expect(getPresentationById("100000000000000000099")).toBeUndefined();
    expect(push).not.toHaveBeenCalled();
  });

  it("엇갈린 세트는 이 기기의 편집을 새 '(사본)'으로 남기고 서버 판을 받는다", async () => {
    const trashedAt = "2026-10-01T00:06:00.000Z";
    load({ baseUpdatedAt: T1, updatedAt: T2, folderId: FOLDER, trashedAt });
    const local = getPresentationById(SEED.id)!;

    const copy = resolvePresentationConflict(serverCopy());
    await flushPendingSync();

    expect(copy).not.toBeNull();
    expect(copy).toMatchObject({
      title: `${SEED.title}${COMMON_COPY.copySuffix}`,
      folderId: FOLDER,
      trashedAt,
      baseUpdatedAt: null,
    });
    expect(copy?.id).not.toBe(SEED.id);
    const localItemIds = new Set(local.items.map((item) => item.id));
    const localDeckIds = new Set(local.items.map((item) => item.deckId));
    expect(copy?.items.some((item) => localItemIds.has(item.id))).toBe(false);
    expect(copy?.items.some((item) => localDeckIds.has(item.deckId))).toBe(
      false,
    );
    expect(getPresentationById(copy!.id)).toBe(copy);
    expect(push).toHaveBeenCalledExactlyOnceWith(copy);
    expect(getPresentationById(SEED.id)).toMatchObject({
      title: "다른 기기에서 고친 제목",
      baseUpdatedAt: LATER,
    });
  });

  it("고친 것이 없는 세트는 사본을 만들지 않고 서버 판을 받는다", () => {
    load({ baseUpdatedAt: T1, updatedAt: T1 });
    const before = listPresentations().length;

    expect(resolvePresentationConflict(serverCopy())).toBeNull();
    expect(keepUnsyncedCopy(SEED.id)).toBeNull();
    expect(listPresentations()).toHaveLength(before);
    expect(getPresentationById(SEED.id)?.title).toBe("다른 기기에서 고친 제목");
  });

  it("기준 판이 없는 이전 저장본은 올리지 않은 편집이 있는지 몰라 사본을 남기지 않는다", () => {
    load({ updatedAt: T2 });

    expect(keepUnsyncedCopy(SEED.id)).toBeNull();
  });

  describe("시계가 서버보다 한참 늦은 기기", () => {
    const BASE = "2026-10-01T12:00:00.000Z";
    const EDITED_TITLE = "늦은 시계로 고친 제목";

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-01T11:00:00.000Z"));
      load({ baseUpdatedAt: BASE, updatedAt: BASE });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("고친 판을 기준 판보다 늦게 찍어 올리지 않은 편집으로 남긴다", () => {
      renamePresentation(SEED.id, EDITED_TITLE);

      const edited = getPresentationById(SEED.id)!;
      expect(edited.baseUpdatedAt).toBe(BASE);
      expect(Date.parse(edited.updatedAt)).toBeGreaterThan(Date.parse(BASE));
      expect(hasUnsyncedEdits(edited)).toBe(true);
    });

    it("다른 기기와 엇갈리면 고친 내용을 '(사본)'으로 남기고 서버 판을 받는다", () => {
      renamePresentation(SEED.id, EDITED_TITLE);

      const copy = resolvePresentationConflict(
        serverCopy({ updatedAt: "2026-10-01T12:30:00.000Z" }),
      );

      expect(copy?.title).toBe(`${EDITED_TITLE}${COMMON_COPY.copySuffix}`);
      expect(getPresentationById(SEED.id)?.title).toBe(
        "다른 기기에서 고친 제목",
      );
    });

    it("다른 기기에서 영구 삭제한 세트도 고친 내용을 '(사본)'으로 남긴다", () => {
      renamePresentation(SEED.id, EDITED_TITLE);

      expect(keepUnsyncedCopy(SEED.id)?.title).toBe(
        `${EDITED_TITLE}${COMMON_COPY.copySuffix}`,
      );
    });

    it("기준 판보다 이른 시각으로 남은 판도 올리지 않은 편집으로 보고 '(사본)'으로 남긴다", () => {
      load({
        title: EDITED_TITLE,
        baseUpdatedAt: BASE,
        updatedAt: "2026-10-01T11:05:00.001Z",
      });

      expect(keepUnsyncedCopy(SEED.id)?.title).toBe(
        `${EDITED_TITLE}${COMMON_COPY.copySuffix}`,
      );
    });
  });
});
