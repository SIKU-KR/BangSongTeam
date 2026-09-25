import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { signInAsTestUser } from "../../test/sessionFixture";
import { renderHook, act } from "@testing-library/react";
import { DeckSchema, DEFAULT_DECK_STYLE, PresentationSchema } from "#shared";
import {
  SEED_PRESENTATION_IDS,
  SEED_PRESENTATIONS,
  SEED_USER_ID,
} from "./mockPresentations";
import {
  getActivePresentation,
  addDeckToPresentation,
  resetPresentationStore,
  __loadDocumentsForTests,
  useActivePresentation,
  createNewPresentation,
  getActivePresentationId,
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
} from "./presentationStore";
import {
  resetBackgroundCatalogForTests,
  setBackgroundCatalogForTests,
} from "../backgrounds/backgroundCatalog";
import { TEST_SERVICE_BACKGROUNDS } from "../../test/backgroundFixture";

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

  it("should notify useActivePresentation hook subscribers on addDeckToPresentation", () => {
    const { result } = renderHook(() => useActivePresentation());
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
    const { result } = renderHook(() => useActivePresentation());
    act(() => {
      updatePresentationTitle("2026 청년부 금요 찬양");
    });
    expect(result.current.title).toBe("2026 청년부 금요 찬양");
  });

  it("should update song style and background", () => {
    const { result } = renderHook(() => useActivePresentation());
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
      updateSongBackground(0, TEST_SERVICE_BACKGROUNDS[3].id);
    });

    const song = result.current.items[0].deck;
    expect(song?.style.overlayOpacity).toBe(70);
    expect(song?.style.fontFamily).toBe("Noto Sans KR");
    expect(song?.style.position.anchor).toBe("bottom-center");
    expect(song?.backgroundId).toBe(TEST_SERVICE_BACKGROUNDS[3].id);

    act(() => {
      updateSongBackground(0, null);
    });
    expect(result.current.items[0].deck?.backgroundId).toBeNull();
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
    const { result } = renderHook(() => useActivePresentation());
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
    const { result } = renderHook(() => useActivePresentation());
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
    const { result } = renderHook(() => useActivePresentation());
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

  it("커서 위치에서 슬라이드를 나누고 되돌릴 수 있다", () => {
    const { result } = renderHook(() => useActivePresentation());
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
    const { result } = renderHook(() => useActivePresentation());
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
    const { result } = renderHook(() => useActivePresentation());
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
    const { result } = renderHook(() => useActivePresentation());
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
    const { result } = renderHook(() => useActivePresentation());
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
});

describe("멀티 문서 컬렉션", () => {
  beforeEach(() => {
    signInAsTestUser();
    resetPresentationStore();
    __loadDocumentsForTests(SEED_PRESENTATIONS);
  });

  it("시드 5개 문서로 초기화되고 첫 번째가 활성 문서다", () => {
    expect(listPresentations()).toHaveLength(5);
    expect(getActivePresentationId()).toBe(SEED_PRESENTATION_IDS[0]);
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
    const { result } = renderHook(() => useActivePresentation());
    expect(result.current.id).toBe(SEED_PRESENTATION_IDS[0]);

    act(() => {
      expect(openPresentation(SEED_PRESENTATION_IDS[1])).toBe(true);
    });

    expect(result.current.id).toBe(SEED_PRESENTATION_IDS[1]);
    expect(getActivePresentationId()).toBe(SEED_PRESENTATION_IDS[1]);
  });

  it("openPresentation은 없는 id에 대해 false를 반환하고 활성 문서를 유지한다", () => {
    expect(openPresentation("존재하지-않는-id")).toBe(false);
    expect(getActivePresentationId()).toBe(SEED_PRESENTATION_IDS[0]);
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

    const created = createNewPresentation("새 예배 프레젠테이션");

    expect(listPresentations()).toHaveLength(6);
    expect(created.items).toEqual([]);
    expect(getActivePresentationId()).toBe(created.id);
    expect(getPresentationById(SEED_PRESENTATION_IDS[0])?.items).toHaveLength(
      5,
    );
  });

  it("createNewPresentation의 id는 스키마가 요구하는 NanoID 형식이다", () => {
    const created = createNewPresentation();
    expect(() => PresentationSchema.parse(created)).not.toThrow();
  });

  it("usePresentationList는 문서 추가 시 리렌더된다", () => {
    const { result } = renderHook(() => usePresentationList());
    expect(result.current).toHaveLength(5);

    act(() => {
      createNewPresentation("추가된 문서");
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
      createNewPresentation("새 문서");
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
