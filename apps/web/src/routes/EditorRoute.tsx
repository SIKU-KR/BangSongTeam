import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  useActiveSetlist,
  updateSetlistTitle,
  updateSongStyle,
  updateSongBackground,
  updateSlideLines,
  addSlideToSong,
  removeSlideFromSong,
  duplicateSlide,
  reorderSongs,
  removeSongFromSetlist,
  addDeckToSetlist,
  duplicateSongInSetlist,
  reorderSlides,
  undo,
  redo,
  canUndo,
  canRedo,
  resetActiveSetlist,
  createNewSetlist,
} from "../features/presentation";
import {
  getBackgroundMediaUrl,
  getBackgroundPosterUrl,
  DEFAULT_DECK_STYLE,
} from "@repo/shared";
import { EditorHeader } from "../features/editor/EditorHeader";
import { EditorSidebar } from "../features/editor/EditorSidebar";
import { EditorStageCanvas } from "../features/editor/EditorStageCanvas";
import { SlideFilmstrip } from "../features/editor/SlideFilmstrip";
import { SongPropertyPanel } from "../features/editor/SongPropertyPanel";
import { QuickLyricPasteModal } from "../features/editor/QuickLyricPasteModal";

/**
 * Canva / MiriCanvas 스타일 통합 프레젠테이션 편집기 라우트
 * - 상단: EditorHeader (제목 인라인 수정, 실행 취소/다시 실행, 슬라이드쇼 발표 CTA)
 * - 좌측: EditorSidebar (Canva 스타일 아이콘 레일 + 콘티 곡, 슬라이드, 가사, 모션 배경, 스타일 테마 드로어)
 * - 중앙: EditorStageCanvas (16:9 캔버스 스테이지 & 줌 컨트롤 & 리허설 암전/숨김 & 빈 상태 방어)
 * - 우측: SongPropertyPanel (모션 배경 10종, 오버레이, 타이포그래피, 3×3 그리드, 슬라이드 가사 직접 수정)
 * - 하단: SlideFilmstrip (가로 슬라이드 스트립, 슬라이드 순서 변경 ◀/▶, 접기/펼치기 토글)
 */
export function EditorRoute(): React.JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setlist = useActiveSetlist();
  const [isLyricModalOpen, setIsLyricModalOpen] = useState(false);

  const initialSongIndex = Math.min(
    Math.max(0, Number(searchParams.get("song") || 0)),
    Math.max(0, setlist.items.length - 1),
  );

  const [activeSongIndex, setActiveSongIndex] =
    useState<number>(initialSongIndex);
  const [activeSlideIndex, setActiveSlideIndex] = useState<number>(0);
  const [zoomLevel, setZoomLevel] = useState<number>(100);

  // 현재 유효한 곡 및 슬라이드 계산
  const safeSongIndex = Math.min(
    Math.max(0, activeSongIndex),
    Math.max(0, setlist.items.length - 1),
  );
  const currentItem = setlist.items[safeSongIndex] ?? setlist.items[0];
  const currentSong = currentItem?.deck;
  const currentSlides = currentSong?.slides ?? [];
  const safeSlideIndex = Math.min(
    Math.max(0, activeSlideIndex),
    Math.max(0, currentSlides.length - 1),
  );
  const currentSlide = currentSlides[safeSlideIndex] ?? null;
  const currentStyle = currentSong?.style ?? DEFAULT_DECK_STYLE;

  const backgroundUrl = getBackgroundMediaUrl(currentSong?.backgroundId);
  const posterUrl = getBackgroundPosterUrl(currentSong?.backgroundId);

  // 슬라이드쇼 발표 핸들러
  const handlePresent = () => {
    navigate("/present/fullscreen");
  };

  // 슬라이드 선택 핸들러
  const handleSelectSlide = (idx: number) => {
    if (idx >= 0 && idx < currentSlides.length) {
      setActiveSlideIndex(idx);
    }
  };

  // 슬라이드 넘김 핸들러
  const handlePrevSlide = () => {
    if (activeSlideIndex > 0) {
      setActiveSlideIndex((prev) => prev - 1);
    } else if (activeSongIndex > 0) {
      const prevSongIdx = activeSongIndex - 1;
      const prevSlides = setlist.items[prevSongIdx]?.deck?.slides.length ?? 1;
      setActiveSongIndex(prevSongIdx);
      setActiveSlideIndex(prevSlides - 1);
    }
  };

  const handleNextSlide = () => {
    if (activeSlideIndex < currentSlides.length - 1) {
      setActiveSlideIndex((prev) => prev + 1);
    } else if (activeSongIndex < setlist.items.length - 1) {
      setActiveSongIndex((prev) => prev + 1);
      setActiveSlideIndex(0);
    }
  };

  // 슬라이드 추가
  const handleAddSlide = () => {
    addSlideToSong(
      safeSongIndex,
      ["새 가사 줄을 입력하세요"],
      safeSlideIndex,
    );
    setActiveSlideIndex((prev) => prev + 1);
  };

  // 슬라이드 복제
  const handleDuplicateSlide = (idx: number) => {
    duplicateSlide(safeSongIndex, idx);
    setActiveSlideIndex(idx + 1);
  };

  // 슬라이드 삭제
  const handleDeleteSlide = (idx: number) => {
    if (currentSlides.length <= 1) return;
    removeSlideFromSong(safeSongIndex, idx);
    if (idx === activeSlideIndex) {
      setActiveSlideIndex((prev) =>
        Math.max(0, Math.min(prev, currentSlides.length - 2)),
      );
    } else if (idx < activeSlideIndex) {
      setActiveSlideIndex((prev) => prev - 1);
    }
  };

  // 슬라이드 순서 재정렬
  const handleReorderSlide = (from: number, to: number) => {
    reorderSlides(safeSongIndex, from, to);
    if (activeSlideIndex === from) {
      setActiveSlideIndex(to);
    } else if (from < activeSlideIndex && to >= activeSlideIndex) {
      setActiveSlideIndex((prev) => prev - 1);
    } else if (from > activeSlideIndex && to <= activeSlideIndex) {
      setActiveSlideIndex((prev) => prev + 1);
    }
  };

  // 곡 선택
  const handleSelectSong = (idx: number) => {
    setActiveSongIndex(idx);
    setActiveSlideIndex(0);
  };

  // 곡 순서 재정렬
  const handleReorderSong = (from: number, to: number) => {
    reorderSongs(from, to);
    if (activeSongIndex === from) {
      setActiveSongIndex(to);
    } else if (from < activeSongIndex && to >= activeSongIndex) {
      setActiveSongIndex((prev) => prev - 1);
    } else if (from > activeSongIndex && to <= activeSongIndex) {
      setActiveSongIndex((prev) => prev + 1);
    }
  };

  // 곡 복제
  const handleDuplicateSong = (idx: number) => {
    duplicateSongInSetlist(idx);
    setActiveSongIndex(idx + 1);
    setActiveSlideIndex(0);
  };

  // 곡 삭제
  const handleDeleteSong = (idx: number) => {
    removeSongFromSetlist(idx);
    const newCount = setlist.items.length - 1;
    if (newCount <= 0) {
      setActiveSongIndex(0);
      setActiveSlideIndex(0);
      return;
    }
    if (idx === activeSongIndex) {
      setActiveSongIndex((prev) => Math.min(prev, newCount - 1));
      setActiveSlideIndex(0);
    } else if (idx < activeSongIndex) {
      setActiveSongIndex((prev) => prev - 1);
    }
  };

  // 기본 세트 복원
  const handleResetSetlist = () => {
    resetActiveSetlist();
    setActiveSongIndex(0);
    setActiveSlideIndex(0);
  };

  // 새 프레젠테이션 만들기
  const handleNewPresentation = () => {
    createNewSetlist("새 주일 예배 프레젠테이션");
    setActiveSongIndex(0);
    setActiveSlideIndex(0);
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
  }, [
    activeSlideIndex,
    activeSongIndex,
    currentSlides.length,
    setlist.items.length,
  ]);

  return (
    <div
      data-testid="editor-route"
      className="flex flex-col h-screen w-screen bg-zinc-950 text-zinc-100 overflow-hidden select-none"
    >
      {/* 1. 상단 Canva / MiriCanvas 스타일 헤더 */}
      <EditorHeader
        title={setlist.title}
        onUpdateTitle={(newTitle) => updateSetlistTitle(newTitle)}
        onPresent={handlePresent}
        currentSongIndex={safeSongIndex}
        totalSongs={setlist.items.length}
        currentSlideIndex={safeSlideIndex}
        totalSlides={currentSlides.length}
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo()}
        canRedo={canRedo()}
        onNewPresentation={handleNewPresentation}
        onOpenLyricModal={() => setIsLyricModalOpen(true)}
        onResetSetlist={handleResetSetlist}
      />

      {/* 2. 본문 3패널 레이아웃 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 좌측 패널: Canva 스타일 아이콘 레일 & 드로어 탐색 */}
        <EditorSidebar
          items={setlist.items}
          activeSongIndex={safeSongIndex}
          activeSlideIndex={safeSlideIndex}
          onSelectSong={handleSelectSong}
          onSelectSlide={handleSelectSlide}
          onReorderSong={handleReorderSong}
          onDeleteSong={handleDeleteSong}
          onDuplicateSong={handleDuplicateSong}
          onAddSong={(deck) => {
            addDeckToSetlist(deck);
            setActiveSongIndex(setlist.items.length);
            setActiveSlideIndex(0);
          }}
          onAddSlide={handleAddSlide}
          onDeleteSlide={handleDeleteSlide}
          onDuplicateSlide={handleDuplicateSlide}
          onReorderSlide={handleReorderSlide}
          onUpdateBackground={(bgId) => updateSongBackground(safeSongIndex, bgId)}
          onUpdateStyle={(styleUpdate) => updateSongStyle(safeSongIndex, styleUpdate)}
        />

        {/* 중앙: 16:9 슬라이드 스테이지 캔버스 */}
        <EditorStageCanvas
          slide={currentSlide}
          style={currentStyle}
          backgroundUrl={backgroundUrl}
          posterUrl={posterUrl}
          songTitle={currentSong?.title}
          slideIndex={safeSlideIndex}
          totalSlides={currentSlides.length}
          onPrevSlide={handlePrevSlide}
          onNextSlide={handleNextSlide}
          onPresent={handlePresent}
          zoomLevel={zoomLevel}
          onZoomChange={setZoomLevel}
          onResetSetlist={handleResetSetlist}
          onOpenLyricModal={() => setIsLyricModalOpen(true)}
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
        />
      </div>

      {/* 3. 하단 Canva 스타일 슬라이드 필름스트립 */}
      <SlideFilmstrip
        slides={currentSlides}
        activeSlideIndex={safeSlideIndex}
        onSelectSlide={handleSelectSlide}
        onAddSlide={handleAddSlide}
        onDuplicateSlide={handleDuplicateSlide}
        onDeleteSlide={handleDeleteSlide}
        onReorderSlide={handleReorderSlide}
        songStyle={currentStyle}
        backgroundUrl={backgroundUrl}
        posterUrl={posterUrl}
      />

      {/* 가사 빠른 입력 모달 */}
      <QuickLyricPasteModal
        isOpen={isLyricModalOpen}
        onClose={() => setIsLyricModalOpen(false)}
        onAddToSet={(newDeck) => {
          addDeckToSetlist(newDeck);
          setActiveSongIndex(setlist.items.length);
          setActiveSlideIndex(0);
          setIsLyricModalOpen(false);
        }}
      />
    </div>
  );
}

export default EditorRoute;

