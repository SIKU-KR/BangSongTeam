import React, { useState, useEffect, useLayoutEffect } from "react";
import {
  useNavigate,
  useParams,
  useSearchParams,
  Navigate,
} from "react-router-dom";
import {
  updatePresentationTitle,
  updateSongStyle,
  updateSongBackground,
  updateSlideLines,
  addSlideToSong,
  removeSlideFromSong,
  duplicateSlide,
  reorderSongs,
  removeSongFromPresentation,
  addDeckToPresentation,
  duplicateSongInPresentation,
  reorderSlides,
  undo,
  redo,
  canUndo,
  canRedo,
  loadSampleSongsIntoActivePresentation,
  createNewPresentation,
  launchPresentation,
  usePresentationById,
  openPresentation,
  clampPosition,
  nextPosition,
  prevPosition,
  getTotalSlideCount,
  slideNumberOfPosition,
  INITIAL_POSITION,
  type ProjectionPosition,
} from "../features/presentation";
import {
  getBackgroundMediaUrl,
  getBackgroundPosterUrl,
  DEFAULT_DECK_STYLE,
} from "@repo/shared";
import type { Presentation } from "@repo/shared";

/**
 * 문서를 찾지 못한 프레임에서 훅 본문이 안전하게 참조할 빈 폴백.
 * (얼리 리턴을 모든 훅 뒤에 두기 위해 필요 — React 훅 규칙)
 */
const EMPTY_PRESENTATION: Presentation = {
  id: "",
  userId: "",
  title: "",
  serviceDate: "",
  items: [],
  createdAt: "",
  updatedAt: "",
};
import { EditorHeader } from "../features/editor/EditorHeader";
import { StorageWarningBanner } from "../components/common/StorageWarningBanner";
import { EditorStageCanvas } from "../features/editor/EditorStageCanvas";
import { SlideThumbnailPane } from "../features/editor/SlideThumbnailPane";
import { SongPropertyPanel } from "../features/editor/SongPropertyPanel";
import { SongPickerModal } from "../features/editor/SongPickerModal";
import { SongSharePanel } from "../features/sharing/SongSharePanel";
import { useBackgroundAutoCache } from "../features/offline";

/**
 * PowerPoint식 프레젠테이션 편집기 라우트
 * - 상단: EditorHeader (제목 인라인 수정, 실행 취소/다시 실행, 테마, 슬라이드쇼 발표 CTA)
 * - 좌측: SlideThumbnailPane (세트 전체 슬라이드 썸네일, 1부터 이어지는 번호, 곡 = 구역 헤더)
 * - 중앙: EditorStageCanvas (16:9 캔버스 스테이지 & 줌 컨트롤 & 리허설 암전/숨김 & 빈 상태 방어)
 * - 우측: SongPropertyPanel (모션 배경, 테마 프리셋, 오버레이, 타이포그래피, 3×3 그리드, 슬라이드 가사 직접 수정)
 */
export function EditorRoute(): React.JSX.Element {
  const navigate = useNavigate();
  const { presentationId } = useParams<{ presentationId: string }>();
  const [searchParams] = useSearchParams();
  const found = usePresentationById(presentationId);
  const presentation = found ?? EMPTY_PRESENTATION;
  const [isLyricModalOpen, setIsLyricModalOpen] = useState(false);

  // 뮤테이터/undo·redo가 모두 활성 문서를 보므로 URL과 동기화한다.
  // useEffect가 아닌 useLayoutEffect인 이유: 첫 커밋 시점에 activeId가 아직 이전
  // 문서인 창이 생기면, 그 창에서 호출된 뮤테이터가 엉뚱한 문서를 편집하게 된다.
  useLayoutEffect(() => {
    if (presentationId) openPresentation(presentationId);
  }, [presentationId]);

  // 편집하는 동안 이 세트의 배경을 조용히 캐시에 담아 둔다 (예배 준비 화면 대체).
  useBackgroundAutoCache(found ?? null);

  const initialSongIndex = Math.min(
    Math.max(0, Number(searchParams.get("song") || 0)),
    Math.max(0, presentation.items.length - 1),
  );

  const [activeSongIndex, setActiveSongIndex] =
    useState<number>(initialSongIndex);
  const [activeSlideIndex, setActiveSlideIndex] = useState<number>(0);
  const [zoomLevel, setZoomLevel] = useState<number>(100);

  // 마운트를 유지한 채 다른 문서로 전환되는 경우에도 선택 상태를 재설정한다
  useEffect(() => {
    const requested = Number(searchParams.get("song") || 0);
    setActiveSongIndex(Number.isFinite(requested) ? Math.max(0, requested) : 0);
    setActiveSlideIndex(0);
    // searchParams는 의도적으로 제외한다 — 문서 전환 시에만 선택을 재설정한다
  }, [presentationId]);

  // 현재 유효한 곡 및 슬라이드 계산
  const safeSongIndex = Math.min(
    Math.max(0, activeSongIndex),
    Math.max(0, presentation.items.length - 1),
  );
  const currentItem =
    presentation.items[safeSongIndex] ?? presentation.items[0];
  const currentSong = currentItem?.deck;
  const currentSlides = currentSong?.slides ?? [];
  const safeSlideIndex = Math.min(
    Math.max(0, activeSlideIndex),
    Math.max(0, currentSlides.length - 1),
  );
  const currentSlide = currentSlides[safeSlideIndex] ?? null;
  const currentStyle = currentSong?.style ?? DEFAULT_DECK_STYLE;

  // 슬라이드 번호는 세트 전체에서 1부터 이어진다 (곡이 바뀌어도 1로 돌아가지 않음)
  const songs = presentation.items;
  const position: ProjectionPosition = {
    songIndex: safeSongIndex,
    slideIndex: safeSlideIndex,
  };
  const totalSlideCount = getTotalSlideCount(songs);
  const currentSlideNumber = slideNumberOfPosition(position, songs);

  const backgroundUrl = getBackgroundMediaUrl(currentSong?.backgroundId);
  const posterUrl = getBackgroundPosterUrl(currentSong?.backgroundId);

  // 슬라이드쇼 발표 핸들러 (클릭 제스처 안에서 곧바로 전체화면 송출)
  const handlePresent = () => {
    if (presentationId) launchPresentation(navigate, presentationId);
  };

  // 선택 위치를 곡·슬라이드 한 쌍으로 옮긴다
  const selectPosition = (next: ProjectionPosition) => {
    setActiveSongIndex(next.songIndex);
    setActiveSlideIndex(next.slideIndex);
  };

  // 썸네일 창에서 슬라이드 선택 (구역 헤더 클릭은 그 곡의 첫 슬라이드)
  const handleSelectSlide = (songIndex: number, slideIndex: number) => {
    if (songIndex < 0 || songIndex >= songs.length) return;
    selectPosition(clampPosition({ songIndex, slideIndex }, songs));
  };

  // 슬라이드 넘김 (곡 경계를 넘어 세트 처음/끝까지 — 송출과 같은 규칙)
  const handlePrevSlide = () => selectPosition(prevPosition(position, songs));
  const handleNextSlide = () => selectPosition(nextPosition(position, songs));

  // 새 슬라이드: 현재 곡의 현재 슬라이드 뒤에 추가 (PPT의 '새 슬라이드')
  const handleAddSlide = () => {
    if (!currentSong) return;
    addSlideToSong(safeSongIndex, ["새 가사 줄을 입력하세요"], safeSlideIndex);
    selectPosition({
      songIndex: safeSongIndex,
      slideIndex: safeSlideIndex + 1,
    });
  };

  // 슬라이드 복제
  const handleDuplicateSlide = (songIndex: number, slideIndex: number) => {
    duplicateSlide(songIndex, slideIndex);
    selectPosition({ songIndex, slideIndex: slideIndex + 1 });
  };

  // 슬라이드 삭제 (곡마다 최소 1장은 남긴다)
  const handleDeleteSlide = (songIndex: number, slideIndex: number) => {
    const slideCount = songs[songIndex]?.deck?.slides.length ?? 0;
    if (slideCount <= 1) return;
    removeSlideFromSong(songIndex, slideIndex);
    if (songIndex !== safeSongIndex) return;
    if (slideIndex === safeSlideIndex) {
      setActiveSlideIndex(
        Math.max(0, Math.min(safeSlideIndex, slideCount - 2)),
      );
    } else if (slideIndex < safeSlideIndex) {
      setActiveSlideIndex(safeSlideIndex - 1);
    }
  };

  // 곡 안에서 슬라이드 순서 재정렬
  const handleReorderSlide = (songIndex: number, from: number, to: number) => {
    reorderSlides(songIndex, from, to);
    if (songIndex !== safeSongIndex) return;
    if (safeSlideIndex === from) {
      setActiveSlideIndex(to);
    } else if (from < safeSlideIndex && to >= safeSlideIndex) {
      setActiveSlideIndex(safeSlideIndex - 1);
    } else if (from > safeSlideIndex && to <= safeSlideIndex) {
      setActiveSlideIndex(safeSlideIndex + 1);
    }
  };

  // 곡 순서 재정렬
  const handleReorderSong = (from: number, to: number) => {
    reorderSongs(from, to);
    if (safeSongIndex === from) {
      setActiveSongIndex(to);
    } else if (from < safeSongIndex && to >= safeSongIndex) {
      setActiveSongIndex(safeSongIndex - 1);
    } else if (from > safeSongIndex && to <= safeSongIndex) {
      setActiveSongIndex(safeSongIndex + 1);
    }
  };

  // 곡 복제
  const handleDuplicateSong = (idx: number) => {
    duplicateSongInPresentation(idx);
    selectPosition({ songIndex: idx + 1, slideIndex: 0 });
  };

  // 곡 삭제
  const handleDeleteSong = (idx: number) => {
    removeSongFromPresentation(idx);
    const newCount = songs.length - 1;
    if (newCount <= 0) {
      selectPosition(INITIAL_POSITION);
      return;
    }
    if (idx === safeSongIndex) {
      selectPosition({
        songIndex: Math.min(safeSongIndex, newCount - 1),
        slideIndex: 0,
      });
    } else if (idx < safeSongIndex) {
      setActiveSongIndex(safeSongIndex - 1);
    }
  };

  // 기본 5곡 샘플 세트 불러오기 (빈 편집기에서 무엇을 눌러야 할지 보여 주는 경로)
  const handleLoadSampleSongs = () => {
    loadSampleSongsIntoActivePresentation();
    setActiveSongIndex(0);
    setActiveSlideIndex(0);
  };

  // 새 프레젠테이션 만들기
  const handleNewPresentation = () => {
    const created = createNewPresentation("새 주일 예배 프레젠테이션");
    setActiveSongIndex(0);
    setActiveSlideIndex(0);
    // 이동하지 않으면 위의 useLayoutEffect가 곧바로 옛 문서를 다시 열어
    // 새 문서가 즉시 유실된다
    navigate(`/editor/${created.id}`);
  };

  // 키보드 단축키 지원 (슬라이드 넘김, 실행 취소/다시 실행)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeElement = document.activeElement;
      const isInputActive =
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        (activeElement as HTMLElement)?.isContentEditable;

      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && (e.key === "z" || e.key === "Z")) {
        if (e.shiftKey) {
          if (canRedo()) {
            e.preventDefault();
            redo();
          }
        } else {
          if (canUndo()) {
            e.preventDefault();
            undo();
          }
        }
        return;
      }
      if (isMod && (e.key === "y" || e.key === "Y")) {
        if (canRedo()) {
          e.preventDefault();
          redo();
        }
        return;
      }

      if (isInputActive) return;

      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        handlePrevSlide();
      } else if (
        e.key === "ArrowRight" ||
        e.key === "ArrowDown" ||
        e.key === " "
      ) {
        e.preventDefault();
        handleNextSlide();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [safeSongIndex, safeSlideIndex, songs]);

  // 얼리 리턴은 반드시 모든 훅 뒤에 (훅은 조건 없이 실행됨)
  if (!found) return <Navigate to="/presentations" replace />;

  return (
    <div
      data-testid="editor-route"
      className="flex flex-col h-screen w-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 overflow-hidden select-none"
    >
      {/* 저장 실패 경고 (닫을 수 없음) */}
      <StorageWarningBanner />

      {/* 1. 상단 헤더 */}
      <EditorHeader
        title={presentation.title}
        onUpdateTitle={(newTitle) => updatePresentationTitle(newTitle)}
        onPresent={handlePresent}
        currentSongIndex={safeSongIndex}
        totalSongs={presentation.items.length}
        currentSlideNumber={currentSlideNumber}
        totalSlideCount={totalSlideCount}
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo()}
        canRedo={canRedo()}
        onNewPresentation={handleNewPresentation}
        onOpenLyricModal={() => setIsLyricModalOpen(true)}
        onLoadSampleSongs={handleLoadSampleSongs}
      />

      {/* 2. 본문 3패널 레이아웃 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 좌측: PPT식 슬라이드 썸네일 창 */}
        <SlideThumbnailPane
          items={songs}
          activeSongIndex={safeSongIndex}
          activeSlideIndex={safeSlideIndex}
          onSelectSlide={handleSelectSlide}
          onAddSlide={handleAddSlide}
          onDuplicateSlide={handleDuplicateSlide}
          onDeleteSlide={handleDeleteSlide}
          onReorderSlide={handleReorderSlide}
          onReorderSong={handleReorderSong}
          onDuplicateSong={handleDuplicateSong}
          onDeleteSong={handleDeleteSong}
          onOpenSongPicker={() => setIsLyricModalOpen(true)}
        />

        {/* 중앙: 16:9 슬라이드 스테이지 캔버스 */}
        <EditorStageCanvas
          slide={currentSlide}
          style={currentStyle}
          backgroundUrl={backgroundUrl}
          posterUrl={posterUrl}
          songTitle={currentSong?.title}
          slideNumber={currentSlideNumber}
          totalSlideCount={totalSlideCount}
          onPrevSlide={handlePrevSlide}
          onNextSlide={handleNextSlide}
          onPresent={handlePresent}
          zoomLevel={zoomLevel}
          onZoomChange={setZoomLevel}
          onLoadSampleSongs={handleLoadSampleSongs}
          onOpenLyricModal={() => setIsLyricModalOpen(true)}
          onUpdateStyle={(styleUpdate) =>
            updateSongStyle(safeSongIndex, styleUpdate)
          }
        />

        {/* 우측 패널: 디자인 & 속성 인스펙터 */}
        <SongPropertyPanel
          style={currentStyle}
          backgroundId={currentSong?.backgroundId}
          activeSlide={currentSlide}
          onUpdateStyle={(styleUpdate) =>
            updateSongStyle(safeSongIndex, styleUpdate)
          }
          onUpdateBackground={(bgId) =>
            updateSongBackground(safeSongIndex, bgId)
          }
          onUpdateSlideLines={(lines) =>
            updateSlideLines(safeSongIndex, safeSlideIndex, lines)
          }
          footer={
            currentSong ? (
              <SongSharePanel songIndex={safeSongIndex} song={currentSong} />
            ) : null
          }
        />
      </div>

      {/* 2-Pane 통합 찬양곡 선택/추가 모달 */}
      <SongPickerModal
        isOpen={isLyricModalOpen}
        onClose={() => setIsLyricModalOpen(false)}
        onSelectSong={(newDeck) => {
          addDeckToPresentation(newDeck);
          setActiveSongIndex(presentation.items.length);
          setActiveSlideIndex(0);
          setIsLyricModalOpen(false);
        }}
      />
    </div>
  );
}

export default EditorRoute;
