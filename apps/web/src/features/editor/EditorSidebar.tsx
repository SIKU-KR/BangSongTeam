import React, { useState } from "react";
import type { Deck, SetlistItem } from "@repo/shared";
import { QuickLyricPasteModal } from "./QuickLyricPasteModal";

export interface EditorSidebarProps {
  items: SetlistItem[];
  activeSongIndex: number;
  activeSlideIndex: number;
  onSelectSong: (index: number) => void;
  onSelectSlide: (index: number) => void;
  onReorderSong: (fromIndex: number, toIndex: number) => void;
  onDeleteSong: (index: number) => void;
  onAddSong: (newDeck: Deck) => void;
  onAddSlide: () => void;
  onDeleteSlide: (index: number) => void;
  className?: string;
}

type TabType = "songs" | "slides";

/**
 * Canva / MiriCanvas 스타일 좌측 슬라이드 & 곡 탐색 패널
 * - 탭 1: 콘티 곡 목록 (곡 순서 변경, 곡 추가, 곡 삭제)
 * - 탭 2: 현재 곡 슬라이드 썸네일 목록
 */
export function EditorSidebar({
  items,
  activeSongIndex,
  activeSlideIndex,
  onSelectSong,
  onSelectSlide,
  onReorderSong,
  onDeleteSong,
  onAddSong,
  onAddSlide,
  onDeleteSlide,
  className = "",
}: EditorSidebarProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<TabType>("songs");
  const [isQuickPasteOpen, setIsQuickPasteOpen] = useState(false);

  const currentSong = items[activeSongIndex]?.deck;
  const currentSlides = currentSong?.slides ?? [];

  return (
    <aside
      data-testid="editor-sidebar"
      className={`w-72 bg-zinc-950 border-r border-zinc-800/80 flex flex-col select-none ${className}`}
    >
      {/* 탭 전환 헤더 */}
      <div className="p-3 border-b border-zinc-800/80 bg-zinc-900/40 flex items-center gap-1">
        <button
          type="button"
          data-testid="tab-songs-btn"
          onClick={() => setActiveTab("songs")}
          className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
            activeTab === "songs"
              ? "bg-zinc-800 text-white shadow-sm"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
          }`}
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
              d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
            />
          </svg>
          <span>콘티 곡 ({items.length})</span>
        </button>

        <button
          type="button"
          data-testid="tab-slides-btn"
          onClick={() => setActiveTab("slides")}
          className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
            activeTab === "slides"
              ? "bg-zinc-800 text-white shadow-sm"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
          }`}
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
              d="M4 6h16M4 10h16M4 14h16M4 18h16"
            />
          </svg>
          <span>슬라이드 ({currentSlides.length})</span>
        </button>
      </div>

      {/* 탭 1: 콘티 곡 목록 */}
      {activeTab === "songs" && (
        <div className="flex-1 overflow-y-auto p-3 flex flex-col justify-between">
          <div className="space-y-1.5">
            {items.map((item, index) => {
              const isActive = index === activeSongIndex;
              const deck = item.deck;
              const title = deck?.title || "제목 없음";
              const artist = deck?.artist || "";
              const slideCount = deck?.slides.length ?? 0;

              return (
                <div
                  key={item.id}
                  data-testid={`sidebar-song-item-${index}`}
                  onClick={() => onSelectSong(index)}
                  className={`group relative p-2.5 rounded-xl border flex items-center justify-between gap-2 cursor-pointer transition-all ${
                    isActive
                      ? "bg-zinc-900 border-emerald-500/70 shadow-md ring-1 ring-emerald-500/30"
                      : "bg-zinc-900/40 border-zinc-800/80 hover:border-zinc-700 hover:bg-zinc-900/80"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <span
                      className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-mono font-bold shrink-0 ${
                        isActive
                          ? "bg-emerald-600 text-white"
                          : "bg-zinc-800 text-zinc-400 group-hover:text-zinc-200"
                      }`}
                    >
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-zinc-100 truncate">
                        {title}
                      </div>
                      <div className="text-[11px] text-zinc-400 truncate flex items-center gap-1.5">
                        {artist && <span>{artist}</span>}
                        <span className="text-[10px] text-zinc-500 font-mono">
                          {slideCount}장
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 순서 이동 & 삭제 버튼 */}
                  <div className="flex items-center gap-0.5 shrink-0 opacity-80 group-hover:opacity-100">
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={(e) => {
                        e.stopPropagation();
                        onReorderSong(index, index - 1);
                      }}
                      className="p-1 rounded text-zinc-400 hover:text-white disabled:opacity-20 cursor-pointer"
                      title="위로 이동"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      disabled={index === items.length - 1}
                      onClick={(e) => {
                        e.stopPropagation();
                        onReorderSong(index, index + 1);
                      }}
                      className="p-1 rounded text-zinc-400 hover:text-white disabled:opacity-20 cursor-pointer"
                      title="아래로 이동"
                    >
                      ▼
                    </button>
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteSong(index);
                        }}
                        className="p-1 rounded text-zinc-500 hover:text-red-400 cursor-pointer"
                        title="곡 삭제"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 새 곡 추가 버튼 */}
          <div className="pt-3 border-t border-zinc-800/80 mt-2">
            <button
              type="button"
              data-testid="sidebar-add-song-btn"
              onClick={() => setIsQuickPasteOpen(true)}
              className="w-full py-2 px-3 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 hover:border-emerald-500/50 text-xs font-semibold text-zinc-200 hover:text-white transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm"
            >
              <svg
                className="w-4 h-4 text-emerald-400"
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
              <span>가사 붙여넣기로 새 곡 추가</span>
            </button>
          </div>
        </div>
      )}

      {/* 탭 2: 슬라이드 썸네일 목록 */}
      {activeTab === "slides" && (
        <div className="flex-1 overflow-y-auto p-3 flex flex-col justify-between">
          <div className="space-y-2">
            {currentSlides.map((slide, index) => {
              const isActive = index === activeSlideIndex;
              const textPreview = slide.lines[0] || "(빈 슬라이드)";

              return (
                <div
                  key={slide.id || index}
                  data-testid={`sidebar-slide-item-${index}`}
                  onClick={() => onSelectSlide(index)}
                  className={`group relative p-2 rounded-lg border cursor-pointer transition-all flex items-center gap-2.5 ${
                    isActive
                      ? "bg-zinc-900 border-emerald-500 ring-1 ring-emerald-500/30"
                      : "bg-zinc-900/40 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900"
                  }`}
                >
                  <span
                    className={`w-5 h-5 rounded flex items-center justify-center text-xs font-mono font-bold shrink-0 ${
                      isActive
                        ? "bg-emerald-600 text-white"
                        : "bg-zinc-800 text-zinc-400"
                    }`}
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-zinc-200 truncate">
                      {textPreview}
                    </p>
                    <p className="text-[10px] text-zinc-500 truncate">
                      {slide.lines.length}줄
                    </p>
                  </div>
                  {currentSlides.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteSlide(index);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-red-400 transition-opacity cursor-pointer"
                      title="슬라이드 삭제"
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="pt-3 border-t border-zinc-800 mt-2">
            <button
              type="button"
              onClick={onAddSlide}
              className="w-full py-2 px-3 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs font-medium text-zinc-300 hover:text-white transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span>+ 새 슬라이드 추가</span>
            </button>
          </div>
        </div>
      )}

      {/* 가사 빠른 입력 모달 */}
      <QuickLyricPasteModal
        isOpen={isQuickPasteOpen}
        onClose={() => setIsQuickPasteOpen(false)}
        onAddToSet={(newDeck) => {
          onAddSong(newDeck);
          setIsQuickPasteOpen(false);
        }}
      />
    </aside>
  );
}
