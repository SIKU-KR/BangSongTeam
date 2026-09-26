import React, { useEffect, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
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
import type { PresentationItem } from "#shared";
import {
  getBackgroundById,
  useBackgroundCatalog,
} from "../backgrounds/backgroundCatalog";
import { ActionMenuItems, type MenuAction } from "../drive/ActionMenu";
import {
  OverflowWarning,
  PaneDropLine,
  SlideGap,
  SlidePreview,
  SlideThumbnail,
  type PaneDragData,
} from "./SlideThumbnail";
import { resolveDropIndex, type ClickModifiers } from "./slideSelection";
import type { SlideInsertion } from "./useSlideSelection";
import {
  analyzeDeckOverflowCached,
  useTextWidthMeasurer,
} from "./useTextWidthMeasurer";

const SLIDE_WRAP_WARNING =
  "한 줄이 텍스트 박스 폭을 넘어 자동 줄바꿈됩니다. 글자 크기를 줄이거나 박스 폭을 넓혀 보세요.";
const SLIDE_STAGE_WARNING =
  "이 곡에서 가장 긴 슬라이드라 화면 가장자리 여백을 넘칩니다. 글자 크기를 줄이거나 슬라이드를 나눠 보세요.";

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
  className?: string;
}

type MenuTarget =
  { kind: "slides" } | { kind: "gap" } | { kind: "song"; songIndex: number };

type DropTarget =
  | { type: "slide"; songIndex: number; index: number }
  | { type: "song"; index: number };

const NO_MODIFIERS: ClickModifiers = { shift: false, mod: false };
const NO_SENSORS: [] = [];
const POINTER_SENSOR_OPTIONS = { activationConstraint: { distance: 5 } };

const byDragType: CollisionDetection = (args) => {
  const active = args.active.data.current as PaneDragData | undefined;
  return closestCenter({
    ...args,
    droppableContainers: args.droppableContainers.filter((container) => {
      const data = container.data.current as PaneDragData | undefined;
      if (!active || !data || data.type !== active.type) return false;
      return data.type === "song" || data.songIndex === active.songIndex;
    }),
  });
};

function dropTargetOf({
  active,
  over,
}: DragMoveEvent | DragEndEvent): DropTarget | null {
  const data = over?.data.current as PaneDragData | undefined;
  const rect = active.rect.current.translated;
  if (!over || !data || !rect) return null;
  const centerY = rect.top + rect.height / 2;
  if (data.type === "slide") {
    return {
      type: "slide",
      songIndex: data.songIndex,
      index: resolveDropIndex(data.slideIndex, centerY, over.rect),
    };
  }
  return {
    type: "song",
    index: resolveDropIndex(data.songIndex, centerY, over.rect),
  };
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
  className,
}: SlideThumbnailPaneProps): React.JSX.Element {
  useBackgroundCatalog();
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [menuTarget, setMenuTarget] = useState<MenuTarget | null>(null);
  const [dragging, setDragging] = useState<PaneDragData | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const activeThumbRef = useRef<HTMLDivElement>(null);
  const keepCollapsedIdRef = useRef<string | null>(null);

  const activeItemId = items[activeSongIndex]?.id;
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

  const sensors = useSensors(useSensor(PointerSensor, POINTER_SENSOR_OPTIONS));

  useEffect(() => {
    if (!activeItemId) return;
    if (keepCollapsedIdRef.current === activeItemId) {
      keepCollapsedIdRef.current = null;
      return;
    }
    setCollapsedIds((prev) => {
      if (!prev.has(activeItemId)) return prev;
      const next = new Set(prev);
      next.delete(activeItemId);
      return next;
    });
  }, [activeItemId]);

  useEffect(() => {
    activeThumbRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [activeSongIndex, activeSlideIndex]);

  const focusPane = () => paneRef.current?.focus({ preventScroll: true });

  const toggleCollapsed = (itemId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const selectAndToggleSong = (songIndex: number, itemId: string) => {
    const willSelectAnother =
      songIndex !== activeSongIndex &&
      (items[songIndex]?.deck?.slides.length ?? 0) > 0;
    if (willSelectAnother && !collapsedIds.has(itemId)) {
      keepCollapsedIdRef.current = itemId;
    }
    toggleCollapsed(itemId);
    focusPane();
    onSelectSong(songIndex);
  };

  const isSelected = (songIndex: number, slideId: string) =>
    songIndex === activeSongIndex && selectedIds.includes(slideId);

  const slideActions: MenuAction[] = [
    {
      key: "cut",
      label: "잘라내기",
      icon: ScissorsIcon,
      shortcut: "Ctrl+X",
      disabled: !canDelete,
      onSelect: onCutSlides,
    },
    {
      key: "copy",
      label: "복사",
      icon: CopyIcon,
      shortcut: "Ctrl+C",
      onSelect: onCopySlides,
    },
    {
      key: "paste",
      label: "붙여넣기",
      icon: ClipboardPasteIcon,
      shortcut: "Ctrl+V",
      disabled: !canPaste,
      onSelect: onPasteSlides,
    },
    {
      key: "new",
      label: "새 슬라이드",
      icon: PlusIcon,
      shortcut: "Ctrl+M",
      separated: true,
      onSelect: onAddSlide,
    },
    {
      key: "duplicate",
      label: "슬라이드 복제",
      icon: CopyPlusIcon,
      shortcut: "Ctrl+D",
      onSelect: onDuplicateSlides,
    },
    {
      key: "delete",
      label: "슬라이드 삭제",
      icon: Trash2Icon,
      shortcut: "Delete",
      danger: true,
      disabled: !canDelete,
      onSelect: onDeleteSlides,
    },
  ];

  const gapActions: MenuAction[] = [
    {
      key: "paste",
      label: "붙여넣기",
      icon: ClipboardPasteIcon,
      shortcut: "Ctrl+V",
      disabled: !canPaste,
      onSelect: onPasteSlides,
    },
    {
      key: "new",
      label: "새 슬라이드",
      icon: PlusIcon,
      shortcut: "Ctrl+M",
      onSelect: onAddSlide,
    },
  ];

  const layoutActions: MenuAction[] = [
    {
      key: "collapse-all",
      label: "모두 축소",
      icon: ChevronsDownUpIcon,
      separated: true,
      onSelect: () => setCollapsedIds(new Set(items.map((item) => item.id))),
    },
    {
      key: "expand-all",
      label: "모두 확장",
      icon: ChevronsUpDownIcon,
      onSelect: () => setCollapsedIds(new Set()),
    },
  ];

  const songActions = (songIndex: number): MenuAction[] =>
    readOnly
      ? layoutActions
      : [
          {
            key: "up",
            label: "위로 이동",
            icon: ArrowUpIcon,
            disabled: songIndex === 0,
            onSelect: () => onReorderSong(songIndex, songIndex - 1),
          },
          {
            key: "down",
            label: "아래로 이동",
            icon: ArrowDownIcon,
            disabled: songIndex === items.length - 1,
            onSelect: () => onReorderSong(songIndex, songIndex + 1),
          },
          {
            key: "info",
            label: "제목·아티스트 수정",
            icon: PencilIcon,
            onSelect: () => onEditSongInfo(songIndex),
          },
          {
            key: "duplicate",
            label: "곡 복제",
            icon: CopyPlusIcon,
            onSelect: () => onDuplicateSong(songIndex),
          },
          ...layoutActions,
          {
            key: "remove",
            label: "세트에서 제거",
            icon: Trash2Icon,
            danger: true,
            separated: true,
            onSelect: () => onDeleteSong(songIndex),
          },
        ];

  const menuActions =
    menuTarget?.kind === "slides"
      ? slideActions
      : menuTarget?.kind === "gap"
        ? gapActions
        : menuTarget?.kind === "song"
          ? songActions(menuTarget.songIndex)
          : [];

  const handleContextMenu = (
    event: React.MouseEvent & { preventBaseUIHandler: () => void },
  ) => {
    if (readOnly) {
      event.preventBaseUIHandler();
      return;
    }
    const target = event.target as HTMLElement;
    const indexOf = (element: HTMLElement, name: string) =>
      Number(element.getAttribute(name));
    const thumb = target.closest<HTMLElement>("[data-slide-thumb]");
    const gap = target.closest<HTMLElement>("[data-slide-gap]");
    const header = target.closest<HTMLElement>("[data-song-header]");
    focusPane();
    if (thumb) {
      const songIndex = indexOf(thumb, "data-song-index");
      const slideIndex = indexOf(thumb, "data-slide-index");
      const slideId = items[songIndex]?.deck?.slides[slideIndex]?.id ?? "";
      if (!isSelected(songIndex, slideId)) {
        onClickSlide(songIndex, slideIndex, NO_MODIFIERS);
      }
      setMenuTarget({ kind: "slides" });
    } else if (gap) {
      onSetInsertion({
        songIndex: indexOf(gap, "data-song-index"),
        index: indexOf(gap, "data-gap-index"),
      });
      setMenuTarget({ kind: "gap" });
    } else if (header) {
      setMenuTarget({
        kind: "song",
        songIndex: indexOf(header, "data-song-index"),
      });
    } else if (items.length > 0) {
      const lastSong = items.length - 1;
      onSetInsertion({
        songIndex: lastSong,
        index: items[lastSong].deck?.slides.length ?? 0,
      });
      setMenuTarget({ kind: "gap" });
    } else {
      event.preventBaseUIHandler();
    }
  };

  const handleClick = (event: React.MouseEvent) => {
    const thumb = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-slide-thumb]",
    );
    if (!thumb) return;
    focusPane();
    onClickSlide(
      Number(thumb.getAttribute("data-song-index")),
      Number(thumb.getAttribute("data-slide-index")),
      { shift: event.shiftKey, mod: event.metaKey || event.ctrlKey },
    );
  };

  const handleDragStart = ({ active }: DragStartEvent) => {
    const data = active.data.current as PaneDragData | undefined;
    if (!data) return;
    if (data.type === "slide" && !isSelected(data.songIndex, data.slideId)) {
      onClickSlide(data.songIndex, data.slideIndex, NO_MODIFIERS);
    }
    focusPane();
    setDragging(data);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const target = dropTargetOf(event);
    setDragging(null);
    setDropTarget(null);
    if (!target || !dragging) return;
    if (target.type === "slide") {
      onDropSlides(target.index);
    } else if (dragging.type === "song") {
      const from = dragging.songIndex;
      const to = target.index > from ? target.index - 1 : target.index;
      if (to !== from) onReorderSong(from, to);
    }
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
      className={cn(
        "flex w-64 shrink-0 flex-col border-r bg-background select-none",
        className,
      )}
    >
      <div className="flex h-11 shrink-0 items-center justify-between border-b px-3">
        <span className="text-xs font-bold">
          슬라이드{" "}
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
              <PlusIcon />새 슬라이드
            </TooltipTrigger>
            <TooltipContent>현재 슬라이드 뒤에 새 슬라이드 추가</TooltipContent>
          </Tooltip>
        )}
      </div>

      <DndContext
        sensors={readOnly ? NO_SENSORS : sensors}
        collisionDetection={byDragType}
        onDragStart={handleDragStart}
        onDragMove={(event) => setDropTarget(dropTargetOf(event))}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setDragging(null);
          setDropTarget(null);
        }}
      >
        <ContextMenu>
          <ContextMenuTrigger
            ref={paneRef}
            tabIndex={0}
            role="listbox"
            aria-label="슬라이드"
            aria-multiselectable="true"
            data-slide-pane=""
            data-testid="slide-pane-list"
            onClick={handleClick}
            onContextMenu={handleContextMenu}
            className="flex-1 overflow-y-auto px-3 py-2 outline-none"
          >
            {items.length === 0 && (
              <Empty>
                <EmptyHeader>
                  <EmptyDescription>
                    아직 곡이 없습니다.
                    <br />
                    아래에서 찬양곡을 추가하세요.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}

            {items.map((item, songIndex) => {
              const deck = item.deck;
              const slides = deck?.slides ?? [];
              const isCollapsed = collapsedIds.has(item.id);
              const posterUrl = getBackgroundById(
                deck?.backgroundId,
              )?.posterUrl;
              const overflow = overflows[songIndex];
              const tallestSlideNumber =
                overflow?.exceedsStage && overflow.tallestSlideIndex !== null
                  ? firstIndexes[songIndex] + overflow.tallestSlideIndex + 1
                  : null;
              const songWarning =
                tallestSlideNumber === null
                  ? null
                  : `가장 긴 슬라이드(${tallestSlideNumber}번)가 화면 가장자리 여백을 넘칩니다. 글자 크기를 줄이거나 슬라이드를 나눠 보세요.`;
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
                    title={deck?.title || "제목 없음"}
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
                    onToggle={() => toggleCollapsed(item.id)}
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
                        const warning = [
                          overflow?.slides[slideIndex]?.wraps
                            ? SLIDE_WRAP_WARNING
                            : null,
                          songWarning &&
                          overflow?.tallestSlideIndex === slideIndex
                            ? SLIDE_STAGE_WARNING
                            : null,
                        ]
                          .filter(Boolean)
                          .join("\n");

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
                              warning={warning}
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
                <span className="absolute -top-2 -right-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 font-mono text-2xs font-bold text-primary-foreground">
                  {draggedCount}
                </span>
              )}
            </div>
          )}
          {dragging?.type === "song" && (
            <div className="w-56 truncate rounded-md bg-background px-2 py-1 text-xs font-semibold shadow-lg ring-1 ring-border">
              {draggedDeck?.title || "제목 없음"}
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
            찬양곡 추가
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
      data-song-header=""
      data-song-index={songIndex}
      className={cn(
        "group relative flex items-center gap-1 rounded-md p-1 transition-colors",
        active
          ? "bg-muted/70 font-medium text-foreground"
          : "text-muted-foreground hover:bg-muted/40",
        dimmed && "opacity-50",
      )}
    >
      <IconButton
        label={collapsed ? "구역 펼치기" : "구역 접기"}
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
          <span className="shrink-0 font-mono text-2xs text-muted-foreground">
            {slideCount}장
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
          aria-label="곡 메뉴"
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
