import React, { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChromeAlertBanner } from "../components/common/ChromeAlertBanner";
import { QuickLyricPasteModal } from "../features/editor";
import {
  useActiveSetlist,
  addDeckToSetlist,
  removeSongFromSetlist,
  duplicateSongInSetlist,
  createNewSetlist,
  updateSongBackground,
} from "../features/presentation";
import {
  MergedSlidesView,
  SongLibraryView,
  BackgroundLibraryView,
} from "../features/library";
import type { Deck } from "@repo/shared";

export type NavMenu = "home" | "songs" | "backgrounds";

/**
 * 프레젠테이션 대시보드 (메인 화면)
 * - 좌측: 고정 내비게이션 사이드바 (홈, 곡 라이브러리, 배경 라이브러리, PWA 오프라인 상태)
 * - 메인 뷰:
 *   1) 홈 ("home"): 모든 곡이 하나로 이어진 "합쳐진 슬라이드"만 단독 렌더링
 *   2) 곡 라이브러리 ("songs"): 곡 단위 슬라이드 관리 (내가 등록한 곡 / 유저가 등록한 곡 2단락)
 *   3) 배경 라이브러리 ("backgrounds"): 배경 관리 (내가 등록한 배경 / 유저가 등록한 배경 2단락)
 */
export function HomeRoute(): React.JSX.Element {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTabParam = searchParams.get("tab");
  const activeMenu: NavMenu =
    currentTabParam === "songs" || currentTabParam === "backgrounds"
      ? currentTabParam
      : "home";

  const setlist = useActiveSetlist();
  const [isQuickPasteOpen, setIsQuickPasteOpen] = useState<boolean>(false);

  const handleSelectMenu = (menu: NavMenu): void => {
    if (menu === "home") {
      searchParams.delete("tab");
      setSearchParams(searchParams);
    } else {
      setSearchParams({ tab: menu });
    }
  };

  const handleCreateNewPresentation = (): void => {
    createNewSetlist("새 주일 예배 프레젠테이션");
    navigate("/editor");
  };

  const handleAddToSet = (newDeck: Deck): void => {
    addDeckToSetlist(newDeck);
    setIsQuickPasteOpen(false);
  };

  const handleApplyBackground = (bgId: string): void => {
    if (setlist.items.length > 0) {
      updateSongBackground(0, bgId);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex select-none">
      {/* 1. 좌측 내비게이션 사이드바 (Sidebar) */}
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
              <span className="text-sm font-bold tracking-tight text-white">
                Worship Studio
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

          {/* 메인 사이드바 내비게이션 (내 콘티 보관함 제거, 곡/배경 라이브러리 구성) */}
          <nav className="space-y-1.5">
            {/* 1) 홈 (합쳐진 슬라이드) */}
            <button
              type="button"
              data-testid="sidebar-nav-home"
              onClick={() => handleSelectMenu("home")}
              className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center gap-3 transition-colors cursor-pointer ${
                activeMenu === "home"
                  ? "bg-zinc-800 text-white font-semibold shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60"
              }`}
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
                  d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                />
              </svg>
              <span>홈</span>
            </button>

            {/* 2) 곡 라이브러리 */}
            <button
              type="button"
              data-testid="sidebar-nav-songs"
              onClick={() => handleSelectMenu("songs")}
              className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center gap-3 transition-colors cursor-pointer ${
                activeMenu === "songs"
                  ? "bg-zinc-800 text-white font-semibold shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60"
              }`}
            >
              <svg
                className="w-4 h-4 text-pink-400"
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
              <span>곡 라이브러리</span>
            </button>

            {/* 3) 배경 라이브러리 */}
            <button
              type="button"
              data-testid="sidebar-nav-backgrounds"
              onClick={() => handleSelectMenu("backgrounds")}
              className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center gap-3 transition-colors cursor-pointer ${
                activeMenu === "backgrounds"
                  ? "bg-zinc-800 text-white font-semibold shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60"
              }`}
            >
              <svg
                className="w-4 h-4 text-sky-400"
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
              <span>배경 라이브러리</span>
            </button>
          </nav>
        </div>
      </aside>

      {/* 2. 메인 컨텐츠 영역 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Chrome 최적화 권장 알림 배너 */}
        <ChromeAlertBanner />

        {/* 본문 컨텐츠 영역 */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8">
          {activeMenu === "home" ? (
            /* 홈: 프레젠테이션 1개 단위 카드만 단독 렌더링 */
            <MergedSlidesView
              setlist={setlist}
              onCreateNewPresentation={handleCreateNewPresentation}
            />
          ) : activeMenu === "songs" ? (
            /* 곡 라이브러리: 내가 등록한 곡 / 유저가 등록한 곡 2단락 */
            <SongLibraryView
              setlist={setlist}
              onOpenQuickPaste={() => setIsQuickPasteOpen(true)}
              onAddDeckToSetlist={handleAddToSet}
              onDuplicateSong={duplicateSongInSetlist}
              onRemoveSong={removeSongFromSetlist}
            />
          ) : (
            /* 배경 라이브러리: 내가 등록한 배경 / 유저가 등록한 배경 2단락 */
            <BackgroundLibraryView
              onApplyBackgroundToCurrentSet={handleApplyBackground}
            />
          )}
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
