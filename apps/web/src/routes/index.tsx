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
export type ViewMode = "grid" | "list";
export type SortOrder = "recent" | "name" | "slides";

/**
 * Canva Projects (`https://www.canva.com/projects`) 스타일 대시보드
 * - 좌측: Canva 감성의 세련된 사이드바 (기존 메뉴 유지, 캡슐형 활성 탭, PWA 오프라인 상태)
 * - 상단: 은은한 앰비언트 글로우 헤더, 중앙 대형 타이틀, 대형 검색창, 드롭다운 필터 칩
 * - 우측 툴바: 정렬(↑↓), 그리드(::)/리스트(☰) 모드 토글, 원형 빠른 추가(+)
 * - 본문:
 *   1) 홈 ("home"): Canva "최근" 수평 캐러셀 선반 + "폴더" 아코디언 + "모든 프레젠테이션" (그리드/리스트)
 *   2) 곡 라이브러리 ("songs"): 내가 등록한 곡 / 유저가 등록한 곡 2단락 구성
 *   3) 배경 라이브러리 ("backgrounds"): 내가 등록한 배경 / 유저가 등록한 배경 2단락 구성
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

  // Canva 스타일 검색 및 필터 상태
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortOrder, setSortOrder] = useState<SortOrder>("recent");

  // 드롭다운 필터 칩 상태
  const [typeFilter, setTypeFilter] = useState<string>("전체");
  const [categoryFilter, setCategoryFilter] = useState<string>("전체");
  const [ownerFilter, setOwnerFilter] = useState<string>("전체");

  const [openDropdown, setOpenDropdown] = useState<
    "type" | "category" | "owner" | "sort" | null
  >(null);

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

  const toggleDropdown = (name: "type" | "category" | "owner" | "sort"): void => {
    setOpenDropdown((prev) => (prev === name ? null : name));
  };

  // 페이지 타이틀
  const pageTitle =
    activeMenu === "home"
      ? "모든 프로젝트"
      : activeMenu === "songs"
        ? "곡 라이브러리"
        : "배경 라이브러리";

  const searchPlaceholder =
    activeMenu === "home"
      ? "디자인, 폴더, 찬양 가사, 곡을 검색해 보세요"
      : activeMenu === "songs"
        ? "찬양 제목, 가사, 아티스트를 검색해 보세요"
        : "배경 영상, 이미지, 분위기 태그를 검색해 보세요";

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex select-none">
      {/* ───────────────────────────────────────────────────────────
          1. 좌측 내비게이션 사이드바 (Canva Projects Sidebar Style)
          ─────────────────────────────────────────────────────────── */}
      <aside className="w-64 bg-zinc-950 border-r border-zinc-900 hidden lg:flex flex-col justify-between p-4 shrink-0">
        <div className="space-y-6">
          {/* 브랜드 로고 & 워크스페이스 */}
          <div className="flex items-center gap-3 px-2 pt-1">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500 via-teal-400 to-indigo-500 flex items-center justify-center text-white shadow-lg shadow-emerald-950/40">
              <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z" />
              </svg>
            </div>
            <div>
              <span className="text-base font-extrabold tracking-tight text-white flex items-center gap-1.5">
                Worship Studio
              </span>
              <p className="text-[10px] text-zinc-500 font-medium">
                16:9 프레젠테이션 스튜디오
              </p>
            </div>
          </div>

          {/* Canva 스타일 새 디자인 만들기 메인 버튼 */}
          <button
            type="button"
            data-testid="sidebar-create-presentation-btn"
            onClick={handleCreateNewPresentation}
            className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-500 hover:from-emerald-500 hover:to-teal-400 text-white font-bold text-xs shadow-lg shadow-emerald-950/50 flex items-center justify-center gap-2 cursor-pointer transition-all hover:scale-[1.02] active:scale-[0.98]"
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
                strokeWidth={2.5}
                d="M12 4v16m8-8H4"
              />
            </svg>
            <span>새 프레젠테이션</span>
          </button>

          {/* 메인 사이드바 메뉴 (Canva 캡슐형 Pill 활성 인디케이터, 메뉴는 사용자 요청대로 유지) */}
          <div className="space-y-1">
            <nav className="space-y-1">
              {/* 1) 홈 (모든 프로젝트) */}
              <button
                type="button"
                data-testid="sidebar-nav-home"
                onClick={() => handleSelectMenu("home")}
                className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center gap-3 transition-all cursor-pointer ${
                  activeMenu === "home"
                    ? "bg-zinc-800/90 text-white font-semibold shadow-sm border border-zinc-700/60"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60"
                }`}
              >
                <div
                  className={`w-5 h-5 flex items-center justify-center ${
                    activeMenu === "home" ? "text-emerald-400" : "text-zinc-400"
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                </div>
                <span>홈 (모든 프로젝트)</span>
              </button>

              {/* 2) 곡 라이브러리 */}
              <button
                type="button"
                data-testid="sidebar-nav-songs"
                onClick={() => handleSelectMenu("songs")}
                className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center gap-3 transition-all cursor-pointer ${
                  activeMenu === "songs"
                    ? "bg-zinc-800/90 text-white font-semibold shadow-sm border border-zinc-700/60"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60"
                }`}
              >
                <div
                  className={`w-5 h-5 flex items-center justify-center ${
                    activeMenu === "songs" ? "text-pink-400" : "text-zinc-400"
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
                    />
                  </svg>
                </div>
                <span>곡 라이브러리</span>
              </button>

              {/* 3) 배경 라이브러리 */}
              <button
                type="button"
                data-testid="sidebar-nav-backgrounds"
                onClick={() => handleSelectMenu("backgrounds")}
                className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center gap-3 transition-all cursor-pointer ${
                  activeMenu === "backgrounds"
                    ? "bg-zinc-800/90 text-white font-semibold shadow-sm border border-zinc-700/60"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60"
                }`}
              >
                <div
                  className={`w-5 h-5 flex items-center justify-center ${
                    activeMenu === "backgrounds" ? "text-sky-400" : "text-zinc-400"
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                </div>
                <span>배경 라이브러리</span>
              </button>
            </nav>
          </div>
        </div>

        {/* 좌측 하단 사용자 프로필 (Canva 아바타 스타일) */}
        <div className="p-3 rounded-2xl bg-zinc-900/60 border border-zinc-900 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-emerald-700 to-teal-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
            WS
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-zinc-200 truncate">주일 찬양팀</p>
            <p className="text-[10px] text-zinc-500 truncate">로컬 오프라인 모드</p>
          </div>
        </div>
      </aside>

      {/* ───────────────────────────────────────────────────────────
          2. 메인 컨텐츠 영역 (Canva Projects Main Area)
          ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* Chrome 최적화 권장 알림 배너 */}
        <ChromeAlertBanner />

        {/* ── Canva Signature Hero Banner: 앰비언트 글로우, 대형 타이틀, 중앙 검색창, 필터 칩 ── */}
        <header className="relative bg-gradient-to-b from-indigo-950/20 via-zinc-950/40 to-zinc-950 pt-10 pb-8 px-6 sm:px-10 border-b border-zinc-900/80">
          <div className="max-w-4xl mx-auto flex flex-col items-center text-center space-y-6">
            {/* 1) 대형 중앙 볼드 타이틀 */}
            <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
              {pageTitle}
            </h1>

            {/* 2) Canva 스타일 대형 중앙 검색창 (Pill/Rounded-full) */}
            <div className="w-full max-w-2xl relative">
              <div className="w-full rounded-2xl sm:rounded-full bg-zinc-900/90 border border-zinc-700/80 hover:border-zinc-600 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/20 shadow-xl px-4 py-3 sm:py-3.5 flex items-center gap-3 transition-all">
                <svg
                  className="w-5 h-5 text-zinc-400 shrink-0 ml-1"
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
                  placeholder={searchPlaceholder}
                  className="w-full bg-transparent text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="p-1 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-white cursor-pointer"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {/* 3) 검색창 하단 둥근 드롭다운 필터 칩 그룹 (Canva Projects 필터 스타일) */}
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1 relative">
              {/* 필터 1: 유형 ⌵ */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => toggleDropdown("type")}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-medium border flex items-center gap-1.5 transition-all cursor-pointer ${
                    typeFilter !== "전체"
                      ? "bg-zinc-800 border-emerald-500 text-emerald-400 font-semibold"
                      : "bg-zinc-900/80 border-zinc-800 hover:border-zinc-700 text-zinc-300"
                  }`}
                >
                  <span>유형: {typeFilter}</span>
                  <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {openDropdown === "type" && (
                  <div className="absolute top-full left-0 mt-2 w-36 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl z-50 py-1.5">
                    {["전체", "프레젠테이션", "단일 곡", "배경 루프"].map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => {
                          setTypeFilter(opt);
                          setOpenDropdown(null);
                        }}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-800 text-zinc-300 hover:text-white"
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 필터 2: 카테고리 ⌵ */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => toggleDropdown("category")}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-medium border flex items-center gap-1.5 transition-all cursor-pointer ${
                    categoryFilter !== "전체"
                      ? "bg-zinc-800 border-indigo-500 text-indigo-300 font-semibold"
                      : "bg-zinc-900/80 border-zinc-800 hover:border-zinc-700 text-zinc-300"
                  }`}
                >
                  <span>카테고리: {categoryFilter}</span>
                  <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {openDropdown === "category" && (
                  <div className="absolute top-full left-0 mt-2 w-36 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl z-50 py-1.5">
                    {["전체", "잔잔한", "밝은", "웅장한", "따뜻한"].map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => {
                          setCategoryFilter(opt);
                          setOpenDropdown(null);
                        }}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-800 text-zinc-300 hover:text-white"
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 필터 3: 소유자 ⌵ */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => toggleDropdown("owner")}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-medium border flex items-center gap-1.5 transition-all cursor-pointer ${
                    ownerFilter !== "전체"
                      ? "bg-zinc-800 border-teal-500 text-teal-300 font-semibold"
                      : "bg-zinc-900/80 border-zinc-800 hover:border-zinc-700 text-zinc-300"
                  }`}
                >
                  <span>소유자: {ownerFilter}</span>
                  <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {openDropdown === "owner" && (
                  <div className="absolute top-full left-0 mt-2 w-36 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl z-50 py-1.5">
                    {["전체", "내가 만든 항목", "공유된 항목"].map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => {
                          setOwnerFilter(opt);
                          setOpenDropdown(null);
                        }}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-800 text-zinc-300 hover:text-white"
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 필터 4: 수정된 날짜 / 정렬 ⌵ */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => toggleDropdown("sort")}
                  className="px-3.5 py-1.5 rounded-full text-xs font-medium border bg-zinc-900/80 border-zinc-800 hover:border-zinc-700 text-zinc-300 flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  <span>
                    정렬:{" "}
                    {sortOrder === "recent"
                      ? "수정된 날짜"
                      : sortOrder === "name"
                        ? "이름순"
                        : "슬라이드 수"}
                  </span>
                  <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {openDropdown === "sort" && (
                  <div className="absolute top-full left-0 mt-2 w-36 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl z-50 py-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setSortOrder("recent");
                        setOpenDropdown(null);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-800 text-zinc-300 hover:text-white"
                    >
                      수정된 날짜순
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSortOrder("name");
                        setOpenDropdown(null);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-800 text-zinc-300 hover:text-white"
                    >
                      이름순
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSortOrder("slides");
                        setOpenDropdown(null);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-800 text-zinc-300 hover:text-white"
                    >
                      슬라이드 많은순
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* ── Canva 액션 툴바: 우측 상단 정렬(↑↓), 그리드/리스트 뷰 전환(:: / ☰), 빠른 추가(+) ── */}
        <div className="max-w-7xl w-full mx-auto px-6 sm:px-8 pt-6 pb-2 flex items-center justify-between">
          <div className="text-xs text-zinc-500">
            {activeMenu === "home" && `${setlist.items.length}개 찬양 포함됨`}
          </div>

          <div className="flex items-center gap-2">
            {/* 1) 정렬 순서 토글 버튼 (↑↓) */}
            <button
              type="button"
              onClick={() =>
                setSortOrder((prev) => (prev === "recent" ? "name" : "recent"))
              }
              title="정렬 기준 전환"
              className="p-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-white transition-colors cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
              </svg>
            </button>

            {/* 2) 뷰 모드 토글: 그리드 (::) / 리스트 (☰) */}
            <div className="flex items-center p-0.5 rounded-xl bg-zinc-900 border border-zinc-800">
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                title="그리드 뷰"
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                  viewMode === "grid"
                    ? "bg-zinc-800 text-white shadow-sm"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {/* 4칸 그리드 아이콘 (::) */}
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M4 4h7v7H4V4zm9 0h7v7h-7V4zm-9 9h7v7H4v-7zm9 0h7v7h-7v-7z" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setViewMode("list")}
                title="리스트 뷰"
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                  viewMode === "list"
                    ? "bg-zinc-800 text-white shadow-sm"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {/* 리스트 아이콘 (☰) */}
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            </div>

            {/* 3) 원형 빠른 추가 버튼 (+) */}
            <button
              type="button"
              onClick={
                activeMenu === "songs"
                  ? () => setIsQuickPasteOpen(true)
                  : handleCreateNewPresentation
              }
              title="새 항목 추가"
              className="w-8 h-8 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center shadow-md shadow-emerald-950/40 hover:scale-105 active:scale-95 transition-all cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
        </div>

        {/* ── 메인 본문 영역 ── */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-6 sm:px-8 py-6">
          {activeMenu === "home" ? (
            /* 홈: Canva 스타일 "최근" 수평 캐러셀 + "폴더" 아코디언 + "모든 프레젠테이션" */
            <MergedSlidesView
              setlist={setlist}
              onCreateNewPresentation={handleCreateNewPresentation}
              searchQuery={searchQuery}
              viewMode={viewMode}
              sortOrder={sortOrder}
            />
          ) : activeMenu === "songs" ? (
            /* 곡 라이브러리: 내가 등록한 곡 / 유저가 등록한 곡 2단락 */
            <SongLibraryView
              setlist={setlist}
              onOpenQuickPaste={() => setIsQuickPasteOpen(true)}
              onAddDeckToSetlist={handleAddToSet}
              onDuplicateSong={duplicateSongInSetlist}
              onRemoveSong={removeSongFromSetlist}
              searchQuery={searchQuery}
            />
          ) : (
            /* 배경 라이브러리: 내가 등록한 배경 / 유저가 등록한 배경 2단락 */
            <BackgroundLibraryView
              onApplyBackgroundToCurrentSet={handleApplyBackground}
              searchQuery={searchQuery}
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
