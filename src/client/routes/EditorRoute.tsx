import React, { useState, useEffect, useLayoutEffect } from "react";
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
  Navigate,
} from "react-router-dom";
import { CopyIcon, EyeIcon, TriangleAlertIcon } from "lucide-react";
import { cn } from "cn";
import { toast } from "sonner";
import { Alert, AlertAction, AlertDescription } from "#components/ui/alert";
import { Button } from "#components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "#components/ui/tooltip";
import {
  updatePresentationTitle,
  updateSongStyle,
  updateSongBackground,
  updateSongInfo,
  updateSlideLines,
  splitSlideAtCursor,
  mergeSlideWithNext,
  reorderSongs,
  removeSongFromPresentation,
  addDeckToPresentation,
  duplicateSongInPresentation,
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
  canEditPresentation,
  duplicatePresentation,
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
  mergeSlideLines,
  splitLinesAtCursor,
} from "#shared";
import type { DeckStyle, Presentation } from "#shared";
import { EditorHeader } from "../features/editor/EditorHeader";
import { FolderPickerDialog, drivePath } from "../features/drive";
import { StorageWarningBanner } from "../components/common/StorageWarningBanner";
import { EditorStageCanvas } from "../features/editor/EditorStageCanvas";
import { SlideThumbnailPane } from "../features/editor/SlideThumbnailPane";
import { EditorRibbon } from "../features/editor/ribbon/EditorRibbon";
import { stepFontSize } from "../features/editor/ribbon/ribbonOptions";
import { StageLyricsEditor } from "../features/editor/StageLyricsEditor";
import { useEditorShortcuts } from "../features/editor/useEditorShortcuts";
import { useSlideSelection } from "../features/editor/useSlideSelection";
import {
  SongPickerModal,
  type SongPickerMode,
} from "../features/editor/SongPickerModal";
import { SongInfoDialog } from "../features/editor/SongInfoDialog";
import {
  analyzeDeckOverflowCached,
  useTextWidthMeasurer,
} from "../features/editor/useTextWidthMeasurer";
import {
  useBackgroundAutoCache,
  useCacheFirstVideo,
  useProjectionMediaReady,
} from "../features/offline";
import { warmPresentationFonts } from "../lib/offline";
import { PresentationShareDialog } from "../features/sharing/PresentationShareDialog";
import { wantsMakeCopy } from "../features/sharing/shareLink";
import { refreshSharedPresentation } from "../lib/sync";
import {
  resolveBackgroundLayers,
  useBackground,
} from "../features/backgrounds";
import { EDITOR_COPY } from "#copy/editor";
import { COMMON_COPY } from "#copy/common";

const EMPTY_PRESENTATION: Presentation = {
  id: "",
  userId: "",
  title: "",
  serviceDate: "",
  items: [],
  createdAt: "",
  updatedAt: "",
};

/** 로그인하지 않고 공유 링크로 볼 때 편집기를 보기 화면으로 쓰기 위한 설정 */
export interface EditorGuestOptions {
  presentationId: string;
  /** 송출을 마치고 돌아올 주소 (공유 링크) */
  returnPath: string;
  /** 사본은 내 계정에 남으므로 로그인부터 받는다 */
  onRequestCopy: () => void;
}

/**
 * PowerPoint식 프레젠테이션 편집기 라우트.
 *
 * `guest`가 있으면 로그인하지 않은 사람의 공유 세트 보기다. 드라이브·새 세트가
 * 없고, 서버 최신본 받기(로그인 필요)도 하지 않는다.
 *
 * 툴팁 Provider를 앱 루트가 아니라 여기에 두는 것은 Base UI 툴팁 전체가 로그인·송출
 * 화면이 받는 메인 청크에 들어가지 않게 하기 위해서다.
 */
export function EditorRoute(props: {
  guest?: EditorGuestOptions;
}): React.JSX.Element {
  return (
    <TooltipProvider>
      <EditorScreen {...props} />
    </TooltipProvider>
  );
}

function EditorScreen({
  guest,
}: {
  guest?: EditorGuestOptions;
}): React.JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ presentationId: string }>();
  const presentationId = guest?.presentationId ?? params.presentationId;
  const isGuest = guest !== undefined;
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
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isCopyPickerOpen, setIsCopyPickerOpen] = useState(() =>
    wantsMakeCopy(location.state),
  );
  const readOnly = !canEditPresentation(presentation);

  useLayoutEffect(() => {
    if (presentationId) openPresentation(presentationId);
  }, [presentationId]);

  useEffect(() => {
    if (!wantsMakeCopy(location.state)) return;
    navigate(`${location.pathname}${location.search}`, {
      replace: true,
      state: null,
    });
  }, [location, navigate]);

  useEffect(() => {
    if (!presentationId || !readOnly || isGuest) return;
    const refresh = (): void => {
      void refreshSharedPresentation(presentationId).catch(() => undefined);
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [presentationId, readOnly, isGuest]);

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
  const currentOverflow = currentSong
    ? analyzeDeckOverflowCached(currentSong, measureText)
    : null;

  const songs = presentation.items;
  const position: ProjectionPosition = {
    songIndex: safeSongIndex,
    slideIndex: safeSlideIndex,
  };
  const totalSlideCount = getTotalSlideCount(songs);
  const currentSlideNumber = slideNumberOfPosition(position, songs);

  const editingSong =
    editingSongIndex === null ? undefined : songs[editingSongIndex]?.deck;

  const background = useCacheFirstVideo(
    resolveBackgroundLayers(useBackground(currentSong?.backgroundId)),
  );

  const mediaReadiness = useProjectionMediaReady(found ?? null, {
    passive: true,
  });

  const handlePresent = () => {
    if (presentationId) {
      if (found) void warmPresentationFonts(found).catch(() => undefined);
      launchPresentation(
        navigate,
        presentationId,
        guest?.returnPath ?? `/editor/${presentationId}`,
      );
    }
  };

  const selectPosition = (next: ProjectionPosition) => {
    setActiveSongIndex(next.songIndex);
    setActiveSlideIndex(next.slideIndex);
  };

  const selection = useSlideSelection({
    songs,
    position,
    setPosition: selectPosition,
  });

  const handlePrevSlide = () => selection.select(prevPosition(position, songs));
  const handleNextSlide = () => selection.select(nextPosition(position, songs));

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
    const newId = selection.addSlide();
    if (newId) startTextEdit(newId);
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
    selection.select({
      songIndex: safeSongIndex,
      slideIndex: safeSlideIndex + 1,
    });
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
      selection.select(INITIAL_POSITION);
      return;
    }
    const lastSong = songs.length - 1;
    selection.select(
      clampPosition(
        {
          songIndex: lastSong,
          slideIndex: (songs[lastSong]?.deck?.slides.length ?? 1) - 1,
        },
        songs,
      ),
    );
  };

  const handleReorderSong = (from: number, to: number) => {
    reorderSongs(from, to);
    selection.clearInsertion();
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
    selection.select({ songIndex: idx + 1, slideIndex: 0 });
  };

  const handleDeleteSong = (idx: number) => {
    removeSongFromPresentation(idx);
    const newCount = songs.length - 1;
    if (newCount <= 0) {
      selection.select(INITIAL_POSITION);
      return;
    }
    if (idx === safeSongIndex) {
      selection.select({
        songIndex: Math.min(safeSongIndex, newCount - 1),
        slideIndex: 0,
      });
    } else if (idx < safeSongIndex) {
      setActiveSongIndex(safeSongIndex - 1);
    }
  };

  const handleMakeCopy = (folderId: string | null) => {
    setIsCopyPickerOpen(false);
    const copy = duplicatePresentation(presentation.id, folderId);
    if (!copy) return;
    toast.success(EDITOR_COPY.copyDialog.created);
    navigate(`/editor/${copy.id}`);
  };

  const openCopy = guest
    ? guest.onRequestCopy
    : () => setIsCopyPickerOpen(true);

  const handleNewPresentation = () => {
    const created = createNewPresentation(
      undefined,
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
    editText: () => (currentSlide && !readOnly ? startTextEdit() : false),
    newSlide: () => (currentSong && !readOnly ? handleAddSlide() : false),
    duplicateSlide: selection.duplicateSelection,
    deleteSlide: selection.deleteSelection,
    selectAll: selection.selectAll,
    copySlides: selection.copy,
    cutSlides: selection.cut,
    pasteSlides: selection.paste,
    extendPrev: () => selection.extend(-1),
    extendNext: () => selection.extend(1),
    moveSlidesUp: () => selection.moveSelection("up"),
    moveSlidesDown: () => selection.moveSelection("down"),
    moveSlidesToStart: () => selection.moveSelection("start"),
    moveSlidesToEnd: () => selection.moveSelection("end"),
    clearInsertion: selection.clearInsertion,
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
    currentOverflow?.exceedsStage && EDITOR_COPY.overflow.stage,
    currentOverflow?.slides[safeSlideIndex]?.wraps && EDITOR_COPY.overflow.wrap,
  ].filter((message) => typeof message === "string");

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
        onUndo={readOnly ? undefined : undo}
        onRedo={readOnly ? undefined : redo}
        canUndo={canUndo()}
        canRedo={canRedo()}
        onNewPresentation={isGuest ? undefined : handleNewPresentation}
        onOpenLyricModal={
          readOnly ? undefined : () => setSongPickerMode("create")
        }
        onShare={readOnly ? undefined : () => setIsShareOpen(true)}
        onMakeCopy={readOnly ? openCopy : undefined}
        sharedAccess={presentation.access}
        readOnly={readOnly}
        backPath={
          isGuest ? null : drivePath(readOnly ? null : presentation.folderId)
        }
        mediaProgress={
          mediaReadiness.status === "ready" ||
          mediaReadiness.status === "checking"
            ? null
            : mediaReadiness
        }
      />

      {readOnly ? (
        <div className="border-b bg-background px-4 py-2">
          <Alert data-testid="read-only-banner">
            <EyeIcon />
            <AlertDescription>
              {isGuest
                ? EDITOR_COPY.readOnly.guest
                : EDITOR_COPY.readOnly.member}
            </AlertDescription>
            <AlertAction className="top-1/2 -translate-y-1/2">
              <Button data-testid="make-copy-btn" size="sm" onClick={openCopy}>
                <CopyIcon />
                {COMMON_COPY.makeCopy}
              </Button>
            </AlertAction>
          </Alert>
        </div>
      ) : (
        <EditorRibbon
          song={currentSong}
          onUpdateStyle={handleUpdateStyle}
          onUpdateBackground={(choice) =>
            updateSongBackground(safeSongIndex, choice)
          }
          slideControls={{
            hasSlide: !!currentSlide,
            canDelete: selection.canDelete,
            canSplit,
            canMerge,
            splitTitle: canSplit
              ? isEditingText
                ? EDITOR_COPY.slide.splitAtCursor
                : EDITOR_COPY.slide.splitInHalf
              : EDITOR_COPY.slide.cannotSplit,
            mergeTitle: !nextSlideInSong
              ? EDITOR_COPY.slide.lastInSong
              : canMerge
                ? EDITOR_COPY.slide.mergeNext
                : EDITOR_COPY.slide.mergeTooLong(MAX_SLIDE_LINES),
            onAdd: handleAddSlide,
            onDuplicate: selection.duplicateSelection,
            onDelete: selection.deleteSelection,
            onSplit: () => handleSplitSlide(splitOffset),
            onMerge: () => mergeSlideWithNext(safeSongIndex, safeSlideIndex),
          }}
        />
      )}

      <div className="flex flex-1 overflow-hidden">
        <SlideThumbnailPane
          items={songs}
          activeSongIndex={safeSongIndex}
          activeSlideIndex={safeSlideIndex}
          selectedIds={selection.selectedIds}
          insertion={selection.insertion}
          canDelete={selection.canDelete}
          canPaste={selection.canPaste}
          onClickSlide={(songIndex, slideIndex, modifiers) =>
            selection.clickSlide(songIndex, slideIndex, modifiers)
          }
          onSelectSong={selection.selectSong}
          onSetInsertion={selection.setInsertion}
          onAddSlide={handleAddSlide}
          onDuplicateSlides={selection.duplicateSelection}
          onDeleteSlides={selection.deleteSelection}
          onCopySlides={selection.copy}
          onCutSlides={selection.cut}
          onPasteSlides={selection.paste}
          onDropSlides={selection.dropSelection}
          onReorderSong={handleReorderSong}
          onDuplicateSong={handleDuplicateSong}
          onEditSongInfo={setEditingSongIndex}
          onDeleteSong={handleDeleteSong}
          onOpenSongPicker={() => setSongPickerMode("browse")}
          readOnly={readOnly}
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
          onOpenLyricModal={
            readOnly ? undefined : () => setSongPickerMode("create")
          }
          onUpdateStyle={
            readOnly
              ? undefined
              : (styleUpdate) => handleUpdateStyle(styleUpdate)
          }
          onRequestTextEdit={readOnly ? undefined : () => startTextEdit()}
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
                    {EDITOR_COPY.slide.lineUsage(
                      currentSlide.lines.length,
                      MAX_SLIDE_LINES,
                    )}
                  </span>
                  {limitHintSlideId === currentSlide.id && (
                    <span
                      data-testid="slide-line-limit-hint"
                      className="truncate text-warning"
                    >
                      {EDITOR_COPY.slide.lineLimit(
                        MAX_SLIDE_LINES,
                        MAX_SLIDE_LINE_LENGTH,
                      )}
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
          heading={EDITOR_COPY.song.editInfo}
          initialValues={{
            title: editingSong.title,
            artist: editingSong.artist,
          }}
          notice={EDITOR_COPY.song.setOnlyNotice}
          onSubmit={(values) => {
            updateSongInfo(editingSongIndex, values);
            setEditingSongIndex(null);
          }}
          onCancel={() => setEditingSongIndex(null)}
        />
      )}

      {isCopyPickerOpen && (
        <FolderPickerDialog
          testId="copy-picker-dialog"
          confirmTestId="copy-picker-confirm"
          title={EDITOR_COPY.copyDialog.title(presentation.title)}
          description={EDITOR_COPY.copyDialog.description}
          targetLabel={EDITOR_COPY.copyDialog.target}
          confirmLabel={COMMON_COPY.makeCopy}
          initialFolderId={null}
          onConfirm={handleMakeCopy}
          onCancel={() => setIsCopyPickerOpen(false)}
        />
      )}

      {!readOnly && (
        <PresentationShareDialog
          presentationId={presentation.id}
          title={presentation.title}
          isOpen={isShareOpen}
          onClose={() => setIsShareOpen(false)}
        />
      )}

      <SongPickerModal
        isOpen={songPickerMode !== null}
        initialMode={songPickerMode ?? "browse"}
        onClose={() => setSongPickerMode(null)}
        onSelectSong={(newDeck) => {
          addDeckToPresentation(newDeck);
          selection.select({
            songIndex: presentation.items.length,
            slideIndex: 0,
          });
          setSongPickerMode(null);
        }}
      />
    </div>
  );
}

export default EditorRoute;
