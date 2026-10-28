"use client";

import React, { useState, useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useNavigate } from "#hooks/useNavigate";
import { LoadingScreen } from "../components/common/LoadingScreen";
import { Navigate } from "../components/common/Navigate";
import { CopyIcon, EyeIcon } from "lucide-react";
import { Alert, AlertAction, AlertDescription } from "#components/ui/alert";
import { Button } from "#components/ui/button";
import { TooltipProvider } from "#components/ui/tooltip";
import {
  updatePresentationTitle,
  updateSongStyle,
  updateSongBackground,
  updateSongInfo,
  reorderSongs,
  removeSongFromPresentation,
  addDeckToPresentation,
  getActivePresentation,
  duplicateSongInPresentation,
  undo,
  redo,
  canUndo,
  canRedo,
  createNewPresentation,
  editorPath,
  startPresentation,
  canEditPresentation,
  clampPosition,
  nextPosition,
  prevPosition,
  getTotalSlideCount,
  slideNumberOfPosition,
  INITIAL_POSITION,
  type ProjectionPosition,
} from "../features/presentation";
import {
  songIndexAfterReorder,
  songSlidesAt,
} from "../features/presentation/projectionState";
import { useOpenedPresentation } from "../features/presentation/useOpenedPresentation";
import { DEFAULT_DECK_STYLE, MAX_SLIDE_LINES } from "#shared";
import { BELOW_MD_QUERY, useMediaQuery } from "#hooks/useMediaQuery";
import type { DeckStyle } from "#shared";
import { EditorHeader } from "../features/editor/EditorHeader";
import { FolderPickerDialog, drivePath } from "../features/drive";
import { StorageWarningBanner } from "../components/common/StorageWarningBanner";
import { EditorStageCanvas } from "../features/editor/EditorStageCanvas";
import { SlideThumbnailPane } from "../features/editor/SlideThumbnailPane";
import { SlideListSheet } from "../features/editor/SlideListSheet";
import { EditorRibbon } from "../features/editor/ribbon/EditorRibbon";
import { stepFontSize } from "../features/editor/ribbon/ribbonOptions";
import { StageLyricsEditor } from "../features/editor/StageLyricsEditor";
import { useSlideTextEditing } from "../features/editor/useSlideTextEditing";
import {
  OverflowWarningStatus,
  SlideLineStatus,
  getOverflowMessages,
} from "../features/editor/EditorStatusItems";
import { useMakeCopyFlow } from "../features/editor/useMakeCopyFlow";
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
import { prefersReducedData } from "../lib/browser/optionalApis";
import { PresentationShareDialog } from "../features/sharing/PresentationShareDialog";
import {
  endSharedPresentationRefresh,
  refreshSharedPresentation,
  subscribeSyncRecovery,
  useBootPullPending,
} from "../lib/sync";
import { useBackgroundLayers } from "../features/backgrounds";
import { DRIVE_COPY } from "#copy/drive";
import { EDITOR_COPY } from "#copy/editor";
import { COMMON_COPY } from "#copy/common";
import { SHELL_COPY } from "#copy/shell";

function songIndexOfDeck(deckId: string): number {
  return getActivePresentation().items.findIndex(
    (item) => item.deck?.id === deckId,
  );
}

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
 * 손님과 데이터 절약 모드에서는 배경 영상을 이 기기에 받아 두지 않는다. 링크를 연 휴대폰마다
 * 프레젠테이션의 영상(수백 MB~수 GB)을 모바일 데이터로 다 받게 되기 때문이다. 포스터만 담고,
 * 미리보기 영상은 스트리밍하며, 헤더에 저장 진행도 띄우지 않는다. 송출을 시작하면 준비 카드가
 * 받는다.
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
  const params = useParams<{ presentationId?: string }>();
  const presentationId = guest?.presentationId ?? params.presentationId;
  const isGuest = guest !== undefined;
  const searchParams = useSearchParams();
  const { found, presentation } = useOpenedPresentation(presentationId);
  const isPullPending = useBootPullPending("presentation");
  const [songPickerMode, setSongPickerMode] = useState<SongPickerMode | null>(
    null,
  );
  const [editingDeckId, setEditingDeckId] = useState<string | null>(null);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const isPhone = useMediaQuery(BELOW_MD_QUERY);
  const [isSlideListOpen, setIsSlideListOpen] = useState(false);
  const makeCopy = useMakeCopyFlow({
    presentationId: presentation.id,
    onGuestRequest: guest?.onRequestCopy,
  });
  const readOnly = !canEditPresentation(presentation);

  useEffect(() => {
    if (!presentationId || !readOnly || isGuest) return;
    const refresh = (): void => {
      void refreshSharedPresentation(presentationId).catch(() => undefined);
    };
    refresh();
    const unsubscribe = subscribeSyncRecovery(refresh);
    return () => {
      unsubscribe();
      endSharedPresentationRefresh();
    };
  }, [presentationId, readOnly, isGuest]);

  useEffect(() => {
    if (!isPhone) setIsSlideListOpen(false);
  }, [isPhone]);

  const cachesBackgrounds = !isGuest && !prefersReducedData();
  useBackgroundAutoCache(found ?? null, { posterOnly: !cachesBackgrounds });

  const initialSongIndex = Math.min(
    Math.max(0, Number(searchParams.get("song") || 0)),
    Math.max(0, presentation.items.length - 1),
  );

  const [activeSongIndex, setActiveSongIndex] =
    useState<number>(initialSongIndex);
  const [activeSlideIndex, setActiveSlideIndex] = useState<number>(0);

  useEffect(() => {
    const requested = Number(searchParams.get("song") || 0);
    setActiveSongIndex(Number.isFinite(requested) ? Math.max(0, requested) : 0);
    setActiveSlideIndex(0);
    setSongPickerMode(null);
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
    editingDeckId === null
      ? undefined
      : songs.find((item) => item.deck?.id === editingDeckId)?.deck;

  const background = useCacheFirstVideo(
    useBackgroundLayers(currentSong?.backgroundId),
    { cacheFirst: cachesBackgrounds },
  );

  const mediaReadiness = useProjectionMediaReady(
    cachesBackgrounds ? (found ?? null) : null,
    { passive: true },
  );

  const handlePresent = () => {
    if (presentationId) {
      if (found) void warmPresentationFonts(found).catch(() => undefined);
      startPresentation(
        navigate,
        presentationId,
        guest?.returnPath ?? editorPath(presentationId),
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

  const textEditing = useSlideTextEditing({
    songIndex: safeSongIndex,
    slideIndex: safeSlideIndex,
    currentSlide,
    nextSlideInSong,
    select: selection.select,
  });
  const { isEditingText, canSplit, canMerge } = textEditing;

  const handleAddSlide = () => {
    const newId = selection.addSlide();
    if (newId) textEditing.start(newId);
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
          slideIndex: songSlidesAt(songs, lastSong).length - 1,
        },
        songs,
      ),
    );
  };

  const handleReorderSong = (from: number, to: number) => {
    reorderSongs(from, to);
    selection.clearInsertion();
    const nextSongIndex = songIndexAfterReorder(safeSongIndex, from, to);
    if (nextSongIndex !== safeSongIndex) setActiveSongIndex(nextSongIndex);
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

  const handleNewPresentation = () => {
    const created = createNewPresentation(presentation.folderId ?? null);
    setActiveSongIndex(0);
    setActiveSlideIndex(0);
    navigate(editorPath(created.id));
  };

  const editShortcuts = readOnly
    ? {}
    : {
        duplicateSlide: selection.duplicateSelection,
        deleteSlide: selection.deleteSelection,
        cutSlides: selection.cut,
        pasteSlides: selection.paste,
        moveSlidesUp: () => selection.moveSelection("up"),
        moveSlidesDown: () => selection.moveSelection("down"),
        moveSlidesToStart: () => selection.moveSelection("start"),
        moveSlidesToEnd: () => selection.moveSelection("end"),
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
      };

  useEditorShortcuts({
    undo: () => (canUndo() ? undo() : false),
    redo: () => (canRedo() ? redo() : false),
    prevSlide: handlePrevSlide,
    nextSlide: handleNextSlide,
    firstSlide: () => selectEdge("first"),
    lastSlide: () => selectEdge("last"),
    editText: () => (currentSlide && !readOnly ? textEditing.start() : false),
    newSlide: () => (currentSong && !readOnly ? handleAddSlide() : false),
    selectAll: selection.selectAll,
    copySlides: selection.copy,
    extendPrev: () => selection.extend(-1),
    extendNext: () => selection.extend(1),
    clearInsertion: selection.clearInsertion,
    present: () => (songs.length > 0 ? handlePresent() : false),
    ...editShortcuts,
  });

  const overflowMessages = getOverflowMessages(currentOverflow, safeSlideIndex);

  const slidePane = (
    <SlideThumbnailPane
      items={songs}
      activeSongIndex={safeSongIndex}
      activeSlideIndex={safeSlideIndex}
      selectedIds={selection.selectedIds}
      insertion={selection.insertion}
      canDelete={selection.canDelete}
      canPaste={selection.canPaste}
      onClickSlide={selection.clickSlide}
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
      onEditSongInfo={(songIndex) =>
        setEditingDeckId(songs[songIndex]?.deck?.id ?? null)
      }
      onDeleteSong={handleDeleteSong}
      onOpenSongPicker={() => setSongPickerMode("browse")}
      readOnly={readOnly}
      variant={isPhone ? "sheet" : "docked"}
      onSlideChosen={isPhone ? () => setIsSlideListOpen(false) : undefined}
    />
  );

  if (!found) {
    if (isPullPending && !isGuest) {
      return (
        <LoadingScreen testId="editor-pending">
          {SHELL_COPY.routeLoading}
        </LoadingScreen>
      );
    }
    return (
      <Navigate
        to={drivePath(null)}
        notice={DRIVE_COPY.toast.presentationNotFound}
      />
    );
  }

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
        onMakeCopy={readOnly ? makeCopy.open : undefined}
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
          <Alert
            data-testid="read-only-banner"
            className="has-data-[slot=alert-action]:pr-28"
          >
            <EyeIcon />
            <AlertDescription>
              {isGuest
                ? EDITOR_COPY.readOnly.guest
                : EDITOR_COPY.readOnly.member}
            </AlertDescription>
            <AlertAction className="top-1/2 -translate-y-1/2">
              <Button
                data-testid="make-copy-btn"
                size="sm"
                onClick={makeCopy.open}
              >
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
          onUpdateBackground={(deckId, choice) => {
            const songIndex = songIndexOfDeck(deckId);
            if (songIndex >= 0) updateSongBackground(songIndex, choice);
          }}
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
            onSplit: () => textEditing.split(textEditing.splitOffset),
            onMerge: textEditing.merge,
          }}
        />
      )}

      <div className="flex flex-1 overflow-hidden">
        {isPhone ? (
          <SlideListSheet
            open={isSlideListOpen}
            onOpenChange={setIsSlideListOpen}
          >
            {slidePane}
          </SlideListSheet>
        ) : (
          slidePane
        )}

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
          onOpenLyricModal={
            readOnly ? undefined : () => setSongPickerMode("create")
          }
          onUpdateStyle={
            readOnly
              ? undefined
              : (styleUpdate) => handleUpdateStyle(styleUpdate)
          }
          onRequestTextEdit={readOnly ? undefined : () => textEditing.start()}
          textEditor={
            isEditingText && currentSlide ? (
              <StageLyricsEditor
                key={currentSlide.id}
                slide={currentSlide}
                caretColor={currentStyle.fontColor}
                initialCaret={textEditing.initialCaret}
                onChangeLines={textEditing.changeLines}
                onLimitHit={textEditing.hitLimit}
                onCaretChange={textEditing.updateCaret}
                onSplit={textEditing.split}
                onExit={() => textEditing.exit(currentSlide.id)}
              />
            ) : undefined
          }
          statusItems={
            <>
              {isEditingText && currentSlide && (
                <SlideLineStatus
                  lineCount={currentSlide.lines.length}
                  showLimitHint={textEditing.isLimitHintShown}
                />
              )}
              <OverflowWarningStatus messages={overflowMessages} />
            </>
          }
          onOpenSlideList={isPhone ? () => setIsSlideListOpen(true) : undefined}
        />
      </div>

      {editingSong && (
        <SongInfoDialog
          heading={EDITOR_COPY.song.editInfo}
          initialValues={{
            title: editingSong.title,
            artist: editingSong.artist,
          }}
          notice={EDITOR_COPY.song.setOnlyNotice}
          onSubmit={(values) => {
            const songIndex = songIndexOfDeck(editingSong.id);
            if (songIndex >= 0) updateSongInfo(songIndex, values);
            setEditingDeckId(null);
          }}
          onCancel={() => setEditingDeckId(null)}
        />
      )}

      {makeCopy.isPickerOpen && (
        <FolderPickerDialog
          testId="copy-picker-dialog"
          confirmTestId="copy-picker-confirm"
          title={EDITOR_COPY.copyDialog.title(presentation.title)}
          description={EDITOR_COPY.copyDialog.description}
          targetLabel={EDITOR_COPY.copyDialog.target}
          confirmLabel={COMMON_COPY.makeCopy}
          initialFolderId={null}
          onConfirm={makeCopy.confirm}
          onCancel={makeCopy.cancel}
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
          if (getActivePresentation().id !== presentation.id) return;
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
