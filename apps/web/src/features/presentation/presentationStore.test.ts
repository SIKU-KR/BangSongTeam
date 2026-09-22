import { describe, it, expect, beforeEach } from "vitest";
import { signInAsTestUser } from "../../test/sessionFixture";
import { renderHook, act } from "@testing-library/react";
import {
  DeckSchema,
  DEFAULT_DECK_STYLE,
  INITIAL_BACKGROUNDS,
  PresentationSchema,
} from "@repo/shared";
import { SEED_PRESENTATION_IDS, SEED_PRESENTATIONS } from "./mockPresentations";
import {
  getActivePresentation,
  addDeckToPresentation,
  resetPresentationStore,
  __loadDocumentsForTests,
  resetActivePresentation,
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
  updateSlideLines,
  addSlideToSong,
  removeSlideFromSong,
  duplicateSlide,
  reorderSongs,
  removeSongFromPresentation,
  duplicateSongInPresentation,
  reorderSlides,
  undo,
  redo,
  canUndo,
  canRedo,
} from "./presentationStore";

describe("presentationStore (In-memory reactive presentation)", () => {
  beforeEach(() => {
    signInAsTestUser();
    resetPresentationStore();
    // 부팅 시 샘플 자동 생성이 사라져(계정 기반 전환) 테스트가 직접 싣는다.
    __loadDocumentsForTests(SEED_PRESENTATIONS);
  });

  it("should initialize with the 5 mock songs", () => {
    const presentation = getActivePresentation();
    expect(presentation.items).toHaveLength(5);
    expect(presentation.items[0].deck?.title).toBe("은혜로다");
  });

  it("should append a new deck to the presentation and assign a default background if missing", () => {
    const newDeck = DeckSchema.parse({
      id: "90000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000001",
      catalogId: null,
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
    // Should automatically assign a valid background from INITIAL_BACKGROUNDS
    expect(item.deck?.backgroundId).toBe(
      INITIAL_BACKGROUNDS[5 % INITIAL_BACKGROUNDS.length].id,
    );

    const updated = getActivePresentation();
    expect(updated.items).toHaveLength(6);
  });

  it("should notify useActivePresentation hook subscribers on addDeckToPresentation", () => {
    const { result } = renderHook(() => useActivePresentation());
    expect(result.current.items).toHaveLength(5);

    const newDeck = DeckSchema.parse({
      id: "90000000-0000-4000-8000-000000000002",
      userId: "00000000-0000-4000-8000-000000000001",
      catalogId: null,
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
      backgroundId: INITIAL_BACKGROUNDS[2].id,
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
      INITIAL_BACKGROUNDS[2].id,
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
      updateSongBackground(0, INITIAL_BACKGROUNDS[3].id);
    });

    const song = result.current.items[0].deck;
    expect(song?.style.overlayOpacity).toBe(70);
    expect(song?.style.fontFamily).toBe("Noto Sans KR");
    expect(song?.style.position.anchor).toBe("bottom-center");
    expect(song?.backgroundId).toBe(INITIAL_BACKGROUNDS[3].id);
  });

  it("should manage slides (update, add, duplicate, remove)", () => {
    const { result } = renderHook(() => useActivePresentation());
    const initialSlideCount = result.current.items[0].deck?.slides.length ?? 0;

    // Update lines
    act(() => {
      updateSlideLines(0, 0, ["첫 번째 줄 수정", "두 번째 줄 수정"]);
    });
    expect(result.current.items[0].deck?.slides[0].lines).toEqual([
      "첫 번째 줄 수정",
      "두 번째 줄 수정",
    ]);

    // Add slide
    act(() => {
      addSlideToSong(0, ["새로운 슬라이드"], 0);
    });
    expect(result.current.items[0].deck?.slides.length).toBe(
      initialSlideCount + 1,
    );
    expect(result.current.items[0].deck?.slides[1].lines).toEqual([
      "새로운 슬라이드",
    ]);

    // Duplicate slide
    act(() => {
      duplicateSlide(0, 1);
    });
    expect(result.current.items[0].deck?.slides.length).toBe(
      initialSlideCount + 2,
    );
    expect(result.current.items[0].deck?.slides[2].lines).toEqual([
      "새로운 슬라이드",
    ]);

    // Remove slide
    act(() => {
      removeSlideFromSong(0, 2);
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

  it("should reorder slides within a song", () => {
    const { result } = renderHook(() => useActivePresentation());
    const originalSlide0 = result.current.items[0].deck?.slides[0].lines[0];
    const originalSlide1 = result.current.items[0].deck?.slides[1].lines[0];

    act(() => {
      reorderSlides(0, 0, 1);
    });

    expect(result.current.items[0].deck?.slides[0].lines[0]).toBe(
      originalSlide1,
    );
    expect(result.current.items[0].deck?.slides[1].lines[0]).toBe(
      originalSlide0,
    );
  });

  it("should support undo and redo", () => {
    const { result } = renderHook(() => useActivePresentation());
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(false);

    // Make an edit
    act(() => {
      updatePresentationTitle("수정된 제목");
    });
    expect(result.current.title).toBe("수정된 제목");
    expect(canUndo()).toBe(true);
    expect(canRedo()).toBe(false);

    // Undo edit
    act(() => {
      undo();
    });
    expect(result.current.title).toBe("2026 주일 3부 예배");
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(true);

    // Redo edit
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
    // 부팅 시 샘플 자동 생성이 사라져(계정 기반 전환) 테스트가 직접 싣는다.
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
    // useSyncExternalStore의 getSnapshot 캐싱 요구사항 (무한 루프 방지)
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
    // 이전 문서가 그대로 살아 있어야 한다
    expect(getPresentationById(SEED_PRESENTATION_IDS[0])?.items).toHaveLength(
      5,
    );
  });

  it("createNewPresentation의 userId는 스키마가 요구하는 uuid 형식이다", () => {
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
    // B는 아직 편집된 적이 없다
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
    // B는 자기 편집 결과를 그대로 유지한다
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

  it("resetActivePresentation은 활성 문서의 곡만 비운다", () => {
    // 계정 기반으로 바뀌면서 시드 복원이 아니라 '세트 비우기'가 되었다.
    // 사용자가 만든 적 없는 곡이 복원되면 그게 더 이상하다.
    act(() => {
      openPresentation(docB);
      updatePresentationTitle("B 수정");
      openPresentation(docA);
      updatePresentationTitle("A 수정");
      resetActivePresentation();
    });

    expect(getPresentationById(docA)?.items).toHaveLength(0);
    expect(getPresentationById(docA)?.title).toBe("A 수정");
    // 다른 문서는 손대지 않는다
    expect(getPresentationById(docB)?.title).toBe("B 수정");
    expect(getPresentationById(docB)?.items.length).toBeGreaterThan(0);
    expect(listPresentations()).toHaveLength(5);
    expect(canUndo()).toBe(false);
  });
});
