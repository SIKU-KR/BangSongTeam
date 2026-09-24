import React, { useEffect, useRef, useState } from "react";
import type { PresentationItem } from "#shared";
import { getBackgroundPosterUrl } from "#shared";
import { SlideStage } from "../../components/stage/SlideStage";
import { SortableItem, SortableList, slideSortableId } from "./SortableList";

const THUMB_WIDTH = 176;
const THUMB_HEIGHT = 99;

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
  onDeleteSong,
  onOpenSongPicker,
  className = "",
}: SlideThumbnailPaneProps): React.JSX.Element {
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [menuSongIndex, setMenuSongIndex] = useState<number | null>(null);
  const menuContainerRef = useRef<HTMLDivElement>(null);
  const activeThumbRef = useRef<HTMLDivElement>(null);

  const activeItemId = items[activeSongIndex]?.id;

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
      className={`w-64 shrink-0 bg-white dark:bg-zinc-950 border-r border-zinc-200 dark:border-zinc-800/80 flex flex-col select-none ${className}`}
    >
      <div className="h-11 px-3 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800/80 shrink-0">
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
          className="px-2 py-1 rounded-md text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:text-emerald-700 dark:hover:text-emerald-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 cursor-pointer transition-colors"
          title="현재 슬라이드 뒤에 새 슬라이드 추가"
        >
          <svg
            className="w-3.5 h-3.5"
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
          const posterUrl = getBackgroundPosterUrl(deck?.backgroundId);

          return (
            <section key={item.id} className="mb-2">
              <div
                data-testid={`song-section-${songIndex}`}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenuSongIndex(songIndex);
                }}
                className={`group relative flex items-center gap-1 rounded-md px-1 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-900 ${
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
                  className="p-0.5 rounded text-zinc-400 hover:text-zinc-800 dark:text-zinc-500 dark:hover:text-zinc-200 cursor-pointer"
                  title={isCollapsed ? "구역 펼치기" : "구역 접기"}
                >
                  <svg
                    className={`w-3 h-3 transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
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
                  className="min-w-0 flex-1 flex items-baseline gap-1.5 text-left cursor-pointer"
                  title={deck?.artist ? `${title} · ${deck.artist}` : title}
                >
                  <span className="truncate text-xs font-semibold">
                    {title}
                  </span>
                  <span className="shrink-0 text-[10px] font-mono text-zinc-400 dark:text-zinc-500">
                    {slides.length}장
                  </span>
                </button>

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
                    className={`p-0.5 rounded text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-zinc-800 cursor-pointer transition-opacity ${
                      isMenuOpen
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    }`}
                    title="곡 메뉴"
                  >
                    <svg
                      className="w-4 h-4"
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
                      className="absolute right-0 top-6 z-50 w-36 py-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-lg dark:shadow-2xl text-xs text-zinc-700 dark:text-zinc-300"
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
                        label="곡 복제"
                        onClick={() =>
                          runMenuAction(() => onDuplicateSong(songIndex))
                        }
                      />
                      {items.length > 1 && (
                        <>
                          <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" />
                          <SectionMenuItem
                            label="곡 삭제"
                            danger
                            onClick={() =>
                              runMenuAction(() => onDeleteSong(songIndex))
                            }
                          />
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {!isCollapsed && (
                <SortableList
                  ids={slides.map(slideSortableId)}
                  onReorder={(from, to) => onReorderSlide(songIndex, from, to)}
                >
                  <div className="space-y-2 pt-1 pb-1">
                    {slides.map((slide, slideIndex) => {
                      const globalIndex = firstIndexes[songIndex] + slideIndex;
                      const isActive =
                        isActiveSong && slideIndex === activeSlideIndex;

                      return (
                        <SortableItem
                          key={slideSortableId(slide, slideIndex)}
                          sortableId={slideSortableId(slide, slideIndex)}
                          data-testid={`slide-thumb-${globalIndex}`}
                          aria-current={isActive ? "true" : undefined}
                          aria-label={`슬라이드 ${globalIndex + 1}`}
                          onClick={() => onSelectSlide(songIndex, slideIndex)}
                          className="group flex items-start gap-2 cursor-pointer outline-none"
                        >
                          <span
                            className={`w-6 shrink-0 pt-0.5 text-right text-[11px] font-mono ${
                              isActive
                                ? "font-bold text-emerald-600 dark:text-emerald-400"
                                : "text-zinc-400 dark:text-zinc-500"
                            }`}
                          >
                            {globalIndex + 1}
                          </span>

                          <div
                            ref={isActive ? activeThumbRef : undefined}
                            className={`relative shrink-0 rounded-md overflow-hidden bg-black transition-shadow ${
                              isActive
                                ? "ring-2 ring-emerald-500 shadow-md"
                                : "ring-1 ring-zinc-200 dark:ring-zinc-800 group-hover:ring-zinc-400 dark:group-hover:ring-zinc-600"
                            }`}
                            style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT }}
                          >
                            <div className="w-full h-full pointer-events-none">
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

                            <div className="absolute top-1 right-1 z-30 flex items-center gap-0.5 p-0.5 rounded bg-black/75 border border-white/15 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                type="button"
                                data-testid={`duplicate-slide-btn-${globalIndex}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDuplicateSlide(songIndex, slideIndex);
                                }}
                                className="p-0.5 rounded text-zinc-300 hover:text-white hover:bg-zinc-700 cursor-pointer"
                                title="슬라이드 복제"
                              >
                                <svg
                                  className="w-3 h-3"
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
                                  className="p-0.5 rounded text-zinc-300 hover:text-red-400 hover:bg-zinc-700 cursor-pointer"
                                  title="슬라이드 삭제"
                                >
                                  <svg
                                    className="w-3 h-3"
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

      <div className="p-3 border-t border-zinc-200 dark:border-zinc-800/80 shrink-0">
        <button
          type="button"
          data-testid="add-song-btn"
          onClick={onOpenSongPicker}
          className="w-full py-2 px-3 rounded-lg bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-700/80 hover:border-emerald-500/50 text-xs font-semibold text-zinc-800 dark:text-zinc-200 transition-colors flex items-center justify-center gap-2 cursor-pointer"
        >
          <svg
            className="w-4 h-4 text-emerald-600 dark:text-emerald-400"
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
      className={`w-full px-3 py-1.5 text-left disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer ${
        danger
          ? "text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
          : "hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}
