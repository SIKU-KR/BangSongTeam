import React, { useState } from "react";
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

/**
 * Canva / MiriCanvas 스타일 통합 프레젠테이션 편집기 라우트
 * - 상단: EditorHeader (제목 인라인 수정, 슬라이드쇼 발표 CTA)
 * - 좌측: EditorSidebar (콘티 곡 목록, 슬라이드 썸네일 탐색)
 * - 중앙: EditorStageCanvas (16:9 프레젠테이션 스테이지 & 리허설 암전/숨김 토글)
 * - 우측: SongPropertyPanel (모션 배경 10종, 오버레이, 타이포그래피, 3×3 그리드, 슬라이드 가사 직접 수정)
 * - 하단: SlideFilmstrip (가로 슬라이드 스트립, 썸네일 점프, 슬라이드 추가/복제/삭제)
 */
export function EditorRoute(): React.JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setlist = useActiveSetlist();

  const initialSongIndex = Math.min(
    Math.max(0, Number(searchParams.get("song") || 0)),
    Math.max(0, setlist.items.length - 1),
  );

  const [activeSongIndex, setActiveSongIndex] =
    useState<number>(initialSongIndex);
  const [activeSlideIndex, setActiveSlideIndex] = useState<number>(0);
  const [zoomLevel, setZoomLevel] = useState<number>(100);

  // 현재 유효한 곡 및 슬라이드 계산
  const currentItem = setlist.items[activeSongIndex] ?? setlist.items[0];
  const currentSong = currentItem?.deck;
  const currentSlides = currentSong?.slides ?? [];
  const currentSlide =
    currentSlides[activeSlideIndex] ?? currentSlides[0] ?? null;
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
      activeSongIndex,
      ["새 가사 줄을 입력하세요"],
      activeSlideIndex,
    );
    setActiveSlideIndex((prev) => prev + 1);
  };

  // 슬라이드 복제
  const handleDuplicateSlide = (idx: number) => {
    duplicateSlide(activeSongIndex, idx);
    setActiveSlideIndex(idx + 1);
  };

  // 슬라이드 삭제
  const handleDeleteSlide = (idx: number) => {
    if (currentSlides.length <= 1) return;
    removeSlideFromSong(activeSongIndex, idx);
    setActiveSlideIndex((prev) =>
      Math.max(0, Math.min(prev, currentSlides.length - 2)),
    );
  };

  // 곡 선택
  const handleSelectSong = (idx: number) => {
    setActiveSongIndex(idx);
    setActiveSlideIndex(0);
  };

  // 곡 삭제
  const handleDeleteSong = (idx: number) => {
    removeSongFromSetlist(idx);
    setActiveSongIndex((prev) =>
      Math.max(0, Math.min(prev, setlist.items.length - 2)),
    );
    setActiveSlideIndex(0);
  };

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
        currentSongIndex={activeSongIndex}
        totalSongs={setlist.items.length}
        currentSlideIndex={activeSlideIndex}
        totalSlides={currentSlides.length}
      />

      {/* 2. 본문 3패널 레이아웃 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 좌측 패널: 곡 목록 & 슬라이드 목록 탐색 */}
        <EditorSidebar
          items={setlist.items}
          activeSongIndex={activeSongIndex}
          activeSlideIndex={activeSlideIndex}
          onSelectSong={handleSelectSong}
          onSelectSlide={handleSelectSlide}
          onReorderSong={(from, to) => reorderSongs(from, to)}
          onDeleteSong={handleDeleteSong}
          onAddSong={(deck) => addDeckToSetlist(deck)}
          onAddSlide={handleAddSlide}
          onDeleteSlide={handleDeleteSlide}
        />

        {/* 중앙: 16:9 슬라이드 스테이지 캔버스 */}
        <EditorStageCanvas
          slide={currentSlide}
          style={currentStyle}
          backgroundUrl={backgroundUrl}
          posterUrl={posterUrl}
          songTitle={currentSong?.title}
          slideIndex={activeSlideIndex}
          totalSlides={currentSlides.length}
          onPrevSlide={handlePrevSlide}
          onNextSlide={handleNextSlide}
          onPresent={handlePresent}
        />

        {/* 우측 패널: 디자인 & 속성 인스펙터 */}
        <SongPropertyPanel
          style={currentStyle}
          backgroundId={currentSong?.backgroundId}
          activeSlide={currentSlide}
          onUpdateStyle={(styleUpdate) =>
            updateSongStyle(activeSongIndex, styleUpdate)
          }
          onUpdateBackground={(bgId) =>
            updateSongBackground(activeSongIndex, bgId)
          }
          onUpdateSlideLines={(lines) =>
            updateSlideLines(activeSongIndex, activeSlideIndex, lines)
          }
        />
      </div>

      {/* 3. 하단 Canva 스타일 슬라이드 필름스트립 */}
      <SlideFilmstrip
        slides={currentSlides}
        activeSlideIndex={activeSlideIndex}
        onSelectSlide={handleSelectSlide}
        onAddSlide={handleAddSlide}
        onDuplicateSlide={handleDuplicateSlide}
        onDeleteSlide={handleDeleteSlide}
        songStyle={currentStyle}
        backgroundUrl={backgroundUrl}
        posterUrl={posterUrl}
        zoomLevel={zoomLevel}
        onZoomChange={setZoomLevel}
      />
    </div>
  );
}

export default EditorRoute;
