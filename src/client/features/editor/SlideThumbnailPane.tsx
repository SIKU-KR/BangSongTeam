import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDownIcon,
  CopyIcon,
  EllipsisIcon,
  PlusIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { cn } from "cn";
import { Button } from "#components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#components/ui/tooltip";
import { IconButton } from "#components/common/IconButton";
import type { PresentationItem } from "#shared";
import { analyzeDeckOverflow } from "#shared";
import {
  getBackgroundById,
  useBackgroundCatalog,
} from "../backgrounds/backgroundCatalog";
import { SlideStage } from "../../components/stage/SlideStage";
import { SortableItem, SortableList, slideSortableId } from "./SortableList";
import { useTextWidthMeasurer } from "./useTextWidthMeasurer";

const THUMB_WIDTH = 176;
const THUMB_HEIGHT = 99;

const SLIDE_WRAP_WARNING =
  "한 줄이 텍스트 박스 폭을 넘어 자동 줄바꿈됩니다. 글자 크기를 줄이거나 박스 폭을 넓혀 보세요.";
const SLIDE_STAGE_WARNING =
  "이 곡에서 가장 긴 슬라이드라 화면 가장자리 여백을 넘칩니다. 글자 크기를 줄이거나 슬라이드를 나눠 보세요.";

export interface SlideThumbnailPaneProps {
  items: PresentationItem[];
  activeSongIndex: number;
  activeSlideIndex: number;
  onSelectSlide: (songIndex: number, slideIndex: number) => void;
  onAddSlide: () => void;
  onDuplicateSlide: (songIndex: number, slideIndex: number) => void;
  onDeleteSlide: (songIndex: number, slideIndex: number) => void;
  onReorderSlide: (
    songIndex: number,
    fromIndex: number,
    toIndex: number,
  ) => void;
  onReorderSong: (fromIndex: number, toIndex: number) => void;
  onDuplicateSong: (songIndex: number) => void;
  onEditSongInfo: (songIndex: number) => void;
  onDeleteSong: (songIndex: number) => void;
  onOpenSongPicker: () => void;
  className?: string;
}

/** 프레젠테이션 슬라이드 썸네일 목록 창 컴포넌트. */
export function SlideThumbnailPane({
  items,
  activeSongIndex,
  activeSlideIndex,
  onSelectSlide,
  onAddSlide,
  onDuplicateSlide,
  onDeleteSlide,
  onReorderSlide,
  onReorderSong,
  onDuplicateSong,
  onEditSongInfo,
  onDeleteSong,
  onOpenSongPicker,
  className,
}: SlideThumbnailPaneProps): React.JSX.Element {
  useBackgroundCatalog();
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [menuSongIndex, setMenuSongIndex] = useState<number | null>(null);
  const activeThumbRef = useRef<HTMLDivElement>(null);

  const activeItemId = items[activeSongIndex]?.id;
  const measureText = useTextWidthMeasurer();
  const overflows = useMemo(
    () =>
      items.map((item) =>
        item.deck
          ? analyzeDeckOverflow(item.deck.slides, item.deck.style, measureText)
          : null,
      ),
    [items, measureText],
  );

  const firstIndexes: number[] = [];
  let totalSlides = 0;
  for (const item of items) {
    firstIndexes.push(totalSlides);
    totalSlides += item.deck?.slides.length ?? 0;
  }

  useEffect(() => {
    if (!activeItemId) return;
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

  const toggleCollapsed = (itemId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

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
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        {items.length === 0 && (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">
            아직 곡이 없습니다.
            <br />
            아래에서 찬양곡을 추가하세요.
          </p>
        )}

        {items.map((item, songIndex) => {
          const deck = item.deck;
          const slides = deck?.slides ?? [];
          const title = deck?.title || "제목 없음";
          const fullTitle = deck?.artist ? `${title} · ${deck.artist}` : title;
          const isActiveSong = songIndex === activeSongIndex;
          const isCollapsed = collapsedIds.has(item.id);
          const isMenuOpen = menuSongIndex === songIndex;
          const posterUrl = getBackgroundById(deck?.backgroundId)?.posterUrl;
          const overflow = overflows[songIndex];
          const tallestSlideNumber =
            overflow?.exceedsStage && overflow.tallestSlideIndex !== null
              ? firstIndexes[songIndex] + overflow.tallestSlideIndex + 1
              : null;
          const songWarning =
            tallestSlideNumber === null
              ? null
              : `가장 긴 슬라이드(${tallestSlideNumber}번)가 화면 가장자리 여백을 넘칩니다. 글자 크기를 줄이거나 슬라이드를 나눠 보세요.`;

          return (
            <section key={item.id} className="mb-2">
              <div
                data-testid={`song-section-${songIndex}`}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenuSongIndex(songIndex);
                }}
                className={cn(
                  "group relative flex items-center gap-1 rounded-md p-1 hover:bg-muted",
                  isActiveSong ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <IconButton
                  label={isCollapsed ? "구역 펼치기" : "구역 접기"}
                  size="icon-xs"
                  data-testid={`song-section-toggle-${songIndex}`}
                  aria-expanded={!isCollapsed}
                  onClick={() => toggleCollapsed(item.id)}
                  className="text-muted-foreground"
                >
                  <ChevronDownIcon
                    className={cn(
                      "transition-transform",
                      isCollapsed && "-rotate-90",
                    )}
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
                        onClick={() => onSelectSlide(songIndex, 0)}
                        className="min-w-0 flex-1 justify-start gap-1.5 px-0 text-inherit hover:bg-transparent hover:text-inherit"
                      />
                    }
                  >
                    <span className="truncate text-xs font-semibold">
                      {title}
                    </span>
                    <span className="shrink-0 font-mono text-2xs text-muted-foreground">
                      {slides.length}장
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="right">{fullTitle}</TooltipContent>
                </Tooltip>

                {songWarning && (
                  <OverflowWarning
                    testId={`song-overflow-warning-${songIndex}`}
                    message={songWarning}
                    className="text-warning"
                  />
                )}

                <DropdownMenu
                  open={isMenuOpen}
                  onOpenChange={(open) =>
                    setMenuSongIndex(open ? songIndex : null)
                  }
                >
                  <DropdownMenuTrigger
                    data-testid={`song-section-menu-btn-${songIndex}`}
                    aria-label="곡 메뉴"
                    render={
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className={cn(
                          "transition-opacity",
                          !isMenuOpen &&
                            "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                        )}
                      />
                    }
                  >
                    <EllipsisIcon />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    data-testid="song-section-menu"
                    align="end"
                    className="w-44"
                  >
                    <DropdownMenuItem
                      disabled={songIndex === 0}
                      onClick={() => onReorderSong(songIndex, songIndex - 1)}
                    >
                      위로 이동
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={songIndex === items.length - 1}
                      onClick={() => onReorderSong(songIndex, songIndex + 1)}
                    >
                      아래로 이동
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onEditSongInfo(songIndex)}>
                      제목·아티스트 수정
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => onDuplicateSong(songIndex)}
                    >
                      곡 복제
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => onDeleteSong(songIndex)}
                    >
                      세트에서 제거
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {!isCollapsed && (
                <SortableList
                  ids={slides.map(slideSortableId)}
                  onReorder={(from, to) => onReorderSlide(songIndex, from, to)}
                >
                  <div className="space-y-2 py-1">
                    {slides.map((slide, slideIndex) => {
                      const globalIndex = firstIndexes[songIndex] + slideIndex;
                      const isActive =
                        isActiveSong && slideIndex === activeSlideIndex;
                      const slideWarning = [
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
                        <SortableItem
                          key={slideSortableId(slide, slideIndex)}
                          sortableId={slideSortableId(slide, slideIndex)}
                          data-testid={`slide-thumb-${globalIndex}`}
                          aria-current={isActive ? "true" : undefined}
                          aria-label={`슬라이드 ${globalIndex + 1}`}
                          onClick={() => onSelectSlide(songIndex, slideIndex)}
                          className="group flex cursor-pointer items-start gap-2 outline-none"
                        >
                          <span
                            className={cn(
                              "w-6 shrink-0 pt-0.5 text-right font-mono text-2xs",
                              isActive
                                ? "font-bold text-foreground"
                                : "text-muted-foreground",
                            )}
                          >
                            {globalIndex + 1}
                          </span>

                          <div
                            ref={isActive ? activeThumbRef : undefined}
                            className={cn(
                              "relative aspect-video w-44 shrink-0 overflow-hidden rounded-md bg-black transition-shadow",
                              isActive
                                ? "shadow-md ring-2 ring-primary"
                                : "ring-1 ring-border group-hover:ring-ring",
                            )}
                          >
                            <div className="pointer-events-none size-full">
                              <SlideStage
                                slide={slide}
                                style={deck?.style}
                                posterUrl={posterUrl}
                                staticBackground
                                containerDimensions={{
                                  width: THUMB_WIDTH,
                                  height: THUMB_HEIGHT,
                                }}
                              />
                            </div>

                            {slideWarning && (
                              <OverflowWarning
                                testId={`slide-overflow-warning-${globalIndex}`}
                                message={slideWarning}
                                className="absolute bottom-1 left-1 z-30 rounded-sm bg-black/75 p-0.5 text-warning"
                                iconClassName="size-3"
                              />
                            )}

                            <div className="absolute top-1 right-1 z-30 flex items-center gap-0.5 rounded-sm border border-white/15 bg-black/75 p-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                              <IconButton
                                label="슬라이드 복제"
                                size="icon-xs"
                                data-testid={`duplicate-slide-btn-${globalIndex}`}
                                className={OVERLAY_BUTTON}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDuplicateSlide(songIndex, slideIndex);
                                }}
                              >
                                <CopyIcon />
                              </IconButton>
                              {slides.length > 1 && (
                                <IconButton
                                  label="슬라이드 삭제"
                                  size="icon-xs"
                                  data-testid={`delete-slide-btn-${globalIndex}`}
                                  className={OVERLAY_BUTTON}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onDeleteSlide(songIndex, slideIndex);
                                  }}
                                >
                                  <Trash2Icon />
                                </IconButton>
                              )}
                            </div>
                          </div>
                        </SortableItem>
                      );
                    })}
                  </div>
                </SortableList>
              )}
            </section>
          );
        })}
      </div>

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
    </aside>
  );
}

/** 썸네일 위(검정 배경)에 뜨는 버튼. 테마와 무관하게 흰 글자를 쓴다 */
const OVERLAY_BUTTON =
  "text-white/80 hover:bg-white/20 hover:text-white aria-expanded:text-white";

function OverflowWarning({
  testId,
  message,
  className,
  iconClassName,
}: {
  testId: string;
  message: string;
  className?: string;
  iconClassName?: string;
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            data-testid={testId}
            aria-label={message}
            className={cn("shrink-0", className)}
          />
        }
      >
        <TriangleAlertIcon className={cn("size-3.5", iconClassName)} />
      </TooltipTrigger>
      <TooltipContent className="max-w-64 whitespace-pre-line">
        {message}
      </TooltipContent>
    </Tooltip>
  );
}
