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
import { DEFAULT_DECK_STYLE } from "#shared";
import type { Presentation } from "#shared";
import { EditorHeader } from "../features/editor/EditorHeader";
import { drivePath } from "../features/drive";
import { StorageWarningBanner } from "../components/common/StorageWarningBanner";
import { EditorStageCanvas } from "../features/editor/EditorStageCanvas";
import { SlideThumbnailPane } from "../features/editor/SlideThumbnailPane";
import { SongPropertyPanel } from "../features/editor/SongPropertyPanel";
import { SongPickerModal } from "../features/editor/SongPickerModal";
import { SongSharePanel } from "../features/sharing/SongSharePanel";
import { useBackgroundAutoCache } from "../features/offline";
import {
  resolveBackgroundLayers,
  useBackground,
} from "../features/backgrounds";

const EMPTY_PRESENTATION: Presentation = {
  id: "",
  userId: "",
  title: "",
  serviceDate: "",
  items: [],
  createdAt: "",
  updatedAt: "",
};

/** PowerPoint식 프레젠테이션 편집기 라우트 */
export function EditorRoute(): React.JSX.Element {
  const navigate = useNavigate();
  const { presentationId } = useParams<{ presentationId: string }>();
  const [searchParams] = useSearchParams();
  const found = usePresentationById(presentationId);
  const presentation = found ?? EMPTY_PRESENTATION;
  const [isLyricModalOpen, setIsLyricModalOpen] = useState(false);

  useLayoutEffect(() => {
    if (presentationId) openPresentation(presentationId);
  }, [presentationId]);

  useBackgroundAutoCache(found ?? null);

  const initialSongIndex = Math.min(
    Math.max(0, Number(searchParams.get("song") || 0)),
    Math.max(0, presentation.items.length - 1),
  );

  const [activeSongIndex, setActiveSongIndex] =
    useState<number>(initialSongIndex);
  const [activeSlideIndex, setActiveSlideIndex] = useState<number>(0);
  const [zoomLevel, setZoomLevel] = useState<number>(100);

  useEffect(() => {
    const requested = Number(searchParams.get("song") || 0);
    setActiveSongIndex(Number.isFinite(requested) ? Math.max(0, requested) : 0);
    setActiveSlideIndex(0);
  }, [presentationId]);

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

  const songs = presentation.items;
  const position: ProjectionPosition = {
    songIndex: safeSongIndex,
    slideIndex: safeSlideIndex,
  };
  const totalSlideCount = getTotalSlideCount(songs);
  const currentSlideNumber = slideNumberOfPosition(position, songs);

  const background = resolveBackgroundLayers(
    useBackground(currentSong?.backgroundId),
  );

  const handlePresent = () => {
    if (presentationId) {
      launchPresentation(navigate, presentationId, `/editor/${presentationId}`);
    }
  };

  const selectPosition = (next: ProjectionPosition) => {
    setActiveSongIndex(next.songIndex);
    setActiveSlideIndex(next.slideIndex);
  };

  const handleSelectSlide = (songIndex: number, slideIndex: number) => {
    if (songIndex < 0 || songIndex >= songs.length) return;
    selectPosition(clampPosition({ songIndex, slideIndex }, songs));
  };

  const handlePrevSlide = () => selectPosition(prevPosition(position, songs));
  const handleNextSlide = () => selectPosition(nextPosition(position, songs));

  const handleAddSlide = () => {
    if (!currentSong) return;
    addSlideToSong(safeSongIndex, ["새 가사 줄을 입력하세요"], safeSlideIndex);
    selectPosition({
      songIndex: safeSongIndex,
      slideIndex: safeSlideIndex + 1,
    });
  };

  const handleDuplicateSlide = (songIndex: number, slideIndex: number) => {
    duplicateSlide(songIndex, slideIndex);
    selectPosition({ songIndex, slideIndex: slideIndex + 1 });
  };

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

  const handleDuplicateSong = (idx: number) => {
    duplicateSongInPresentation(idx);
    selectPosition({ songIndex: idx + 1, slideIndex: 0 });
  };

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

  const handleNewPresentation = () => {
    const created = createNewPresentation(
      "새 주일 예배 프레젠테이션",
      presentation.folderId ?? null,
    );
    setActiveSongIndex(0);
    setActiveSlideIndex(0);
    navigate(`/editor/${created.id}`);
  };

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

  if (!found) return <Navigate to="/presentations" replace />;

  return (
    <div
      data-testid="editor-route"
      className="flex flex-col h-screen w-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 overflow-hidden select-none"
    >
      <StorageWarningBanner />

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
        backPath={drivePath(presentation.folderId)}
      />

      <div className="flex-1 flex overflow-hidden">
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

        <EditorStageCanvas
          slide={currentSlide}
          style={currentStyle}
          backgroundUrl={background.videoUrl}
          backgroundImageUrl={background.imageUrl}
          posterUrl={background.posterUrl}
          songTitle={currentSong?.title}
          slideNumber={currentSlideNumber}
          totalSlideCount={totalSlideCount}
          onPrevSlide={handlePrevSlide}
          onNextSlide={handleNextSlide}
          onPresent={handlePresent}
          zoomLevel={zoomLevel}
          onZoomChange={setZoomLevel}
          onOpenLyricModal={() => setIsLyricModalOpen(true)}
          onUpdateStyle={(styleUpdate) =>
            updateSongStyle(safeSongIndex, styleUpdate)
          }
        />

        <SongPropertyPanel
          style={currentStyle}
          backgroundId={currentSong?.backgroundId}
          activeSlide={currentSlide}
          onUpdateStyle={(styleUpdate) =>
            updateSongStyle(safeSongIndex, styleUpdate)
          }
          onUpdateBackground={(backgroundId) =>
            updateSongBackground(safeSongIndex, backgroundId)
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
