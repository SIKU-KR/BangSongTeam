import React, { useState } from "react";
import type { Deck, PresentationItem } from "@repo/shared";
import {
  INITIAL_BACKGROUNDS,
  getBackgroundPosterUrl,
  splitLyricsIntoSlides,
  DEFAULT_DECK_STYLE,
} from "@repo/shared";
import { QuickLyricPasteModal } from "./QuickLyricPasteModal";
import { ThemeMenuButton } from "../../components/common/ThemeMenuButton";

export interface EditorSidebarProps {
  items: PresentationItem[];
  activeSongIndex: number;
  activeSlideIndex: number;
  onSelectSong: (index: number) => void;
  onSelectSlide: (index: number) => void;
  onReorderSong: (fromIndex: number, toIndex: number) => void;
  onDeleteSong: (index: number) => void;
  onDuplicateSong?: (index: number) => void;
  onAddSong: (newDeck: Deck) => void;
  onAddSlide: () => void;
  onDeleteSlide: (index: number) => void;
  onDuplicateSlide?: (index: number) => void;
  onReorderSlide?: (fromIndex: number, toIndex: number) => void;
  onUpdateBackground?: (bgId: string) => void;
  onUpdateStyle?: (styleUpdate: Partial<Deck["style"]>) => void;
  className?: string;
}

type TabType = "songs" | "slides" | "lyrics" | "backgrounds" | "styles";

const STYLE_PRESETS: {
  name: string;
  desc: string;
  badge: string;
  style: Partial<Deck["style"]>;
}[] = [
  {
    name: "클래식 워십",
    desc: "Pretendard · 화이트 · 은은한 그림자",
    badge: "기본",
    style: {
      fontFamily: "Pretendard",
      fontColor: "#FFFFFF",
      textShadowLevel: "soft",
      overlayOpacity: 45,
    },
  },
  {
    name: "다크 모던",
    desc: "Noto Sans KR · 민트 · 보통 그림자",
    badge: "모던",
    style: {
      fontFamily: "Noto Sans KR",
      fontColor: "#A7F3D0",
      textShadowLevel: "medium",
      overlayOpacity: 60,
    },
  },
  {
    name: "선샤인 웜",
    desc: "Gmarket Sans · 옐로우 · 강한 그림자",
    badge: "따뜻함",
    style: {
      fontFamily: "Gmarket Sans",
      fontColor: "#FEF08A",
      textShadowLevel: "strong",
      overlayOpacity: 50,
    },
  },
  {
    name: "오션 블루",
    desc: "Pretendard · 스카이 · 은은한 그림자",
    badge: "청량함",
    style: {
      fontFamily: "Pretendard",
      fontColor: "#BAE6FD",
      textShadowLevel: "soft",
      overlayOpacity: 40,
    },
  },
  {
    name: "감성 고운바탕",
    desc: "KoPubWorld Batang · 핑크 · 소프트",
    badge: "명조",
    style: {
      fontFamily: "KoPubWorld Batang",
      fontColor: "#FBCFE8",
      textShadowLevel: "soft",
      overlayOpacity: 50,
    },
  },
];

/**
 * Canva / MiriCanvas 스타일 좌측 슬라이드 & 곡 탐색 패널
 * - 좌측 아이콘 레일 (프레젠테이션 곡, 슬라이드, 가사 입력, 모션 배경, 디자인 스타일)
 * - 슬라이드 드로어 패널 (접기/펼치기 가능)
 */
export function EditorSidebar({
  items,
  activeSongIndex,
  activeSlideIndex,
  onSelectSong,
  onSelectSlide,
  onReorderSong,
  onDeleteSong,
  onDuplicateSong,
  onAddSong,
  onAddSlide,
  onDeleteSlide,
  onDuplicateSlide,
  onReorderSlide,
  onUpdateBackground,
  onUpdateStyle,
  className = "",
}: EditorSidebarProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<TabType>("songs");
  const [isDrawerOpen, setIsDrawerOpen] = useState(true);
  const [isQuickPasteOpen, setIsQuickPasteOpen] = useState(false);
  const [inlineLyricTitle, setInlineLyricTitle] = useState("");
  const [inlineLyricText, setInlineLyricText] = useState("");

  const currentSong = items[activeSongIndex]?.deck;
  const currentSlides = currentSong?.slides ?? [];

  const handleTabClick = (tab: TabType) => {
    if (activeTab === tab && isDrawerOpen) {
      setIsDrawerOpen(false);
    } else {
      setActiveTab(tab);
      setIsDrawerOpen(true);
    }
  };

  const handleInlineLyricSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inlineLyricTitle.trim() || !inlineLyricText.trim()) return;

    const parsedSlides = splitLyricsIntoSlides(inlineLyricText);
    const newDeck: Deck = {
      id: `deck_${crypto.randomUUID().slice(0, 8)}`,
      userId: currentSong?.userId || "user_local",
      catalogId: null,
      scope: "presentation",
      presentationId: null,
      title: inlineLyricTitle.trim(),
      artist: "찬양 곡",
      lyricsRaw: inlineLyricText.trim(),
      slides: parsedSlides,
      backgroundId: currentSong?.backgroundId ?? INITIAL_BACKGROUNDS[0].id,
      style: currentSong?.style ?? {
        ...DEFAULT_DECK_STYLE,
        fontSizeVw: 4.5,
        overlayOpacity: 50,
      },
      visibility: "private",
      forkedFrom: null,
      forkCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    onAddSong(newDeck);
    setInlineLyricTitle("");
    setInlineLyricText("");
    setActiveTab("songs");
  };

  return (
    <aside
      data-testid="editor-sidebar"
      className={`flex bg-white dark:bg-zinc-950 border-r border-zinc-200 dark:border-zinc-800/80 select-none ${className}`}
    >
      {/* 1. Canva 스타일 슬림 아이콘 레일 (Icon Rail) */}
      <div className="w-16 bg-white dark:bg-zinc-950 border-r border-zinc-200 dark:border-zinc-800/80 flex flex-col items-center justify-between py-3 shrink-0">
        <div className="flex flex-col items-center gap-2 w-full px-1">
          {/* 프레젠테이션 곡 버튼 */}
          <button
            type="button"
            data-testid="tab-songs-btn"
            onClick={() => handleTabClick("songs")}
            className={`w-full py-2 flex flex-col items-center gap-1 rounded-xl text-[10px] font-medium transition-colors cursor-pointer ${
              activeTab === "songs" && isDrawerOpen
                ? "bg-zinc-100 dark:bg-zinc-800 text-emerald-600 dark:text-emerald-400 font-bold shadow-sm dark:shadow"
                : "text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-900/80"
            }`}
            title="프레젠테이션 곡 목록"
          >
            <svg
              className="w-4 h-4"
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
            <span>프레젠테이션 ({items.length})</span>
          </button>

          {/* 슬라이드 썸네일 버튼 */}
          <button
            type="button"
            data-testid="tab-slides-btn"
            onClick={() => handleTabClick("slides")}
            className={`w-full py-2 flex flex-col items-center gap-1 rounded-xl text-[10px] font-medium transition-colors cursor-pointer ${
              activeTab === "slides" && isDrawerOpen
                ? "bg-zinc-100 dark:bg-zinc-800 text-emerald-600 dark:text-emerald-400 font-bold shadow-sm dark:shadow"
                : "text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-900/80"
            }`}
            title="슬라이드 탐색"
          >
            <svg
              className="w-4 h-4"
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
            <span>슬라이드</span>
          </button>

          {/* 가사 입력 탭 */}
          <button
            type="button"
            data-testid="tab-lyrics-btn"
            onClick={() => handleTabClick("lyrics")}
            className={`w-full py-2 flex flex-col items-center gap-1 rounded-xl text-[10px] font-medium transition-colors cursor-pointer ${
              activeTab === "lyrics" && isDrawerOpen
                ? "bg-zinc-100 dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 font-bold shadow-sm dark:shadow"
                : "text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-900/80"
            }`}
            title="가사 빠른 입력"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
            <span>가사</span>
          </button>

          {/* 모션 배경 탭 */}
          <button
            type="button"
            data-testid="tab-bg-btn"
            onClick={() => handleTabClick("backgrounds")}
            className={`w-full py-2 flex flex-col items-center gap-1 rounded-xl text-[10px] font-medium transition-colors cursor-pointer ${
              activeTab === "backgrounds" && isDrawerOpen
                ? "bg-zinc-100 dark:bg-zinc-800 text-emerald-600 dark:text-emerald-400 font-bold shadow-sm dark:shadow"
                : "text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-900/80"
            }`}
            title="모션 배경 루프 라이브러리"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
            <span>배경</span>
          </button>

          {/* 디자인 스타일 탭 */}
          <button
            type="button"
            data-testid="tab-styles-btn"
            onClick={() => handleTabClick("styles")}
            className={`w-full py-2 flex flex-col items-center gap-1 rounded-xl text-[10px] font-medium transition-colors cursor-pointer ${
              activeTab === "styles" && isDrawerOpen
                ? "bg-zinc-100 dark:bg-zinc-800 text-pink-600 dark:text-pink-400 font-bold shadow-sm dark:shadow"
                : "text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-900/80"
            }`}
            title="테마 스타일 프리셋"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 21a4 4 0 01-4-4 5 5 0 015-5h1a4 4 0 014 4v1a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
              />
            </svg>
            <span>스타일</span>
          </button>
        </div>

        {/* 하단 드로어 접기/펼치기 토글 버튼 & 테마 전환 버튼 */}
        <div className="flex flex-col items-center gap-1.5 w-full px-1">
          <ThemeMenuButton variant="compact" direction="up" />
          <button
            type="button"
            data-testid="collapse-sidebar-drawer-btn"
            onClick={() => setIsDrawerOpen((prev) => !prev)}
            className="p-2 rounded-lg text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-900 transition-colors cursor-pointer"
            title={isDrawerOpen ? "패널 접기" : "패널 펼치기"}
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d={
                  isDrawerOpen
                    ? "M11 19l-7-7 7-7m8 14l-7-7 7-7"
                    : "M13 5l7 7-7 7M5 5l7 7-7 7"
                }
              />
            </svg>
          </button>
        </div>
      </div>

      {/* 2. 드로어 본문 패널 (Drawer Panel) */}
      {isDrawerOpen && (
        <div className="w-64 bg-white dark:bg-zinc-950 flex flex-col justify-between overflow-hidden">
          {/* 드로어 상단 헤더 */}
          <div className="p-3.5 border-b border-zinc-200 dark:border-zinc-800/80 flex items-center justify-between">
            <h3 className="text-xs font-bold text-zinc-900 dark:text-white flex items-center gap-1.5">
              {activeTab === "songs" && (
                <span>프레젠테이션 곡 목록 ({items.length})</span>
              )}
              {activeTab === "slides" && (
                <span>현재 곡 슬라이드 ({currentSlides.length})</span>
              )}
              {activeTab === "lyrics" && <span>가사 빠른 추가</span>}
              {activeTab === "backgrounds" && <span>모션 비디오 루프</span>}
              {activeTab === "styles" && <span>디자인 테마 프리셋</span>}
            </h3>
            <button
              type="button"
              onClick={() => setIsDrawerOpen(false)}
              className="text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-300 p-0.5 rounded cursor-pointer"
              title="패널 닫기"
            >
              ✕
            </button>
          </div>

          {/* 탭 1: 프레젠테이션 곡 목록 */}
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
                          ? "bg-emerald-50/60 dark:bg-zinc-900 border-emerald-500/70 shadow-sm dark:shadow-md ring-1 ring-emerald-500/30"
                          : "bg-zinc-50 dark:bg-zinc-900/40 border-zinc-200 dark:border-zinc-800/80 hover:border-zinc-300 dark:hover:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-900/80"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <span
                          className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-mono font-bold shrink-0 ${
                            isActive
                              ? "bg-emerald-600 text-white"
                              : "bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-zinc-200"
                          }`}
                        >
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                            {title}
                          </div>
                          <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate flex items-center gap-1.5">
                            {artist && <span>{artist}</span>}
                            <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-mono">
                              {slideCount}장
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* 순서 이동 & 복제 & 삭제 버튼 */}
                      <div className="flex items-center gap-0.5 shrink-0 opacity-80 group-hover:opacity-100">
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            onReorderSong(index, index - 1);
                          }}
                          className="p-1 rounded text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white disabled:opacity-20 cursor-pointer"
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
                          className="p-1 rounded text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white disabled:opacity-20 cursor-pointer"
                          title="아래로 이동"
                        >
                          ▼
                        </button>
                        {onDuplicateSong && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDuplicateSong(index);
                            }}
                            className="p-1 rounded text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 cursor-pointer"
                            title="곡 복제"
                          >
                            ⧉
                          </button>
                        )}
                        {items.length > 1 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteSong(index);
                            }}
                            className="p-1 rounded text-zinc-400 hover:text-red-500 dark:text-zinc-500 dark:hover:text-red-400 cursor-pointer"
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
              <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800/80 mt-2">
                <button
                  type="button"
                  data-testid="sidebar-add-song-btn"
                  onClick={() => setIsQuickPasteOpen(true)}
                  className="w-full py-2 px-3 rounded-lg bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-700/80 hover:border-emerald-500/50 text-xs font-semibold text-zinc-800 dark:text-zinc-200 dark:hover:text-white transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm dark:shadow-none"
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
                  <span>가사 붙여넣기로 새 곡 추가</span>
                </button>
              </div>
            </div>
          )}

          {/* 탭 2: 슬라이드 목록 */}
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
                      className={`group relative p-2 rounded-lg border cursor-pointer transition-all flex items-center justify-between gap-2 ${
                        isActive
                          ? "bg-emerald-50/60 dark:bg-zinc-900 border-emerald-500 ring-1 ring-emerald-500/30"
                          : "bg-zinc-50 dark:bg-zinc-900/40 border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-900"
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span
                          className={`w-5 h-5 rounded flex items-center justify-center text-xs font-mono font-bold shrink-0 ${
                            isActive
                              ? "bg-emerald-600 text-white"
                              : "bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
                          }`}
                        >
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-zinc-800 dark:text-zinc-200 truncate">
                            {textPreview}
                          </p>
                          <p className="text-[10px] text-zinc-400 dark:text-zinc-500 truncate">
                            {slide.lines.length}줄
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        {onReorderSlide && (
                          <>
                            <button
                              type="button"
                              disabled={index === 0}
                              onClick={(e) => {
                                e.stopPropagation();
                                onReorderSlide(index, index - 1);
                              }}
                              className="p-0.5 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white disabled:opacity-20 cursor-pointer text-[10px]"
                              title="앞으로"
                            >
                              ▲
                            </button>
                            <button
                              type="button"
                              disabled={index === currentSlides.length - 1}
                              onClick={(e) => {
                                e.stopPropagation();
                                onReorderSlide(index, index + 1);
                              }}
                              className="p-0.5 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white disabled:opacity-20 cursor-pointer text-[10px]"
                              title="뒤로"
                            >
                              ▼
                            </button>
                          </>
                        )}
                        {onDuplicateSlide && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDuplicateSlide(index);
                            }}
                            className="p-0.5 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white cursor-pointer"
                            title="슬라이드 복제"
                          >
                            ⧉
                          </button>
                        )}
                        {currentSlides.length > 1 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteSlide(index);
                            }}
                            className="p-0.5 text-zinc-400 hover:text-red-500 dark:text-zinc-500 dark:hover:text-red-400 cursor-pointer"
                            title="슬라이드 삭제"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800 mt-2">
                <button
                  type="button"
                  onClick={onAddSlide}
                  className="w-full py-2 px-3 rounded-lg bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <span>+ 새 슬라이드 추가</span>
                </button>
              </div>
            </div>
          )}

          {/* 탭 3: 가사 빠른 입력 */}
          {activeTab === "lyrics" && (
            <form
              onSubmit={handleInlineLyricSubmit}
              className="flex-1 overflow-y-auto p-3 flex flex-col gap-3"
            >
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">
                  곡 제목
                </label>
                <input
                  type="text"
                  required
                  placeholder="예: 은혜로다"
                  value={inlineLyricTitle}
                  onChange={(e) => setInlineLyricTitle(e.target.value)}
                  className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="space-y-1 flex-1 flex flex-col">
                <div className="flex justify-between text-[11px] text-zinc-500 dark:text-zinc-400">
                  <span className="font-semibold">가사 원문</span>
                  <span className="text-zinc-400 dark:text-zinc-500">
                    빈 줄 = 슬라이드 구분
                  </span>
                </div>
                <textarea
                  required
                  rows={8}
                  placeholder="가사를 붙여넣으세요...&#10;&#10;빈 줄로 슬라이드가 자동 분할됩니다."
                  value={inlineLyricText}
                  onChange={(e) => setInlineLyricText(e.target.value)}
                  className="w-full flex-1 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-2.5 text-xs text-zinc-900 dark:text-zinc-200 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:border-emerald-500 resize-none font-sans"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg shadow-sm dark:shadow-md transition-colors cursor-pointer"
              >
                새 곡으로 세트에 추가
              </button>
            </form>
          )}

          {/* 탭 4: 모션 배경 */}
          {activeTab === "backgrounds" && (
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 pb-1 border-b border-zinc-200 dark:border-zinc-900">
                원하는 배경을 클릭하면 현재 찬양 곡에 즉시 적용됩니다.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {INITIAL_BACKGROUNDS.map((bg) => {
                  const isSelected = bg.id === currentSong?.backgroundId;
                  const poster = getBackgroundPosterUrl(bg.id);

                  return (
                    <div
                      key={bg.id}
                      onClick={() => onUpdateBackground?.(bg.id)}
                      className={`group relative aspect-video rounded-lg overflow-hidden border cursor-pointer transition-all ${
                        isSelected
                          ? "border-emerald-500 ring-2 ring-emerald-500/40"
                          : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600"
                      }`}
                    >
                      {poster ? (
                        <img
                          src={poster}
                          alt={bg.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        />
                      ) : (
                        <div className="w-full h-full bg-zinc-200 dark:bg-zinc-800" />
                      )}
                      <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-colors" />
                      <span className="absolute bottom-1 left-1.5 text-[9px] font-medium text-white truncate max-w-[90%]">
                        {bg.title}
                      </span>
                      {isSelected && (
                        <span className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[9px]">
                          ✓
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 탭 5: 디자인 테마 프리셋 */}
          {activeTab === "styles" && (
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 pb-1 border-b border-zinc-200 dark:border-zinc-900">
                1-클릭으로 완성도 높은 찬양 슬라이드 타이포그래피를 적용합니다.
              </p>
              <div className="space-y-2">
                {STYLE_PRESETS.map((preset) => (
                  <div
                    key={preset.name}
                    onClick={() => onUpdateStyle?.(preset.style)}
                    className="p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:border-emerald-500/60 bg-zinc-50 dark:bg-zinc-900/60 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-all cursor-pointer flex flex-col gap-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-zinc-900 dark:text-white">
                        {preset.name}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-50 dark:bg-zinc-800 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-zinc-700 font-mono">
                        {preset.badge}
                      </span>
                    </div>
                    <span className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                      {preset.desc}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
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
