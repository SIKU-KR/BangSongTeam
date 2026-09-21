import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChromeAlertBanner,
  isGoogleChromeBrowser,
} from "../components/common/ChromeAlertBanner";
import { QuickLyricPasteModal } from "../features/editor";
import {
  useActiveSetlist,
  addDeckToSetlist,
  removeSongFromSetlist,
  duplicateSongInSetlist,
  createNewSetlist,
  resetActiveSetlist,
} from "../features/presentation";
import { PresentationCard } from "../features/presentation/PresentationCard";
import { SlideStage } from "../components/stage/SlideStage";
import {
  getBackgroundPosterUrl,
  getBackgroundMediaUrl,
} from "@repo/shared";
import type { Deck } from "@repo/shared";

type ViewMode = "grid" | "list";
type FilterTab = "all" | "setlists" | "songs";
type SortOption = "recent" | "title" | "slides";

/**
 * Canva / MiriCanvas 스타일 프레젠테이션 대시보드 (피피티 리스트 페이지)
 * - 좌측: Canva 스타일 고정 내비게이션 사이드바 (홈, 내 콘티, 찬양 템플릿, 배경 루프, PWA 오프라인 상태)
 * - 상단: 글로벌 네비게이션 헤더 (브랜드 로고, 검색 바, 새 프레젠테이션 만들기 CTA)
 * - 상단 템플릿/추천 바: M1 송출 시작, 가사 빠른 입력, 빈 16:9 프레젠테이션, 기본 세트 복원
 * - 필터 & 정렬 & 뷰 모드 전환: 그리드 뷰 (16:9 슬라이드 카드) / 리스트 뷰 (16:9 미니 썸네일 탑재)
 * - 16:9 슬라이드쇼 썸네일 그리드: 실제 SlideStage를 축소 렌더링하여 프레젠테이션 시각적 정체성 복원
 * - 호버 액션: 즉각 슬라이드쇼 발표, 복제, 삭제 및 /editor 편집기 진입
 */
export function HomeRoute(): React.JSX.Element {
  const navigate = useNavigate();
  const setlist = useActiveSetlist();
  const [isQuickPasteOpen, setIsQuickPasteOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortBy, setSortBy] = useState<SortOption>("recent");

  const handleStartPresentation = (): void => {
    if (!isGoogleChromeBrowser()) {
      const proceed = window.confirm(
        "이 서비스는 Google Chrome에 최적화되어 있습니다. 예배 송출은 Chrome에서 진행하는 것을 권장합니다.\n\n계속 진행하시겠습니까?",
      );
      if (!proceed) {
        return;
      }
    }
    navigate("/present/fullscreen");
  };

  const handleOpenEditor = (songIndex?: number): void => {
    if (songIndex !== undefined) {
      navigate(`/editor?song=${songIndex}`);
    } else {
      navigate("/editor");
    }
  };

  const handleCreateNewPresentation = (): void => {
    createNewSetlist("새 주일 예배 프레젠테이션");
    navigate("/editor");
  };

  const handleResetDefaultSet = (): void => {
    resetActiveSetlist();
  };

  const handleAddToSet = (newDeck: Deck): void => {
    addDeckToSetlist(newDeck);
    setIsQuickPasteOpen(false);
  };

  // 검색 및 탭 필터링 & 정렬
  const filteredAndSortedItems = useMemo(() => {
    const filtered = setlist.items.filter((item) => {
      const titleMatch = (item.deck?.title ?? "")
        .toLowerCase()
        .includes(searchQuery.toLowerCase());
      const artistMatch = (item.deck?.artist ?? "")
        .toLowerCase()
        .includes(searchQuery.toLowerCase());
      const lyricsMatch = (item.deck?.lyricsRaw ?? "")
        .toLowerCase()
        .includes(searchQuery.toLowerCase());
      return titleMatch || artistMatch || lyricsMatch;
    });

    if (sortBy === "title") {
      filtered.sort((a, b) =>
        (a.deck?.title ?? "").localeCompare(b.deck?.title ?? "", "ko"),
      );
    } else if (sortBy === "slides") {
      filtered.sort(
        (a, b) => (b.deck?.slides.length ?? 0) - (a.deck?.slides.length ?? 0),
      );
    }

    return filtered;
  }, [setlist.items, searchQuery, sortBy]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex select-none">
      {/* 1. Canva / MiriCanvas 스타일 좌측 내비게이션 사이드바 (Sidebar) */}
      <aside className="w-60 bg-zinc-950 border-r border-zinc-800/80 hidden lg:flex flex-col justify-between p-4 shrink-0">
        <div className="space-y-6">
          {/* 브랜드 로고 */}
          <div className="flex items-center gap-3 px-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center text-white shadow-lg shadow-emerald-950/50">
              <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z" />
              </svg>
            </div>
            <div>
              <span className="text-sm font-bold tracking-tight text-white flex items-center gap-1.5">
                Worship Studio
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 font-mono">
                  M1 Ready
                </span>
              </span>
              <p className="text-[10px] text-zinc-500">
                16:9 프레젠테이션 대시보드
              </p>
            </div>
          </div>

          {/* 새 디자인 만들기 버튼 */}
          <button
            type="button"
            data-testid="sidebar-create-presentation-btn"
            onClick={handleCreateNewPresentation}
            className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs shadow-lg shadow-emerald-950/50 flex items-center justify-center gap-2 cursor-pointer transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>새 프레젠테이션</span>
          </button>

          {/* 메뉴 아이템 */}
          <nav className="space-y-1">
            <button
              type="button"
              onClick={() => setActiveTab("all")}
              className={`w-full px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-3 transition-colors cursor-pointer ${
                activeTab === "all"
                  ? "bg-zinc-800 text-white font-semibold"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60"
              }`}
            >
              <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              <span>홈 (대시보드)</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("setlists")}
              className={`w-full px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-3 transition-colors cursor-pointer ${
                activeTab === "setlists"
                  ? "bg-zinc-800 text-white font-semibold"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60"
              }`}
            >
              <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              <span>내 콘티 보관함</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("songs")}
              className={`w-full px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-3 transition-colors cursor-pointer ${
                activeTab === "songs"
                  ? "bg-zinc-800 text-white font-semibold"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60"
              }`}
            >
              <svg className="w-4 h-4 text-pink-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              </svg>
              <span>찬양 곡 라이브러리</span>
            </button>

            <button
              type="button"
              onClick={() => handleOpenEditor()}
              className="w-full px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-3 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60 transition-colors cursor-pointer"
            >
              <svg className="w-4 h-4 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <span>모션 배경 루프 (10종)</span>
            </button>
          </nav>
        </div>

        {/* 사이드바 하단 오프라인 상태 카드 */}
        <div className="p-3 rounded-xl bg-zinc-900/70 border border-zinc-800/80 text-[11px] space-y-1.5">
          <div className="flex items-center gap-1.5 text-emerald-400 font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>Zero-Network Ready</span>
          </div>
          <p className="text-zinc-500 text-[10px] leading-tight">
            PWA 캐시 &amp; IndexedDB 연동으로 주일 예배 중 네트워크 단절 시에도 무중단 송출됩니다.
          </p>
        </div>
      </aside>

      {/* 2. 메인 컨텐츠 영역 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Chrome 최적화 권장 알림 배너 */}
        <ChromeAlertBanner />

        {/* Canva / MiriCanvas 스타일 상단 글로벌 네비게이션 헤더 */}
        <header className="sticky top-0 z-40 bg-zinc-950/90 backdrop-blur-md border-b border-zinc-800/80 px-6 py-3.5 flex items-center justify-between gap-4">
          {/* 브랜드 로고 */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center text-white shadow-lg shadow-emerald-950/50 lg:hidden">
              <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z" />
              </svg>
            </div>
            <div>
              <span className="text-base font-bold tracking-tight text-white flex items-center gap-1.5">
                Worship Slide
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 font-mono">
                  M1 Ready
                </span>
              </span>
              <p className="text-[11px] text-zinc-400 hidden sm:block">
                교회 예배팀을 위한 웹 슬라이드 & 프레젠테이션 스튜디오
              </p>
            </div>
          </div>

          {/* 중앙 검색 바 */}
          <div className="flex-1 max-w-md mx-4 hidden md:block">
            <div className="relative">
              <svg
                className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="프레젠테이션, 곡 제목, 가사 검색..."
                className="w-full bg-zinc-900 border border-zinc-800 focus:border-emerald-500 rounded-full pl-9 pr-4 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none transition-colors"
              />
            </div>
          </div>

          {/* 우측 상단 액션 버튼 */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              data-testid="open-quick-paste-btn"
              onClick={() => setIsQuickPasteOpen(true)}
              className="px-3.5 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 text-xs font-semibold text-zinc-200 hover:text-white transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
            >
              <svg
                className="w-3.5 h-3.5 text-indigo-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <span>가사 빠른 입력</span>
            </button>

            <button
              type="button"
              data-testid="create-presentation-btn"
              onClick={handleCreateNewPresentation}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white transition-all shadow-md shadow-emerald-950/50 hover:shadow-emerald-900/60 flex items-center gap-1.5 cursor-pointer"
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
                  d="M12 4v16m8-8H4"
                />
              </svg>
              <span>새 프레젠테이션</span>
            </button>
          </div>
        </header>

        {/* 본문 컨텐츠 영역 */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8 flex flex-col gap-10">
          {/* Canva 스타일 퀵 스타트 추천 배너 / 쉘프 */}
          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
              <span>추천 및 빠른 시작</span>
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* 카드 1: M1 송출 시작하기 */}
              <div className="bg-gradient-to-br from-zinc-900 via-zinc-900 to-emerald-950/40 border border-zinc-800/90 hover:border-emerald-500/50 transition-all rounded-2xl p-5 flex flex-col justify-between shadow-xl">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="w-9 h-9 rounded-lg bg-emerald-900/50 border border-emerald-700/50 flex items-center justify-center text-emerald-400">
                      <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </div>
                    <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800/60">
                      Zero-Network Ready
                    </span>
                  </div>

                  <div>
                    <h3 className="text-lg font-bold text-white">
                      M1 송출 시작하기 (5곡 세트)
                    </h3>
                    <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                      검증용 5곡 세트리스트(은혜로다, 주 품에, 시선, 꽃들도, 주의
                      이름 높이며)를 전체화면 슬라이드쇼로 즉시 송출합니다.
                    </p>
                  </div>

                  {/* 단축키 힌트 배지 */}
                  <div className="bg-black/50 rounded-lg p-2 text-[11px] text-zinc-400 flex flex-wrap items-center justify-between gap-2 font-mono border border-zinc-800/80">
                    <span>Space/화살표: 넘김</span>
                    <span>B: 암전</span>
                    <span>H: 숨김</span>
                    <span>N.M: 점프</span>
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-2">
                  <button
                    type="button"
                    data-testid="start-present-btn"
                    onClick={handleStartPresentation}
                    className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/60 cursor-pointer"
                  >
                    <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                    <span>송출 시작하기</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenEditor()}
                    className="py-2.5 px-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white text-xs font-medium rounded-lg border border-zinc-700 transition-colors flex items-center gap-1.5 cursor-pointer"
                    title="세트 편집기 열기"
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
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                      />
                    </svg>
                    <span>편집</span>
                  </button>
                </div>
              </div>

              {/* 카드 2: 가사 빠른 입력 템플릿 */}
              <div className="bg-gradient-to-br from-zinc-900 via-zinc-900 to-indigo-950/30 border border-zinc-800/90 hover:border-indigo-500/50 transition-all rounded-2xl p-5 flex flex-col justify-between shadow-xl">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="w-9 h-9 rounded-lg bg-indigo-900/50 border border-indigo-700/50 flex items-center justify-center text-indigo-400">
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                        />
                      </svg>
                    </div>
                    <span className="text-[11px] font-mono text-indigo-300 bg-indigo-950/80 px-2 py-0.5 rounded border border-indigo-800/60">
                      Auto 16:9 Split
                    </span>
                  </div>

                  <div>
                    <h3 className="text-lg font-bold text-white">
                      가사 빠른 입력 & 자동 분할
                    </h3>
                    <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                      복사한 가사를 붙여넣으면 빈 줄 기준 슬라이드 자동 분할과
                      멜론/벅스 검색 링크를 통해 손쉽게 새 프레젠테이션을
                      완성합니다.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[11px]">
                      빈 줄 분할
                    </span>
                    <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[11px]">
                      4줄 초과 자동 정제
                    </span>
                    <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[11px]">
                      멜론/벅스 검색
                    </span>
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsQuickPasteOpen(true)}
                    className="flex-1 py-2.5 px-4 bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer border border-zinc-700/80"
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
                        d="M12 4v16m8-8H4"
                      />
                    </svg>
                    <span>가사 입력 열기</span>
                  </button>
                  <button
                    type="button"
                    data-testid="create-blank-set-btn"
                    onClick={handleCreateNewPresentation}
                    className="py-2.5 px-3 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white text-xs font-medium rounded-lg border border-zinc-800 transition-colors cursor-pointer"
                    title="새 빈 콘티 생성"
                  >
                    빈 콘티
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* 4. Canva / MiriCanvas 시그니처: 16:9 프레젠테이션 리스트 섹션 */}
          <section className="space-y-4">
            {/* 섹션 상단 필터 & 뷰 모드 툴바 */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-zinc-800/80">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2.5">
                  <span>{setlist.title}</span>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 font-normal">
                    {setlist.items.length}곡 준비 완료
                  </span>
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  예배 일자: {setlist.serviceDate} · 16:9 와이드스크린 슬라이드 덱
                </p>
              </div>

              {/* 필터 탭 & 정렬 & 뷰 스위처 & 기본 세트 복원 */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-testid="restore-default-set-btn"
                  onClick={handleResetDefaultSet}
                  className="hidden lg:inline-flex px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 text-xs font-medium cursor-pointer transition-colors"
                  title="기본 5곡 검증 세트로 복원"
                >
                  기본 5곡 복원
                </button>

                {/* 정렬 드롭다운 */}
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                  className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-emerald-500 cursor-pointer"
                  title="정렬 기준"
                >
                  <option value="recent">최근 순서</option>
                  <option value="title">가나다순</option>
                  <option value="slides">슬라이드 많은 순</option>
                </select>

                <div className="flex items-center bg-zinc-900 p-1 rounded-lg border border-zinc-800 text-xs">
                  <button
                    type="button"
                    onClick={() => setActiveTab("all")}
                    className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
                      activeTab === "all"
                        ? "bg-zinc-800 text-white font-semibold shadow"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    전체
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("setlists")}
                    className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
                      activeTab === "setlists"
                        ? "bg-zinc-800 text-white font-semibold shadow"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    콘티 세트
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("songs")}
                    className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
                      activeTab === "songs"
                        ? "bg-zinc-800 text-white font-semibold shadow"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    찬양 곡
                  </button>
                </div>

                {/* 그리드/리스트 뷰 전환 */}
                <div className="flex items-center bg-zinc-900 p-1 rounded-lg border border-zinc-800 text-zinc-400">
                  <button
                    type="button"
                    onClick={() => setViewMode("grid")}
                    className={`p-1.5 rounded transition-colors cursor-pointer ${
                      viewMode === "grid"
                        ? "bg-zinc-800 text-white"
                        : "hover:text-zinc-200"
                    }`}
                    title="그리드 뷰 (16:9 슬라이드 카드)"
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
                        d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
                      />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("list")}
                    className={`p-1.5 rounded transition-colors cursor-pointer ${
                      viewMode === "list"
                        ? "bg-zinc-800 text-white"
                        : "hover:text-zinc-200"
                    }`}
                    title="목록 뷰 (16:9 미니 프리뷰)"
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
                        d="M4 6h16M4 12h16M4 18h16"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            {/* 검색 결과 없음 빈 상태 */}
            {filteredAndSortedItems.length === 0 && searchQuery && (
              <div className="py-16 text-center flex flex-col items-center justify-center gap-3 bg-zinc-900/30 border border-zinc-800/80 rounded-2xl">
                <div className="w-12 h-12 rounded-xl bg-zinc-800/80 flex items-center justify-center text-zinc-500">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <p className="text-sm font-semibold text-zinc-300">
                  "{searchQuery}"에 일치하는 찬양 곡이 없습니다.
                </p>
                <button
                  type="button"
                  data-testid="clear-search-btn"
                  onClick={() => setSearchQuery("")}
                  className="px-3.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-emerald-400 border border-zinc-700 cursor-pointer transition-colors"
                >
                  검색어 지우기
                </button>
              </div>
            )}

            {/* 5. 프레젠테이션 그리드 뷰 (16:9 슬라이드 카드 렌더링) */}
            {viewMode === "grid" ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* 대표 세트리스트 카드 (activeTab이 'songs'가 아닐 때) */}
                {activeTab !== "songs" && (
                  <PresentationCard
                    setlist={setlist}
                    onPresent={handleStartPresentation}
                    onEdit={() => handleOpenEditor()}
                    onDuplicate={() => duplicateSongInSetlist(0)}
                    className="border-emerald-500/40 bg-zinc-900/90"
                  />
                )}

                {/* 개별 곡 16:9 슬라이드 카드들 */}
                {activeTab !== "setlists" &&
                  filteredAndSortedItems.map((item, index) => {
                    const deck = item.deck;
                    if (!deck) return null;

                    return (
                      <PresentationCard
                        key={item.id}
                        deck={deck}
                        onPresent={handleStartPresentation}
                        onEdit={() => handleOpenEditor(index)}
                        onDuplicate={() => duplicateSongInSetlist(index)}
                        onDelete={() => removeSongFromSetlist(index)}
                      />
                    );
                  })}

                {/* 새 슬라이드 추가 점선 카드 */}
                <div
                  onClick={() => setIsQuickPasteOpen(true)}
                  className="group border-2 border-dashed border-zinc-800 hover:border-emerald-500/60 rounded-xl flex flex-col items-center justify-center p-8 min-h-[260px] cursor-pointer transition-all bg-zinc-950/40 hover:bg-zinc-900/30"
                >
                  <div className="w-12 h-12 rounded-full bg-zinc-900 group-hover:bg-emerald-950/60 border border-zinc-700/80 group-hover:border-emerald-500/50 flex items-center justify-center text-zinc-400 group-hover:text-emerald-400 transition-colors mb-3">
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
                  <span className="text-sm font-semibold text-zinc-300 group-hover:text-white transition-colors">
                    새 찬양 슬라이드 추가
                  </span>
                  <span className="text-xs text-zinc-500 mt-1">
                    가사 복사 & 붙여넣기
                  </span>
                </div>
              </div>
            ) : (
              /* 6. 목록 뷰 (16:9 미니 프리뷰 썸네일 탑재) */
              <div className="bg-zinc-900/50 border border-zinc-800/80 rounded-xl overflow-hidden divide-y divide-zinc-800/60">
                {filteredAndSortedItems.map((item, index) => {
                  const deck = item.deck;
                  const leadSlide = deck?.slides[0] ?? null;
                  const bgId = deck?.backgroundId;
                  const bgUrl = getBackgroundMediaUrl(bgId);
                  const poster = getBackgroundPosterUrl(bgId);

                  return (
                    <div
                      key={item.id}
                      className="p-3.5 flex items-center justify-between gap-4 hover:bg-zinc-900/80 transition-colors group"
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        <span className="w-6 h-6 rounded-lg bg-zinc-800 text-zinc-400 flex items-center justify-center text-xs font-mono font-bold shrink-0">
                          {index + 1}
                        </span>

                        {/* 16:9 미니 슬라이드쇼 프리뷰 썸네일 */}
                        <div
                          onClick={() => handleOpenEditor(index)}
                          className="w-24 aspect-video bg-black rounded-lg overflow-hidden relative shrink-0 border border-zinc-800 group-hover:border-emerald-500/50 cursor-pointer shadow"
                        >
                          <div className="w-full h-full pointer-events-none">
                            <SlideStage
                              slide={leadSlide}
                              style={deck?.style}
                              backgroundUrl={bgUrl}
                              posterUrl={poster}
                              containerDimensions={{ width: 96, height: 54 }}
                            />
                          </div>
                          <div className="absolute top-0.5 right-0.5 px-1 py-0.2 rounded bg-black/80 text-[9px] font-mono text-emerald-400">
                            16:9
                          </div>
                        </div>

                        <div className="min-w-0">
                          <div
                            onClick={() => handleOpenEditor(index)}
                            className="text-sm font-semibold text-white hover:text-emerald-400 transition-colors truncate cursor-pointer"
                          >
                            {deck?.title ?? "제목 없음"}
                          </div>
                          <div className="text-xs text-zinc-400 truncate flex items-center gap-2">
                            <span>{deck?.artist || "찬양 곡"}</span>
                            <span className="text-zinc-600">·</span>
                            <span className="font-mono text-zinc-500">
                              {deck?.slides.length ?? 0} 슬라이드
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => duplicateSongInSetlist(index)}
                          className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-300 hover:text-white transition-colors cursor-pointer"
                          title="곡 복제"
                        >
                          복제
                        </button>

                        <button
                          type="button"
                          onClick={() => handleOpenEditor(index)}
                          className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 hover:text-white transition-colors cursor-pointer"
                        >
                          편집
                        </button>

                        <button
                          type="button"
                          onClick={handleStartPresentation}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
                        >
                          <svg className="w-3 h-3 fill-current" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                          <span>발표</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </main>
      </div>

      {/* 가사 빠른 입력 모달 */}
      <QuickLyricPasteModal
        isOpen={isQuickPasteOpen}
        onClose={() => setIsQuickPasteOpen(false)}
        onAddToSet={handleAddToSet}
      />
    </div>
  );
}

export default HomeRoute;
