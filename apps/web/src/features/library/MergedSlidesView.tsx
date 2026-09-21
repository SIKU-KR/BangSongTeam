import React, { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import type { Presentation } from "@repo/shared";
import { hangulIncludes } from "@repo/shared";
import { PresentationCard } from "../presentation/PresentationCard";
import { launchPresentation } from "../presentation";
import { isGoogleChromeBrowser } from "../../components/common/ChromeAlertBanner";

export interface MergedSlidesViewProps {
  presentation: Presentation;
  onCreateNewPresentation: () => void;
  searchQuery?: string;
  viewMode?: "grid" | "list";
  sortOrder?: "recent" | "name" | "slides";
}

interface AdditionalRecentItem {
  id: string;
  title: string;
  subtitle: string;
  songsCount: number;
  slidesCount: number;
  editedAgo: string;
  badgeLetter: string;
  badgeBg: string;
  bgGradient: string;
}

const ADDITIONAL_RECENT_ITEMS: AdditionalRecentItem[] = [
  {
    id: "recent-item-2",
    title: "청년부 금요 찬양 집회",
    subtitle: "시간을 뚫고, 밤이나 낮이나 외 2곡",
    songsCount: 4,
    slidesCount: 19,
    editedAgo: "3일 전 편집함",
    badgeLetter: "Y",
    badgeBg: "bg-indigo-950 text-indigo-400 border-indigo-800",
    bgGradient: "from-indigo-900/60 via-purple-900/40 to-black",
  },
  {
    id: "recent-item-3",
    title: "부활절 감사예배 특별 프레젠테이션",
    subtitle: "꽃들도, 주의 이름 높이며 외 5곡",
    songsCount: 7,
    slidesCount: 28,
    editedAgo: "1주일 전 편집함",
    badgeLetter: "E",
    badgeBg: "bg-amber-950 text-amber-400 border-amber-800",
    bgGradient: "from-amber-900/60 via-orange-950/40 to-black",
  },
  {
    id: "recent-item-4",
    title: "수요 성령기도회 프레젠테이션",
    subtitle: "주 은혜임을, 은혜로다 외 1곡",
    songsCount: 3,
    slidesCount: 14,
    editedAgo: "2주일 전 편집함",
    badgeLetter: "W",
    badgeBg: "bg-teal-950 text-teal-400 border-teal-800",
    bgGradient: "from-teal-900/60 via-emerald-950/40 to-black",
  },
  {
    id: "recent-item-5",
    title: "주일 1·2부 연합예배",
    subtitle: "시선, 예수 늘 함께 계시네 외 2곡",
    songsCount: 4,
    slidesCount: 20,
    editedAgo: "3주일 전 편집함",
    badgeLetter: "M",
    badgeBg: "bg-blue-950 text-blue-400 border-blue-800",
    bgGradient: "from-blue-900/60 via-sky-950/40 to-black",
  },
];

const FOLDERS_DATA = [
  { id: "f-1", name: "2026 주일 대예배", count: 12, color: "text-emerald-400" },
  {
    id: "f-2",
    name: "청년부 찬양 프레젠테이션",
    count: 8,
    color: "text-indigo-400",
  },
  { id: "f-3", name: "수요·금요 기도회", count: 15, color: "text-sky-400" },
  {
    id: "f-4",
    name: "부활절·성탄절 특별 행사",
    count: 4,
    color: "text-amber-400",
  },
];

/**
 * Canva Projects 스타일 '모든 프로젝트' (홈) 메인 뷰
 * - 상단: "최근" (Recent) 수평 스크롤 캐러셀 및 Canva 스타일 우측 원형 스크롤 버튼 ( > )
 * - 중앙: "⌵ 폴더" 접이식 아코디언 섹션
 * - 하단: "⌵ 모든 프레젠테이션 & 템플릿" (그리드 / 리스트 뷰 모드 지원)
 */
export function MergedSlidesView({
  presentation,
  onCreateNewPresentation,
  searchQuery = "",
  viewMode = "grid",
  sortOrder = "recent",
}: MergedSlidesViewProps): React.JSX.Element {
  const navigate = useNavigate();
  const recentScrollRef = useRef<HTMLDivElement>(null);
  const [isFoldersOpen, setIsFoldersOpen] = useState<boolean>(true);
  const [isAllProjectsOpen, setIsAllProjectsOpen] = useState<boolean>(true);

  const handleStartPresentation = (): void => {
    if (!isGoogleChromeBrowser()) {
      const proceed = window.confirm(
        "이 서비스는 Google Chrome에 최적화되어 있습니다. 예배 송출은 Chrome에서 진행하는 것을 권장합니다.\n\n계속 진행하시겠습니까?",
      );
      if (!proceed) return;
    }
    launchPresentation(navigate);
  };

  const handleOpenEditor = (): void => {
    navigate("/editor");
  };

  const handleScrollRight = (): void => {
    if (recentScrollRef.current) {
      recentScrollRef.current.scrollBy({ left: 340, behavior: "smooth" });
    }
  };

  const handleScrollLeft = (): void => {
    if (recentScrollRef.current) {
      recentScrollRef.current.scrollBy({ left: -340, behavior: "smooth" });
    }
  };

  // 검색어 필터링 (es-hangul 초성/자모 분해/스마트 한글 검색 지원)
  const query = searchQuery.trim();
  const isMatch =
    !query ||
    hangulIncludes(presentation.title, query) ||
    presentation.items.some((item) => {
      const deck = item.deck;
      if (!deck) return false;
      return (
        hangulIncludes(deck.title, query) ||
        hangulIncludes(deck.artist, query) ||
        hangulIncludes(deck.lyricsRaw, query)
      );
    });

  const filteredRecentItems = ADDITIONAL_RECENT_ITEMS.filter((item) => {
    if (!query) return true;
    return (
      hangulIncludes(item.title, query) || hangulIncludes(item.subtitle, query)
    );
  });

  const sortedRecentItems = [...filteredRecentItems].sort((a, b) => {
    if (sortOrder === "name") {
      return a.title.localeCompare(b.title);
    }
    if (sortOrder === "slides") {
      return b.slidesCount - a.slidesCount;
    }
    return 0;
  });

  if (!isMatch && filteredRecentItems.length === 0) {
    return (
      <div className="py-20 text-center flex flex-col items-center justify-center gap-3 bg-zinc-900/30 border border-zinc-800/80 rounded-2xl">
        <div className="w-12 h-12 rounded-full bg-zinc-800/60 flex items-center justify-center text-zinc-500 mb-1">
          <svg
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
        <p className="text-sm font-semibold text-zinc-300">
          "{searchQuery}"에 일치하는 프레젠테이션이 없습니다.
        </p>
        <p className="text-xs text-zinc-500">
          다른 검색어를 입력하거나 새 프레젠테이션을 생성해 보세요.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {/* ───────────────────────────────────────────────────────────
          1. "최근" (Recent) 섹션 - Canva 수평 캐러셀 선반 & 우측 ( > ) 버튼
          ─────────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-zinc-900 dark:text-white tracking-tight">
            최근
          </h2>
        </div>

        {/* 캐러셀 컨테이너 */}
        <div className="relative group/carousel">
          {/* 좌측 스크롤 화살표 버튼 */}
          <button
            type="button"
            onClick={handleScrollLeft}
            aria-label="이전 항목 보기"
            className="absolute -left-3 top-1/2 -translate-y-1/2 z-30 w-10 h-10 rounded-full bg-white/95 dark:bg-zinc-900/90 hover:bg-white dark:hover:bg-zinc-800 text-zinc-700 dark:text-white shadow-md hover:shadow-lg dark:shadow-black/60 flex items-center justify-center border border-zinc-200 dark:border-zinc-700 cursor-pointer transition-all opacity-0 group-hover/carousel:opacity-100 hover:scale-105 active:scale-95"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>

          {/* 수평 스크롤 행 */}
          <div
            ref={recentScrollRef}
            className="flex items-stretch gap-5 overflow-x-auto pb-3 pt-1 scroll-smooth no-scrollbar select-none"
            style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          >
            {/* 1) 현재 활성 프레젠테이션 카드 (테스트 ID 및 단일 프레젠테이션 보존) */}
            {isMatch && (
              <div className="w-[300px] sm:w-[320px] shrink-0">
                <PresentationCard
                  presentation={presentation}
                  onPresent={handleStartPresentation}
                  onEdit={handleOpenEditor}
                  className="h-full"
                />
              </div>
            )}

            {/* 2) Canva 스타일의 추가 최근 프로젝트 카드들 */}
            {sortedRecentItems.map((item) => (
              <div
                key={item.id}
                onClick={handleOpenEditor}
                className="group w-[300px] sm:w-[320px] shrink-0 flex flex-col bg-white dark:bg-zinc-900/60 hover:bg-zinc-50 dark:hover:bg-zinc-900/90 border border-zinc-200 dark:border-zinc-800/80 hover:border-zinc-300 dark:hover:border-zinc-700 rounded-2xl overflow-hidden transition-all duration-200 shadow-sm hover:shadow-md dark:shadow-none dark:hover:shadow-lg dark:hover:shadow-black/50 hover:-translate-y-0.5 cursor-pointer"
              >
                {/* 16:9 썸네일 영역 */}
                <div className="relative w-full aspect-video bg-zinc-950 overflow-hidden rounded-t-2xl">
                  <div
                    className={`w-full h-full bg-gradient-to-br ${item.bgGradient} flex flex-col items-center justify-center p-4 text-center transition-transform duration-300 group-hover:scale-105`}
                  >
                    <span className="text-xs font-semibold text-white/90 drop-shadow line-clamp-2">
                      {item.title}
                    </span>
                    <span className="text-[10px] text-zinc-400 mt-1">
                      {item.songsCount}곡 포함 · 16:9 와이드
                    </span>
                  </div>

                  {/* 상단 배지 */}
                  <div className="absolute top-2.5 left-2.5 z-20 flex items-center gap-1.5">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-black/70 backdrop-blur-md text-zinc-300 border border-zinc-700/40">
                      16:9
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-indigo-950/80 backdrop-blur-md text-indigo-300 border border-indigo-700/40">
                      {item.songsCount}곡 세트
                    </span>
                  </div>

                  <div className="absolute top-2.5 right-2.5 z-20">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono text-zinc-300 bg-black/70 backdrop-blur-md border border-zinc-700/40">
                      {item.slidesCount} 슬라이드
                    </span>
                  </div>

                  {/* 호버 시 퀵 액션 */}
                  <div className="absolute inset-0 z-30 bg-black/60 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-2.5 p-4">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStartPresentation();
                      }}
                      className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md flex items-center gap-1.5 cursor-pointer"
                    >
                      <svg
                        className="w-3.5 h-3.5 fill-current"
                        viewBox="0 0 24 24"
                      >
                        <path d="M8 5v14l11-7z" />
                      </svg>
                      <span>발표</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenEditor();
                      }}
                      className="px-3.5 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-xs font-medium border border-zinc-600/50 shadow-md flex items-center gap-1.5 cursor-pointer"
                    >
                      <span>편집</span>
                    </button>
                  </div>
                </div>

                {/* 하단 메타데이터 */}
                <div className="p-3.5 flex flex-col justify-between gap-1.5 bg-white dark:bg-zinc-900/60">
                  <h3 className="text-xs sm:text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                    {item.title}
                  </h3>
                  <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                    <span
                      className={`w-4 h-4 rounded flex items-center justify-center text-[9px] font-bold border shrink-0 ${item.badgeBg}`}
                    >
                      {item.badgeLetter}
                    </span>
                    <span className="truncate">{item.subtitle}</span>
                    <span className="text-zinc-300 dark:text-zinc-600 shrink-0">
                      •
                    </span>
                    <span className="text-zinc-400 dark:text-zinc-400 shrink-0">
                      {item.editedAgo}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* 우측 원형 스크롤 버튼 (Canva 대표 UI 요소) */}
          <button
            type="button"
            onClick={handleScrollRight}
            aria-label="다음 최근 항목 보기"
            className="absolute -right-3 top-1/2 -translate-y-1/2 z-30 w-10 h-10 rounded-full bg-white/95 dark:bg-zinc-900/90 hover:bg-white dark:hover:bg-zinc-800 text-zinc-700 dark:text-white shadow-md hover:shadow-lg dark:shadow-black/60 flex items-center justify-center border border-zinc-200 dark:border-zinc-700 cursor-pointer transition-all hover:scale-110 active:scale-95"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
        </div>
      </section>

      {/* ───────────────────────────────────────────────────────────
          2. "⌵ 폴더" (Folders) 아코디언 섹션
          ─────────────────────────────────────────────────────────── */}
      <section className="space-y-3 pt-2">
        <button
          type="button"
          onClick={() => setIsFoldersOpen(!isFoldersOpen)}
          className="flex items-center gap-2 text-lg font-bold text-zinc-900 dark:text-white hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors cursor-pointer group"
        >
          <svg
            className={`w-5 h-5 text-zinc-400 group-hover:text-zinc-700 dark:group-hover:text-white transition-transform duration-200 ${
              isFoldersOpen ? "rotate-0" : "-rotate-90"
            }`}
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
          <span>폴더</span>
          <span className="text-xs font-normal text-zinc-500 ml-1">
            ({FOLDERS_DATA.length})
          </span>
        </button>

        {isFoldersOpen && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 animate-in fade-in duration-200">
            {FOLDERS_DATA.map((folder) => (
              <div
                key={folder.id}
                onClick={handleOpenEditor}
                className="group flex items-center gap-3 p-3.5 rounded-xl bg-white dark:bg-zinc-900/50 hover:bg-zinc-50 dark:hover:bg-zinc-900 border border-zinc-200 dark:border-zinc-800/80 hover:border-zinc-300 dark:hover:border-zinc-700 cursor-pointer transition-all shadow-sm hover:shadow-md"
              >
                <div className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                  <svg
                    className={`w-5 h-5 ${folder.color}`}
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-200 group-hover:text-emerald-600 dark:group-hover:text-white truncate">
                    {folder.name}
                  </p>
                  <p className="text-[11px] text-zinc-500 mt-0.5">
                    항목 {folder.count}개
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ───────────────────────────────────────────────────────────
          3. "⌵ 모든 프레젠테이션 & 템플릿" (그리드 / 리스트 뷰 지원)
          ─────────────────────────────────────────────────────────── */}
      <section className="space-y-4 pt-2">
        <button
          type="button"
          onClick={() => setIsAllProjectsOpen(!isAllProjectsOpen)}
          className="flex items-center gap-2 text-lg font-bold text-zinc-900 dark:text-white hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors cursor-pointer group"
        >
          <svg
            className={`w-5 h-5 text-zinc-400 group-hover:text-zinc-700 dark:group-hover:text-white transition-transform duration-200 ${
              isAllProjectsOpen ? "rotate-0" : "-rotate-90"
            }`}
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
          <span>모든 프레젠테이션 및 템플릿</span>
        </button>

        {isAllProjectsOpen && (
          <div>
            {viewMode === "grid" ? (
              /* 그리드 뷰 모드 */
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in duration-200">
                {/* 1) 새 프레젠테이션 생성 점선 카드 */}
                <div
                  onClick={onCreateNewPresentation}
                  className="group border-2 border-dashed border-zinc-300 dark:border-zinc-800 hover:border-emerald-500 dark:hover:border-emerald-500/60 rounded-2xl flex flex-col items-center justify-center p-8 min-h-[220px] cursor-pointer transition-all bg-white dark:bg-zinc-950/40 hover:bg-emerald-50/40 dark:hover:bg-zinc-900/30 shadow-sm hover:shadow-md"
                >
                  <div className="w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-900 group-hover:bg-emerald-100 dark:group-hover:bg-emerald-950/60 border border-zinc-200 dark:border-zinc-700/80 group-hover:border-emerald-400 dark:group-hover:border-emerald-500/50 flex items-center justify-center text-zinc-500 dark:text-zinc-400 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors mb-3">
                    <svg
                      className="w-6 h-6"
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
                  </div>
                  <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-300 group-hover:text-emerald-700 dark:group-hover:text-white transition-colors">
                    새 프레젠테이션 생성
                  </span>
                  <span className="text-xs text-zinc-500 mt-1">
                    새로운 예배 세트 시작
                  </span>
                </div>

                {/* 2) 추천 예배 템플릿 카드 1 */}
                <div
                  onClick={onCreateNewPresentation}
                  className="group relative flex flex-col bg-white dark:bg-zinc-900/50 hover:bg-zinc-50 dark:hover:bg-zinc-900/80 border border-zinc-200 dark:border-zinc-800/80 hover:border-zinc-300 dark:hover:border-zinc-700 rounded-2xl overflow-hidden transition-all duration-200 shadow-sm hover:shadow-md dark:shadow-none dark:hover:shadow-lg dark:hover:shadow-black/50 hover:-translate-y-0.5 cursor-pointer"
                >
                  <div className="relative w-full aspect-video bg-zinc-950 flex items-center justify-center overflow-hidden">
                    <div className="w-full h-full bg-gradient-to-tr from-emerald-950 via-zinc-900 to-teal-950/40 flex flex-col items-center justify-center p-4 text-center">
                      <span className="text-xs font-bold text-white mb-1">
                        주일 대예배 표준 템플릿
                      </span>
                      <span className="text-[11px] text-zinc-400">
                        입례송 · 찬양 3곡 · 봉헌송 구성
                      </span>
                    </div>
                    <div className="absolute top-2.5 left-2.5 z-20">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-black/70 text-emerald-400 border border-emerald-500/30">
                        추천 템플릿
                      </span>
                    </div>
                  </div>
                  <div className="p-3.5 bg-white dark:bg-zinc-900/50">
                    <h3 className="text-xs sm:text-sm font-semibold text-zinc-900 dark:text-zinc-200">
                      주일 1·2·3부 표준 예배 템플릿
                    </h3>
                    <p className="text-[11px] text-zinc-500 mt-0.5">
                      클릭하여 이 템플릿으로 새 세트 시작
                    </p>
                  </div>
                </div>

                {/* 3) 추천 예배 템플릿 카드 2 */}
                <div
                  onClick={onCreateNewPresentation}
                  className="group relative flex flex-col bg-white dark:bg-zinc-900/50 hover:bg-zinc-50 dark:hover:bg-zinc-900/80 border border-zinc-200 dark:border-zinc-800/80 hover:border-zinc-300 dark:hover:border-zinc-700 rounded-2xl overflow-hidden transition-all duration-200 shadow-sm hover:shadow-md dark:shadow-none dark:hover:shadow-lg dark:hover:shadow-black/50 hover:-translate-y-0.5 cursor-pointer"
                >
                  <div className="relative w-full aspect-video bg-zinc-950 flex items-center justify-center overflow-hidden">
                    <div className="w-full h-full bg-gradient-to-tr from-indigo-950 via-zinc-900 to-purple-950/40 flex flex-col items-center justify-center p-4 text-center">
                      <span className="text-xs font-bold text-white mb-1">
                        찬양과 경배 집회 템플릿
                      </span>
                      <span className="text-[11px] text-zinc-400">
                        찬양 6곡 연속 진행형 모션 루프 구성
                      </span>
                    </div>
                    <div className="absolute top-2.5 left-2.5 z-20">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-black/70 text-indigo-400 border border-indigo-500/30">
                        추천 템플릿
                      </span>
                    </div>
                  </div>
                  <div className="p-3.5 bg-white dark:bg-zinc-900/50">
                    <h3 className="text-xs sm:text-sm font-semibold text-zinc-900 dark:text-zinc-200">
                      청년·금요 찬양 집회 템플릿
                    </h3>
                    <p className="text-[11px] text-zinc-500 mt-0.5">
                      클릭하여 이 템플릿으로 새 세트 시작
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              /* 리스트 뷰 모드 (Canva 스타일 깔끔한 테이블 행 목록) */
              <div className="border border-zinc-200 dark:border-zinc-800/80 rounded-2xl overflow-hidden bg-white dark:bg-zinc-900/40 shadow-sm animate-in fade-in duration-200">
                <table className="w-full text-left text-xs text-zinc-700 dark:text-zinc-300">
                  <thead className="bg-zinc-50 dark:bg-zinc-900/90 text-[11px] text-zinc-600 dark:text-zinc-500 font-semibold border-b border-zinc-200 dark:border-zinc-800 uppercase tracking-wider">
                    <tr>
                      <th className="py-3 px-4">이름</th>
                      <th className="py-3 px-4 hidden sm:table-cell">소유자</th>
                      <th className="py-3 px-4 hidden md:table-cell">수정일</th>
                      <th className="py-3 px-4">구성</th>
                      <th className="py-3 px-4 text-right">작업</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/60">
                    {/* 1) 주 세트리스트 행 */}
                    <tr
                      onClick={handleOpenEditor}
                      className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-4 flex items-center gap-3">
                        <div className="w-10 h-6 bg-emerald-100 dark:bg-emerald-950 rounded border border-emerald-300 dark:border-emerald-800/80 flex items-center justify-center text-[10px] text-emerald-700 dark:text-emerald-400 font-bold shrink-0">
                          16:9
                        </div>
                        <div className="min-w-0">
                          <span className="font-semibold text-zinc-900 dark:text-white truncate block">
                            {presentation.title}
                          </span>
                          <span className="text-[11px] text-zinc-500 truncate block">
                            {presentation.items
                              .map((i) => i.deck?.title)
                              .filter(Boolean)
                              .join(", ")}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4 hidden sm:table-cell text-zinc-500 dark:text-zinc-400">
                        나 (주일 찬양팀)
                      </td>
                      <td className="py-3 px-4 hidden md:table-cell text-zinc-400 dark:text-zinc-500">
                        최근 편집됨
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded-full text-[10px] bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700">
                          {presentation.items.length}곡 · 23슬라이드
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStartPresentation();
                            }}
                            className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm cursor-pointer transition-colors"
                          >
                            발표
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenEditor();
                            }}
                            className="px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 text-xs font-medium cursor-pointer transition-colors"
                          >
                            편집
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* 2) 추가 최근 항목 행들 */}
                    {sortedRecentItems.map((item) => (
                      <tr
                        key={item.id}
                        onClick={handleOpenEditor}
                        className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer transition-colors"
                      >
                        <td className="py-3 px-4 flex items-center gap-3">
                          <div className="w-10 h-6 bg-zinc-100 dark:bg-zinc-800 rounded border border-zinc-200 dark:border-zinc-700 flex items-center justify-center text-[10px] text-zinc-600 dark:text-zinc-400 font-bold shrink-0">
                            16:9
                          </div>
                          <div className="min-w-0">
                            <span className="font-semibold text-zinc-900 dark:text-white truncate block">
                              {item.title}
                            </span>
                            <span className="text-[11px] text-zinc-500 truncate block">
                              {item.subtitle}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-4 hidden sm:table-cell text-zinc-500 dark:text-zinc-400">
                          찬양사역팀
                        </td>
                        <td className="py-3 px-4 hidden md:table-cell text-zinc-400 dark:text-zinc-500">
                          {item.editedAgo}
                        </td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded-full text-[10px] bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700">
                            {item.songsCount}곡 · {item.slidesCount}슬라이드
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStartPresentation();
                              }}
                              className="px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-[11px] cursor-pointer transition-colors"
                            >
                              발표
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenEditor();
                              }}
                              className="px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 text-[11px] cursor-pointer transition-colors"
                            >
                              편집
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
