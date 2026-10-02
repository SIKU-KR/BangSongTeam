import React, { useEffect, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
} from "@dnd-kit/core";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  ClipboardPasteIcon,
  CopyIcon,
  CopyPlusIcon,
  EllipsisIcon,
  PencilIcon,
  PlusIcon,
  ScissorsIcon,
  Trash2Icon,
} from "lucide-react";
import { cn } from "cn";
import { Button } from "#components/ui/button";
import { Empty, EmptyDescription, EmptyHeader } from "#components/ui/empty";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "#components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "#components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#components/ui/tooltip";
import { IconButton } from "#components/common/IconButton";
import type { DeckOverflow, PresentationItem } from "#shared";
import {
  getBackgroundById,
  useBackgroundCatalog,
} from "../backgrounds/backgroundCatalog";
import {
  ActionMenuItems,
  type MenuAction,
} from "#components/common/ActionMenu";
import {
  OverflowWarning,
  PaneDropLine,
  SlideGap,
  SlidePreview,
  SlideThumbnail,
} from "./SlideThumbnail";
import type { ClickModifiers, SlideInsertion } from "./slideSelection";
import type { PaneDragData } from "./slidePaneDnd";
import {
  paneRootAttrs,
  paneTargetAttrs,
  readPaneTarget,
} from "./slidePaneTargets";
import { useCollapsedSongs } from "./useCollapsedSongs";
import { useSlidePaneDrag } from "./useSlidePaneDrag";
import {
  analyzeDeckOverflowCached,
  useTextWidthMeasurer,
} from "./useTextWidthMeasurer";
import { EDITOR_COPY } from "#copy/editor";
import { COMMON_COPY } from "#copy/common";

export interface SlideThumbnailPaneProps {
  items: PresentationItem[];
  activeSongIndex: number;
  activeSlideIndex: number;
  /** 현재 곡에서 선택된 슬라이드 id. 삽입 커서가 있으면 비어 있다 */
  selectedIds: readonly string[];
  insertion: SlideInsertion | null;
  canDelete: boolean;
  canPaste: boolean;
  onClickSlide: (
    songIndex: number,
    slideIndex: number,
    modifiers: ClickModifiers,
  ) => void;
  onSelectSong: (songIndex: number) => void;
  onSetInsertion: (insertion: SlideInsertion) => void;
  onAddSlide: () => void;
  onDuplicateSlides: () => void;
  onDeleteSlides: () => void;
  onCopySlides: () => void;
  onCutSlides: () => void;
  onPasteSlides: () => void;
  /** 선택한 슬라이드를 현재 곡의 틈 번호 자리로 옮긴다 */
  onDropSlides: (insertBefore: number) => void;
  onReorderSong: (fromIndex: number, toIndex: number) => void;
  onDuplicateSong: (songIndex: number) => void;
  onEditSongInfo: (songIndex: number) => void;
  onDeleteSong: (songIndex: number) => void;
  onOpenSongPicker: () => void;
  /** 보기 권한으로 공유받은 세트. 선택·펼치기만 되고 메뉴·끌기·추가는 없다 */
  readOnly?: boolean;
}

type MenuTarget =
  { kind: "slides" } | { kind: "gap" } | { kind: "song"; songIndex: number };

const NO_MODIFIERS: ClickModifiers = { shift: false, mod: false };

function actionsFor(
  menuTarget: MenuTarget | null,
  actions: {
    slides: MenuAction[];
    gap: MenuAction[];
    song: (songIndex: number) => MenuAction[];
  },
): MenuAction[] {
  switch (menuTarget?.kind) {
    case "slides":
      return actions.slides;
    case "gap":
      return actions.gap;
    case "song":
      return actions.song(menuTarget.songIndex);
    default:
      return [];
  }
}

function songOverflowWarning(
  overflow: DeckOverflow | null,
  firstIndex: number,
): string | null {
  if (!overflow?.exceedsStage || overflow.tallestSlideIndex === null) {
    return null;
  }
  return EDITOR_COPY.overflow.tallestSlide(
    firstIndex + overflow.tallestSlideIndex + 1,
  );
}

function slideOverflowWarning(
  overflow: DeckOverflow | null,
  slideIndex: number,
  songWarning: string | null,
): string {
  return [
    overflow?.slides[slideIndex]?.wraps ? EDITOR_COPY.overflow.wrap : null,
    songWarning && overflow?.tallestSlideIndex === slideIndex
      ? EDITOR_COPY.overflow.stage
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * PowerPoint식 슬라이드 썸네일 창. 곡은 구역, 번호는 세트 전체에 이어진다.
 *
 * 클릭·Ctrl/⌘·Shift 선택, 썸네일 사이 삽입 커서, 우클릭 메뉴, 여러 장 끌기를
 * 지원한다. 선택·끌기·붙여넣기는 곡마다 서식이 달라 한 곡 안에서만 한다.
 * 창 자체가 포커스를 받아 편집기 단축키가 창 전용 키(`data-slide-pane`)를 켠다.
 */
export function SlideThumbnailPane({
  items,
  activeSongIndex,
  activeSlideIndex,
  selectedIds,
  insertion,
  canDelete,
  canPaste,
  onClickSlide,
  onSelectSong,
  onSetInsertion,
  onAddSlide,
  onDuplicateSlides,
  onDeleteSlides,
  onCopySlides,
  onCutSlides,
  onPasteSlides,
  onDropSlides,
  onReorderSong,
  onDuplicateSong,
  onEditSongInfo,
  onDeleteSong,
  onOpenSongPicker,
  readOnly = false,
}: SlideThumbnailPaneProps): React.JSX.Element {
  useBackgroundCatalog();
  const [menuTarget, setMenuTarget] = useState<MenuTarget | null>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const activeThumbRef = useRef<HTMLDivElement>(null);

  const activeItemId = items[activeSongIndex]?.id;
  const collapsedSongs = useCollapsedSongs(activeItemId);
  const measureText = useTextWidthMeasurer();
  const overflows = items.map((item) =>
    item.deck ? analyzeDeckOverflowCached(item.deck, measureText) : null,
  );

  const firstIndexes: number[] = [];
  let totalSlides = 0;
  for (const item of items) {
    firstIndexes.push(totalSlides);
    totalSlides += item.deck?.slides.length ?? 0;
  }

  useEffect(() => {
    activeThumbRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [activeSongIndex, activeSlideIndex]);

  const focusPane = () => paneRef.current?.focus({ preventScroll: true });

  const selectAndToggleSong = (songIndex: number, itemId: string) => {
    const willSelectAnother =
      songIndex !== activeSongIndex &&
      (items[songIndex]?.deck?.slides.length ?? 0) > 0;
    if (willSelectAnother) collapsedSongs.keepCollapsedOnActivate(itemId);
    collapsedSongs.toggle(itemId);
    focusPane();
    onSelectSong(songIndex);
  };

  const isSelected = (songIndex: number, slideId: string) =>
    songIndex === activeSongIndex && selectedIds.includes(slideId);

  const { dndContextProps, dragging, dropTarget } = useSlidePaneDrag({
    isReadOnly: readOnly,
    isSelected,
    onPickSlide: (songIndex, slideIndex) =>
      onClickSlide(songIndex, slideIndex, NO_MODIFIERS),
    onDropSlides,
    onReorderSong,
    onDragBegin: focusPane,
  });

  const pasteAction: MenuAction = {
    key: "paste",
    label: EDITOR_COPY.thumbnails.paste,
    icon: ClipboardPasteIcon,
    shortcut: "Ctrl+V",
    disabled: !canPaste,
    onSelect: onPasteSlides,
  };

  const newSlideAction: MenuAction = {
    key: "new",
    label: EDITOR_COPY.slide.add,
    icon: PlusIcon,
    shortcut: "Ctrl+M",
    onSelect: onAddSlide,
  };

  const slideActions: MenuAction[] = [
    {
      key: "cut",
      label: EDITOR_COPY.thumbnails.cut,
      icon: ScissorsIcon,
      shortcut: "Ctrl+X",
      disabled: !canDelete,
      onSelect: onCutSlides,
    },
    {
      key: "copy",
      label: COMMON_COPY.copy,
      icon: CopyIcon,
      shortcut: "Ctrl+C",
      onSelect: onCopySlides,
    },
    pasteAction,
    { ...newSlideAction, separated: true },
    {
      key: "duplicate",
      label: EDITOR_COPY.slide.duplicate,
      icon: CopyPlusIcon,
      shortcut: "Ctrl+D",
      onSelect: onDuplicateSlides,
    },
    {
      key: "delete",
      label: EDITOR_COPY.slide.delete,
      icon: Trash2Icon,
      shortcut: "Delete",
      danger: true,
      disabled: !canDelete,
      onSelect: onDeleteSlides,
    },
  ];

  const gapActions: MenuAction[] = [pasteAction, newSlideAction];

  const layoutActions: MenuAction[] = [
    {
      key: "collapse-all",
      label: EDITOR_COPY.thumbnails.collapseAll,
      icon: ChevronsDownUpIcon,
      separated: true,
      onSelect: () => collapsedSongs.collapseAll(items.map((item) => item.id)),
    },
    {
      key: "expand-all",
      label: EDITOR_COPY.thumbnails.expandAll,
      icon: ChevronsUpDownIcon,
      onSelect: collapsedSongs.expandAll,
    },
  ];

  const songActions = (songIndex: number): MenuAction[] =>
    readOnly
      ? layoutActions
      : [
          {
            key: "up",
            label: EDITOR_COPY.song.moveUp,
            icon: ArrowUpIcon,
            disabled: songIndex === 0,
            onSelect: () => onReorderSong(songIndex, songIndex - 1),
          },
          {
            key: "down",
            label: EDITOR_COPY.song.moveDown,
            icon: ArrowDownIcon,
            disabled: songIndex === items.length - 1,
            onSelect: () => onReorderSong(songIndex, songIndex + 1),
          },
          {
            key: "info",
            label: EDITOR_COPY.song.editInfo,
            icon: PencilIcon,
            onSelect: () => onEditSongInfo(songIndex),
          },
          {
            key: "duplicate",
            label: EDITOR_COPY.song.duplicate,
            icon: CopyPlusIcon,
            onSelect: () => onDuplicateSong(songIndex),
          },
          ...layoutActions,
          {
            key: "remove",
            label: EDITOR_COPY.song.removeFromSet,
            icon: Trash2Icon,
            danger: true,
            separated: true,
            onSelect: () => onDeleteSong(songIndex),
          },
        ];

  const menuActions = actionsFor(menuTarget, {
    slides: slideActions,
    gap: gapActions,
    song: songActions,
  });

  const handleContextMenu = (
    event: React.MouseEvent & { preventBaseUIHandler: () => void },
  ) => {
    if (readOnly) {
      event.preventBaseUIHandler();
      return;
    }
    const target = readPaneTarget(event.target as Element);
    focusPane();
    switch (target?.kind) {
      case "slide": {
        const { songIndex, slideIndex } = target;
        const slideId = items[songIndex]?.deck?.slides[slideIndex]?.id ?? "";
        if (!isSelected(songIndex, slideId)) {
          onClickSlide(songIndex, slideIndex, NO_MODIFIERS);
        }
        setMenuTarget({ kind: "slides" });
        break;
      }
      case "gap":
        onSetInsertion({ songIndex: target.songIndex, index: target.index });
        setMenuTarget({ kind: "gap" });
        break;
      case "header":
        setMenuTarget({ kind: "song", songIndex: target.songIndex });
        break;
      default:
        if (items.length > 0) {
          const lastSong = items.length - 1;
          onSetInsertion({
            songIndex: lastSong,
            index: items[lastSong].deck?.slides.length ?? 0,
          });
          setMenuTarget({ kind: "gap" });
        } else {
          event.preventBaseUIHandler();
        }
    }
  };

  const handleClick = (event: React.MouseEvent) => {
    const target = readPaneTarget(event.target as Element);
    if (target?.kind !== "slide") return;
    focusPane();
    onClickSlide(target.songIndex, target.slideIndex, {
      shift: event.shiftKey,
      mod: event.metaKey || event.ctrlKey,
    });
  };

  const draggedCount =
    dragging?.type === "slide" ? Math.max(1, selectedIds.length) : 0;
  const draggedSlide =
    dragging?.type === "slide"
      ? items[dragging.songIndex]?.deck?.slides[dragging.slideIndex]
      : undefined;
  const draggedDeck = dragging ? items[dragging.songIndex]?.deck : undefined;

  return (
    <aside
      data-testid="slide-thumbnail-pane"
      className="flex w-64 shrink-0 flex-col border-r bg-background select-none"
    >
      <div className="flex h-11 shrink-0 items-center justify-between border-b px-3">
        <span className="text-xs font-bold">
          {EDITOR_COPY.slide.label}{" "}
          <span className="font-mono font-medium text-muted-foreground">
            {totalSlides}
          </span>
        </span>
        {!readOnly && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="xs"
                  data-testid="add-slide-btn"
                  disabled={items.length === 0}
                  onClick={onAddSlide}
                />
              }
            >
              <PlusIcon />
              {EDITOR_COPY.slide.add}
            </TooltipTrigger>
            <TooltipContent>{EDITOR_COPY.slide.addTooltip}</TooltipContent>
          </Tooltip>
        )}
      </div>

      <DndContext {...dndContextProps}>
        <ContextMenu>
          <ContextMenuTrigger
            ref={paneRef}
            tabIndex={0}
            role="listbox"
            aria-label={EDITOR_COPY.slide.label}
            aria-multiselectable="true"
            {...paneRootAttrs}
            data-testid="slide-pane-list"
            onClick={handleClick}
            onContextMenu={handleContextMenu}
            className="flex-1 overflow-y-auto px-3 py-2 outline-none"
          >
            {items.length === 0 && (
              <Empty>
                <EmptyHeader>
                  <EmptyDescription>
                    {EDITOR_COPY.thumbnails.noSongs}
                    <br />
                    {EDITOR_COPY.thumbnails.addSongHint}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}

            {items.map((item, songIndex) => {
              const deck = item.deck;
              const slides = deck?.slides ?? [];
              const isCollapsed = collapsedSongs.collapsedIds.has(item.id);
              const posterUrl = getBackgroundById(
                deck?.backgroundId,
              )?.posterUrl;
              const overflow = overflows[songIndex];
              const songWarning = songOverflowWarning(
                overflow,
                firstIndexes[songIndex],
              );
              const gapActive = (index: number) =>
                (insertion?.songIndex === songIndex &&
                  insertion.index === index) ||
                (dropTarget?.type === "slide" &&
                  dropTarget.songIndex === songIndex &&
                  dropTarget.index === index);

              return (
                <SongSection
                  key={item.id}
                  itemId={item.id}
                  songIndex={songIndex}
                  dropBefore={
                    dropTarget?.type === "song" &&
                    dropTarget.index === songIndex
                  }
                  dropAfter={
                    dropTarget?.type === "song" &&
                    songIndex === items.length - 1 &&
                    dropTarget.index === items.length
                  }
                >
                  <SongHeader
                    itemId={item.id}
                    songIndex={songIndex}
                    title={deck?.title || EDITOR_COPY.song.untitled}
                    artist={deck?.artist}
                    slideCount={slides.length}
                    active={songIndex === activeSongIndex}
                    collapsed={isCollapsed}
                    dimmed={
                      dragging?.type === "song" &&
                      dragging.songIndex === songIndex
                    }
                    warning={songWarning}
                    menuActions={songActions(songIndex)}
                    onToggle={() => collapsedSongs.toggle(item.id)}
                    onSelect={() => selectAndToggleSong(songIndex, item.id)}
                  />

                  {!isCollapsed && (
                    <div className="pb-1">
                      <SlideGap
                        songIndex={songIndex}
                        index={0}
                        active={gapActive(0)}
                        onClick={() => {
                          focusPane();
                          onSetInsertion({ songIndex, index: 0 });
                        }}
                      />
                      {slides.map((slide, slideIndex) => {
                        const selected = isSelected(songIndex, slide.id);
                        const current =
                          songIndex === activeSongIndex &&
                          slideIndex === activeSlideIndex;

                        return (
                          <React.Fragment key={slide.id}>
                            <SlideThumbnail
                              dragId={`slide:${item.id}:${slide.id}`}
                              songIndex={songIndex}
                              slideIndex={slideIndex}
                              number={firstIndexes[songIndex] + slideIndex + 1}
                              slide={slide}
                              style={deck?.style}
                              posterUrl={posterUrl}
                              current={current}
                              selected={selected}
                              dimmed={dragging?.type === "slide" && selected}
                              warning={slideOverflowWarning(
                                overflow,
                                slideIndex,
                                songWarning,
                              )}
                              thumbRef={current ? activeThumbRef : undefined}
                            />
                            <SlideGap
                              songIndex={songIndex}
                              index={slideIndex + 1}
                              active={gapActive(slideIndex + 1)}
                              onClick={() => {
                                focusPane();
                                onSetInsertion({
                                  songIndex,
                                  index: slideIndex + 1,
                                });
                              }}
                            />
                          </React.Fragment>
                        );
                      })}
                    </div>
                  )}
                </SongSection>
              );
            })}
          </ContextMenuTrigger>
          <ContextMenuContent data-testid="slide-pane-menu" className="w-52">
            <ActionMenuItems kind="context" actions={menuActions} />
          </ContextMenuContent>
        </ContextMenu>

        <DragOverlay dropAnimation={null}>
          {dragging?.type === "slide" && draggedSlide && (
            <div className="relative w-44">
              <SlidePreview
                slide={draggedSlide}
                style={draggedDeck?.style}
                posterUrl={
                  getBackgroundById(draggedDeck?.backgroundId)?.posterUrl
                }
                className="shadow-lg ring-2 ring-primary"
              />
              {draggedCount > 1 && (
                <span className="absolute -top-2 -right-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 font-mono text-xs font-bold text-primary-foreground">
                  {draggedCount}
                </span>
              )}
            </div>
          )}
          {dragging?.type === "song" && (
            <div className="w-56 truncate rounded-md bg-background px-2 py-1 text-xs font-semibold shadow-lg ring-1 ring-border">
              {draggedDeck?.title || EDITOR_COPY.song.untitled}
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {!readOnly && (
        <div className="shrink-0 border-t p-3">
          <Button
            variant="outline"
            data-testid="add-song-btn"
            onClick={onOpenSongPicker}
            className="w-full"
          >
            <PlusIcon />
            {EDITOR_COPY.song.addSong}
          </Button>
        </div>
      )}
    </aside>
  );
}

/** 곡 구역. 곡을 끌 때 놓을 자리가 되고, 앞·뒤 가로선을 보여 준다 */
function SongSection({
  itemId,
  songIndex,
  dropBefore,
  dropAfter,
  children,
}: {
  itemId: string;
  songIndex: number;
  dropBefore: boolean;
  dropAfter: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  const data: PaneDragData = { type: "song", songIndex };
  const { setNodeRef } = useDroppable({ id: `song:${itemId}`, data });
  return (
    <section ref={setNodeRef} className="relative mb-2">
      {dropBefore && <PaneDropLine position="top" />}
      {children}
      {dropAfter && <PaneDropLine position="bottom" />}
    </section>
  );
}

/** 곡(구역) 머리글. 누르면 곡 전체 선택과 함께 접기/펼치기, 끌면 곡 순서 바꾸기 */
function SongHeader({
  itemId,
  songIndex,
  title,
  artist,
  slideCount,
  active,
  collapsed,
  dimmed,
  warning,
  menuActions,
  onToggle,
  onSelect,
}: {
  itemId: string;
  songIndex: number;
  title: string;
  artist?: string;
  slideCount: number;
  active: boolean;
  collapsed: boolean;
  dimmed: boolean;
  warning: string | null;
  menuActions: MenuAction[];
  onToggle: () => void;
  onSelect: () => void;
}): React.JSX.Element {
  const data: PaneDragData = { type: "song", songIndex };
  const { setNodeRef, listeners } = useDraggable({
    id: `song-header:${itemId}`,
    data,
  });
  const fullTitle = artist ? `${title} · ${artist}` : title;

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      data-testid={`song-section-${songIndex}`}
      {...paneTargetAttrs({ kind: "header", songIndex })}
      className={cn(
        "group relative flex items-center gap-1 rounded-md p-1 transition-colors",
        active
          ? "bg-muted/70 font-medium text-foreground"
          : "text-muted-foreground hover:bg-muted/40",
        dimmed && "opacity-50",
      )}
    >
      <IconButton
        label={
          collapsed
            ? EDITOR_COPY.thumbnails.expandSection
            : EDITOR_COPY.thumbnails.collapseSection
        }
        size="icon-xs"
        data-testid={`song-section-toggle-${songIndex}`}
        aria-expanded={!collapsed}
        onClick={onToggle}
        className="text-muted-foreground"
      >
        <ChevronDownIcon
          className={cn("transition-transform", collapsed && "-rotate-90")}
        />
      </IconButton>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="xs"
              data-testid={`song-section-title-${songIndex}`}
              aria-label={fullTitle}
              aria-expanded={!collapsed}
              onClick={onSelect}
              className="min-w-0 flex-1 justify-start gap-1.5 px-0 text-inherit hover:bg-transparent hover:text-inherit"
            />
          }
        >
          <span className="truncate text-xs font-semibold">{title}</span>
          <span className="shrink-0 font-mono text-xs text-muted-foreground">
            {EDITOR_COPY.slide.pageCount(slideCount)}
          </span>
        </TooltipTrigger>
        <TooltipContent side="right">{fullTitle}</TooltipContent>
      </Tooltip>

      {warning && (
        <OverflowWarning
          testId={`song-overflow-warning-${songIndex}`}
          message={warning}
          className="text-warning"
        />
      )}

      <DropdownMenu>
        <DropdownMenuTrigger
          data-testid={`song-section-menu-btn-${songIndex}`}
          aria-label={EDITOR_COPY.song.menu}
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100"
            />
          }
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          data-testid="song-section-menu"
          align="end"
          className="w-48"
        >
          <ActionMenuItems kind="dropdown" actions={menuActions} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
