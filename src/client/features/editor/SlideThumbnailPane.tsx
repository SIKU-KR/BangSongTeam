import React, { useEffect, useMemo, useRef, useState } from "react";
import type { PresentationItem } from "#shared";
import { analyzeDeckOverflow } from "#shared";
import {
  getBackgroundById,
  useBackgroundCatalog,
} from "../backgrounds/backgroundCatalog";
import { SlideStage } from "../../components/stage/SlideStage";
import { OverflowWarningIcon } from "./OverflowWarningIcon";
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
  className = "",
}: SlideThumbnailPaneProps): React.JSX.Element {
  useBackgroundCatalog();
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [menuSongIndex, setMenuSongIndex] = useState<number | null>(null);
  const menuContainerRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (menuSongIndex === null) return;

    const handleMouseDown = (event: MouseEvent) => {
      if (
        menuContainerRef.current &&
        !menuContainerRef.current.contains(event.target as Node)
      ) {
        setMenuSongIndex(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuSongIndex(null);
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuSongIndex]);

  const toggleCollapsed = (itemId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const runMenuAction = (action: () => void) => {
    setMenuSongIndex(null);
    action();
  };

  return (
    <aside
      data-testid="slide-thumbnail-pane"
      className={`flex w-64 shrink-0 flex-col border-r border-zinc-200 bg-white select-none dark:border-zinc-800/80 dark:bg-zinc-950 ${className}`}
    >
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-zinc-200 px-3 dark:border-zinc-800/80">
        <span className="text-xs font-bold text-zinc-900 dark:text-white">
          슬라이드{" "}
          <span className="font-mono font-medium text-zinc-400 dark:text-zinc-500">
            {totalSlides}
          </span>
        </span>
        <button
          type="button"
          data-testid="add-slide-btn"
          disabled={items.length === 0}
          onClick={onAddSlide}
          className="flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-emerald-400"
          title="현재 슬라이드 뒤에 새 슬라이드 추가"
        >
          <svg
            className="size-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
          <span>새 슬라이드</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        {items.length === 0 && (
          <p className="px-1 py-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
            아직 곡이 없습니다.
            <br />
            아래에서 찬양곡을 추가하세요.
          </p>
        )}

        {items.map((item, songIndex) => {
          const deck = item.deck;
          const slides = deck?.slides ?? [];
          const title = deck?.title || "제목 없음";
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
                className={`group relative flex items-center gap-1 rounded-md p-1 hover:bg-zinc-100 dark:hover:bg-zinc-900 ${
                  isActiveSong
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-zinc-700 dark:text-zinc-300"
                }`}
              >
                <button
                  type="button"
                  data-testid={`song-section-toggle-${songIndex}`}
                  aria-expanded={!isCollapsed}
                  onClick={() => toggleCollapsed(item.id)}
                  className="cursor-pointer rounded-sm p-0.5 text-zinc-400 hover:text-zinc-800 dark:text-zinc-500 dark:hover:text-zinc-200"
                  title={isCollapsed ? "구역 펼치기" : "구역 접기"}
                >
                  <svg
                    className={`size-3 transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2.5}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>

                <button
                  type="button"
                  data-testid={`song-section-title-${songIndex}`}
                  onClick={() => onSelectSlide(songIndex, 0)}
                  className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-1.5 text-left"
                  title={deck?.artist ? `${title} · ${deck.artist}` : title}
                >
                  <span className="truncate text-xs font-semibold">
                    {title}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
                    {slides.length}장
                  </span>
                </button>

                {songWarning && (
                  <span
                    role="img"
                    data-testid={`song-overflow-warning-${songIndex}`}
                    aria-label={songWarning}
                    title={songWarning}
                    className="shrink-0 text-amber-500 dark:text-amber-400"
                  >
                    <OverflowWarningIcon />
                  </span>
                )}

                <div
                  ref={isMenuOpen ? menuContainerRef : undefined}
                  className="relative shrink-0"
                >
                  <button
                    type="button"
                    data-testid={`song-section-menu-btn-${songIndex}`}
                    aria-haspopup="menu"
                    aria-expanded={isMenuOpen}
                    onClick={() =>
                      setMenuSongIndex(isMenuOpen ? null : songIndex)
                    }
                    className={`cursor-pointer rounded-sm p-0.5 text-zinc-500 transition-opacity hover:bg-zinc-200 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white ${
                      isMenuOpen
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    }`}
                    title="곡 메뉴"
                  >
                    <svg
                      className="size-4"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <circle cx="5" cy="12" r="1.75" />
                      <circle cx="12" cy="12" r="1.75" />
                      <circle cx="19" cy="12" r="1.75" />
                    </svg>
                  </button>

                  {isMenuOpen && (
                    <div
                      role="menu"
                      data-testid="song-section-menu"
                      className="absolute top-6 right-0 z-50 w-40 rounded-lg border border-zinc-200 bg-white py-1 text-xs text-zinc-700 shadow-lg dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:shadow-2xl"
                    >
                      <SectionMenuItem
                        label="위로 이동"
                        disabled={songIndex === 0}
                        onClick={() =>
                          runMenuAction(() =>
                            onReorderSong(songIndex, songIndex - 1),
                          )
                        }
                      />
                      <SectionMenuItem
                        label="아래로 이동"
                        disabled={songIndex === items.length - 1}
                        onClick={() =>
                          runMenuAction(() =>
                            onReorderSong(songIndex, songIndex + 1),
                          )
                        }
                      />
                      <SectionMenuItem
                        label="제목·아티스트 수정"
                        onClick={() =>
                          runMenuAction(() => onEditSongInfo(songIndex))
                        }
                      />
                      <SectionMenuItem
                        label="곡 복제"
                        onClick={() =>
                          runMenuAction(() => onDuplicateSong(songIndex))
                        }
                      />
                      <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" />
                      <SectionMenuItem
                        label="세트에서 제거"
                        danger
                        onClick={() =>
                          runMenuAction(() => onDeleteSong(songIndex))
                        }
                      />
                    </div>
                  )}
                </div>
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
                            className={`w-6 shrink-0 pt-0.5 text-right font-mono text-[11px] ${
                              isActive
                                ? "font-bold text-emerald-600 dark:text-emerald-400"
                                : "text-zinc-400 dark:text-zinc-500"
                            }`}
                          >
                            {globalIndex + 1}
                          </span>

                          <div
                            ref={isActive ? activeThumbRef : undefined}
                            className={`relative shrink-0 overflow-hidden rounded-md bg-black transition-shadow ${
                              isActive
                                ? "shadow-md ring-2 ring-emerald-500"
                                : "ring-1 ring-zinc-200 group-hover:ring-zinc-400 dark:ring-zinc-800 dark:group-hover:ring-zinc-600"
                            }`}
                            style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT }}
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
                              <span
                                role="img"
                                data-testid={`slide-overflow-warning-${globalIndex}`}
                                aria-label={slideWarning}
                                title={slideWarning}
                                className="absolute bottom-1 left-1 z-30 rounded-sm bg-black/75 p-0.5 text-amber-400"
                              >
                                <OverflowWarningIcon className="size-3" />
                              </span>
                            )}

                            <div className="absolute top-1 right-1 z-30 flex items-center gap-0.5 rounded-sm border border-white/15 bg-black/75 p-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                              <button
                                type="button"
                                data-testid={`duplicate-slide-btn-${globalIndex}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDuplicateSlide(songIndex, slideIndex);
                                }}
                                className="cursor-pointer rounded-sm p-0.5 text-zinc-300 hover:bg-zinc-700 hover:text-white"
                                title="슬라이드 복제"
                              >
                                <svg
                                  className="size-3"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                                  />
                                </svg>
                              </button>
                              {slides.length > 1 && (
                                <button
                                  type="button"
                                  data-testid={`delete-slide-btn-${globalIndex}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onDeleteSlide(songIndex, slideIndex);
                                  }}
                                  className="cursor-pointer rounded-sm p-0.5 text-zinc-300 hover:bg-zinc-700 hover:text-red-400"
                                  title="슬라이드 삭제"
                                >
                                  <svg
                                    className="size-3"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                    />
                                  </svg>
                                </button>
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

      <div className="shrink-0 border-t border-zinc-200 p-3 dark:border-zinc-800/80">
        <button
          type="button"
          data-testid="add-song-btn"
          onClick={onOpenSongPicker}
          className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-2 text-xs font-semibold text-zinc-800 transition-colors hover:border-emerald-500/50 hover:bg-zinc-200 dark:border-zinc-700/80 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          <svg
            className="size-4 text-emerald-600 dark:text-emerald-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
          <span>찬양곡 추가</span>
        </button>
      </div>
    </aside>
  );
}

function SectionMenuItem({
  label,
  onClick,
  disabled = false,
  danger = false,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`w-full cursor-pointer px-3 py-1.5 text-left disabled:cursor-not-allowed disabled:opacity-35 ${
        danger
          ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
          : "hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}
