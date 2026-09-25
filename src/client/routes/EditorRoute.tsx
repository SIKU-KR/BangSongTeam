import React, { useState, useEffect, useLayoutEffect, useMemo } from "react";
import {
  useNavigate,
  useParams,
  useSearchParams,
  Navigate,
} from "react-router-dom";
import { TriangleAlertIcon } from "lucide-react";
import { cn } from "cn";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#components/ui/tooltip";
import {
  updatePresentationTitle,
  updateSongStyle,
  updateSongBackground,
  updateSongInfo,
  updateSlideLines,
  addSlideToSong,
  removeSlideFromSong,
  duplicateSlide,
  splitSlideAtCursor,
  mergeSlideWithNext,
  reorderSongs,
  removeSongFromPresentation,
  addDeckToPresentation,
  duplicateSongInPresentation,
  reorderSlides,
  undo,
  redo,
  canUndo,
  canRedo,
  breakHistoryCoalescing,
  getActivePresentation,
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
  DEFAULT_DECK_STYLE,
  MAX_SLIDE_LINE_LENGTH,
  MAX_SLIDE_LINES,
  analyzeDeckOverflow,
  mergeSlideLines,
  splitLinesAtCursor,
} from "#shared";
import type { DeckStyle, Presentation } from "#shared";
import { EditorHeader } from "../features/editor/EditorHeader";
import { drivePath } from "../features/drive";
import { StorageWarningBanner } from "../components/common/StorageWarningBanner";
import { EditorStageCanvas } from "../features/editor/EditorStageCanvas";
import { SlideThumbnailPane } from "../features/editor/SlideThumbnailPane";
import { EditorRibbon } from "../features/editor/ribbon/EditorRibbon";
import { stepFontSize } from "../features/editor/ribbon/ribbonOptions";
import { StageLyricsEditor } from "../features/editor/StageLyricsEditor";
import { useEditorShortcuts } from "../features/editor/useEditorShortcuts";
import {
  SongPickerModal,
  type SongPickerMode,
} from "../features/editor/SongPickerModal";
import { SongInfoDialog } from "../features/editor/SongInfoDialog";
import { useTextWidthMeasurer } from "../features/editor/useTextWidthMeasurer";
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
  const [songPickerMode, setSongPickerMode] = useState<SongPickerMode | null>(
    null,
  );
  const [editingSongIndex, setEditingSongIndex] = useState<number | null>(null);
  const [textEdit, setTextEdit] = useState<{
    slideId: string;
    caret: "start" | "end";
  } | null>(null);
  const [caret, setCaret] = useState<{
    slideId: string;
    offset: number;
  } | null>(null);
  const [limitHintSlideId, setLimitHintSlideId] = useState<string | null>(null);

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
  const nextSlideInSong = currentSlides[safeSlideIndex + 1] ?? null;
  const currentStyle = currentSong?.style ?? DEFAULT_DECK_STYLE;
  const measureText = useTextWidthMeasurer();
  const currentOverflow = useMemo(
    () =>
      currentSong
        ? analyzeDeckOverflow(
            currentSong.slides,
            currentSong.style,
            measureText,
          )
        : null,
    [currentSong, measureText],
  );

  const songs = presentation.items;
  const position: ProjectionPosition = {
    songIndex: safeSongIndex,
    slideIndex: safeSlideIndex,
  };
  const totalSlideCount = getTotalSlideCount(songs);
  const currentSlideNumber = slideNumberOfPosition(position, songs);

  const editingSong =
    editingSongIndex === null ? undefined : songs[editingSongIndex]?.deck;

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

  const isEditingText = !!currentSlide && textEdit?.slideId === currentSlide.id;
  const caretOffset =
    currentSlide && caret?.slideId === currentSlide.id ? caret.offset : null;

  const startTextEdit = (
    slideId: string | undefined = currentSlide?.id,
    caretAt: "start" | "end" = "end",
  ): void => {
    if (!slideId) return;
    breakHistoryCoalescing();
    setTextEdit({ slideId, caret: caretAt });
  };

  const exitTextEdit = (slideId: string): void => {
    breakHistoryCoalescing();
    setTextEdit((prev) => (prev?.slideId === slideId ? null : prev));
  };

  const slideIdAt = (songIndex: number, slideIndex: number) =>
    getActivePresentation().items[songIndex]?.deck?.slides[slideIndex]?.id;

  const handleAddSlide = () => {
    if (!currentSong) return;
    addSlideToSong(safeSongIndex, [], safeSlideIndex);
    selectPosition({
      songIndex: safeSongIndex,
      slideIndex: safeSlideIndex + 1,
    });
    startTextEdit(slideIdAt(safeSongIndex, safeSlideIndex + 1));
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

  const middleSplitOffset = currentSlide
    ? currentSlide.lines
        .slice(0, Math.ceil(currentSlide.lines.length / 2))
        .join("\n").length
    : 0;
  const splitOffset =
    isEditingText && caretOffset !== null ? caretOffset : middleSplitOffset;
  const canSplit =
    !!currentSlide &&
    splitLinesAtCursor(currentSlide.lines, splitOffset) !== null;
  const canMerge =
    !!currentSlide &&
    !!nextSlideInSong &&
    mergeSlideLines(currentSlide.lines, nextSlideInSong.lines) !== null;

  const handleSplitSlide = (offset: number) => {
    const wasEditing = isEditingText;
    if (!splitSlideAtCursor(safeSongIndex, safeSlideIndex, offset)) return;
    setActiveSlideIndex(safeSlideIndex + 1);
    if (wasEditing) {
      startTextEdit(slideIdAt(safeSongIndex, safeSlideIndex + 1), "start");
    }
  };

  const handleUpdateStyle = (
    update: Partial<DeckStyle>,
    coalesceField?: string,
  ) => {
    updateSongStyle(
      safeSongIndex,
      update,
      coalesceField && currentSong
        ? { coalesceKey: `style:${currentSong.id}:${coalesceField}` }
        : {},
    );
  };

  const selectEdge = (edge: "first" | "last") => {
    if (songs.length === 0) return;
    if (edge === "first") {
      selectPosition(INITIAL_POSITION);
      return;
    }
    const lastSong = songs.length - 1;
    selectPosition(
      clampPosition(
        {
          songIndex: lastSong,
          slideIndex: (songs[lastSong]?.deck?.slides.length ?? 1) - 1,
        },
        songs,
      ),
    );
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

  useEditorShortcuts({
    undo: () => (canUndo() ? undo() : false),
    redo: () => (canRedo() ? redo() : false),
    prevSlide: handlePrevSlide,
    nextSlide: handleNextSlide,
    firstSlide: () => selectEdge("first"),
    lastSlide: () => selectEdge("last"),
    editText: () => (currentSlide ? startTextEdit() : false),
    newSlide: () => (currentSong ? handleAddSlide() : false),
    duplicateSlide: () =>
      currentSlide
        ? handleDuplicateSlide(safeSongIndex, safeSlideIndex)
        : false,
    deleteSlide: () =>
      currentSlide ? handleDeleteSlide(safeSongIndex, safeSlideIndex) : false,
    fontSizeUp: () =>
      currentSong
        ? handleUpdateStyle({
            fontSizeVw: stepFontSize(currentStyle.fontSizeVw, 1),
          })
        : false,
    fontSizeDown: () =>
      currentSong
        ? handleUpdateStyle({
            fontSizeVw: stepFontSize(currentStyle.fontSizeVw, -1),
          })
        : false,
    present: () => (songs.length > 0 ? handlePresent() : false),
  });

  const overflowMessages = [
    currentOverflow?.exceedsStage &&
      "이 곡에서 가장 긴 슬라이드가 화면 가장자리 여백을 넘칩니다. 글자 크기를 줄이거나 슬라이드를 나눠 보세요.",
    currentOverflow?.slides[safeSlideIndex]?.wraps &&
      "현재 슬라이드의 한 줄이 텍스트 박스 폭을 넘어 자동 줄바꿈됩니다. 글자 크기를 줄이거나 박스 폭을 넓혀 보세요.",
  ].filter((message): message is string => !!message);

  if (!found) return <Navigate to="/presentations" replace />;

  return (
    <div
      data-testid="editor-route"
      className="flex h-screen w-screen flex-col overflow-hidden bg-muted/40 select-none"
    >
      <StorageWarningBanner />

      <EditorHeader
        title={presentation.title}
        onUpdateTitle={(newTitle) => updatePresentationTitle(newTitle)}
        onPresent={handlePresent}
        totalSongs={presentation.items.length}
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo()}
        canRedo={canRedo()}
        onNewPresentation={handleNewPresentation}
        onOpenLyricModal={() => setSongPickerMode("create")}
        backPath={drivePath(presentation.folderId)}
      />

      <EditorRibbon
        song={currentSong}
        onUpdateStyle={handleUpdateStyle}
        onUpdateBackground={(backgroundId) =>
          updateSongBackground(safeSongIndex, backgroundId)
        }
        slideControls={{
          hasSlide: !!currentSlide,
          canDelete: currentSlides.length > 1,
          canSplit,
          canMerge,
          splitTitle: canSplit
            ? isEditingText
              ? "커서 위치에서 슬라이드를 둘로 나눕니다 (Ctrl/⌘+Enter)"
              : "슬라이드를 가운데에서 둘로 나눕니다"
            : "가사가 두 줄 이상이거나, 편집 중 가사 사이에 커서가 있어야 나눌 수 있습니다",
          mergeTitle: !nextSlideInSong
            ? "이 곡의 마지막 슬라이드입니다"
            : canMerge
              ? "다음 슬라이드의 가사를 이 슬라이드 뒤에 붙입니다"
              : `합치면 ${MAX_SLIDE_LINES}줄을 넘어 합칠 수 없습니다`,
          onAdd: handleAddSlide,
          onDuplicate: () =>
            handleDuplicateSlide(safeSongIndex, safeSlideIndex),
          onDelete: () => handleDeleteSlide(safeSongIndex, safeSlideIndex),
          onSplit: () => handleSplitSlide(splitOffset),
          onMerge: () => mergeSlideWithNext(safeSongIndex, safeSlideIndex),
        }}
      />

      <div className="flex flex-1 overflow-hidden">
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
          onEditSongInfo={setEditingSongIndex}
          onDeleteSong={handleDeleteSong}
          onOpenSongPicker={() => setSongPickerMode("browse")}
        />

        <EditorStageCanvas
          slide={currentSlide}
          style={currentStyle}
          backgroundUrl={background.videoUrl}
          backgroundImageUrl={background.imageUrl}
          posterUrl={background.posterUrl}
          slideNumber={currentSlideNumber}
          totalSlideCount={totalSlideCount}
          songNumber={songs.length > 0 ? safeSongIndex + 1 : 0}
          totalSongs={songs.length}
          onPrevSlide={handlePrevSlide}
          onNextSlide={handleNextSlide}
          zoomLevel={zoomLevel}
          onZoomChange={setZoomLevel}
          onOpenLyricModal={() => setSongPickerMode("create")}
          onUpdateStyle={(styleUpdate) => handleUpdateStyle(styleUpdate)}
          onRequestTextEdit={() => startTextEdit()}
          textEditor={
            isEditingText && currentSlide ? (
              <StageLyricsEditor
                key={currentSlide.id}
                slide={currentSlide}
                caretColor={currentStyle.fontColor}
                initialCaret={textEdit?.caret}
                onChangeLines={(lines) => {
                  if (lines.length < MAX_SLIDE_LINES) {
                    setLimitHintSlideId(null);
                  }
                  updateSlideLines(safeSongIndex, safeSlideIndex, lines, {
                    coalesceKey: `lines:${currentSlide.id}`,
                  });
                }}
                onLimitHit={() => setLimitHintSlideId(currentSlide.id)}
                onCaretChange={(offset) =>
                  setCaret({ slideId: currentSlide.id, offset })
                }
                onSplit={handleSplitSlide}
                onExit={() => exitTextEdit(currentSlide.id)}
              />
            ) : undefined
          }
          statusItems={
            <>
              {isEditingText && currentSlide && (
                <>
                  <span aria-hidden="true">·</span>
                  <span
                    data-testid="slide-line-count"
                    className={cn(
                      "font-mono",
                      currentSlide.lines.length >= MAX_SLIDE_LINES &&
                        "text-warning",
                    )}
                  >
                    {currentSlide.lines.length}/{MAX_SLIDE_LINES}줄
                  </span>
                  {limitHintSlideId === currentSlide.id && (
                    <span
                      data-testid="slide-line-limit-hint"
                      className="truncate text-warning"
                    >
                      한 슬라이드는 {MAX_SLIDE_LINES}줄, 한 줄{" "}
                      {MAX_SLIDE_LINE_LENGTH}자까지입니다. 더 넣으려면
                      Ctrl/⌘+Enter로 나누세요.
                    </span>
                  )}
                </>
              )}
              {overflowMessages.length > 0 && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span
                        role="status"
                        data-testid="overflow-warning-status"
                        className="flex min-w-0 items-center gap-1 text-warning"
                      />
                    }
                  >
                    <TriangleAlertIcon className="size-3.5 shrink-0" />
                    <span className="truncate">{overflowMessages[0]}</span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-80 whitespace-pre-line">
                    {overflowMessages.join("\n")}
                  </TooltipContent>
                </Tooltip>
              )}
            </>
          }
        />
      </div>

      {editingSongIndex !== null && editingSong && (
        <SongInfoDialog
          heading="제목·아티스트 수정"
          initialValues={{
            title: editingSong.title,
            artist: editingSong.artist,
          }}
          notice="이 세트의 곡만 바뀝니다. 보관함의 원본은 '찬양곡 추가'에서 따로 수정할 수 있습니다."
          onSubmit={(values) => {
            updateSongInfo(editingSongIndex, values);
            setEditingSongIndex(null);
          }}
          onCancel={() => setEditingSongIndex(null)}
        />
      )}

      <SongPickerModal
        isOpen={songPickerMode !== null}
        initialMode={songPickerMode ?? "browse"}
        onClose={() => setSongPickerMode(null)}
        onSelectSong={(newDeck) => {
          addDeckToPresentation(newDeck);
          setActiveSongIndex(presentation.items.length);
          setActiveSlideIndex(0);
          setSongPickerMode(null);
        }}
      />
    </div>
  );
}

export default EditorRoute;
