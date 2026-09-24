import React, { useState } from "react";
import type { SortOrder, ViewMode } from "../../routes/appShellContext";

export interface AppHeroHeaderProps {
  title: string;
  searchPlaceholder: string;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  sortOrder: SortOrder;
  onSortOrderChange: (order: SortOrder) => void;
  itemCountLabel: string;
  onQuickAdd: () => void;
  toolbarStart?: React.ReactNode;
  quickAddSlot?: React.ReactNode;
  /** 필터·정렬·보기·빠른 추가. 드라이브 전용이라 다른 화면에서는 숨긴다 */
  showControls?: boolean;
}

type DropdownName = "type" | "category" | "owner" | "sort";

/** 검색, 필터 및 뷰 모드 전환을 제공하는 히어로 헤더와 툴바 */
export function AppHeroHeader({
  title,
  searchPlaceholder,
  searchQuery,
  onSearchQueryChange,
  viewMode,
  onViewModeChange,
  sortOrder,
  onSortOrderChange,
  itemCountLabel,
  onQuickAdd,
  toolbarStart,
  quickAddSlot,
  showControls = true,
}: AppHeroHeaderProps): React.JSX.Element {
  const [typeFilter, setTypeFilter] = useState<string>("전체");
  const [categoryFilter, setCategoryFilter] = useState<string>("전체");
  const [ownerFilter, setOwnerFilter] = useState<string>("전체");
  const [openDropdown, setOpenDropdown] = useState<DropdownName | null>(null);

  const toggleDropdown = (name: DropdownName): void => {
    setOpenDropdown((prev) => (prev === name ? null : name));
  };

  return (
    <>
      <header className="relative bg-gradient-to-b from-indigo-50/60 via-zinc-50/40 to-zinc-50 dark:from-indigo-950/20 dark:via-zinc-950/40 dark:to-zinc-950 pt-10 pb-8 px-6 sm:px-10 border-b border-zinc-200 dark:border-zinc-900/80">
        <div className="max-w-4xl mx-auto flex flex-col items-center text-center space-y-6">
          <h1 className="text-3xl sm:text-4xl font-extrabold text-zinc-900 dark:text-white tracking-tight">
            {title}
          </h1>

          <div className="w-full max-w-2xl relative">
            <div className="w-full rounded-2xl sm:rounded-full bg-white dark:bg-zinc-900/90 border border-zinc-200 dark:border-zinc-700/80 hover:border-zinc-300 dark:hover:border-zinc-600 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/20 shadow-sm hover:shadow focus-within:shadow-md px-4 py-3 sm:py-3.5 flex items-center gap-3 transition-all">
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
                onChange={(e) => onSearchQueryChange(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full bg-transparent text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => onSearchQueryChange("")}
                  className="p-1 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-700 dark:hover:text-white cursor-pointer"
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
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {showControls && (
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1 relative">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => toggleDropdown("type")}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-medium border flex items-center gap-1.5 transition-all cursor-pointer ${
                    typeFilter !== "전체"
                      ? "bg-emerald-50 dark:bg-zinc-800 border-emerald-500 text-emerald-700 dark:text-emerald-400 font-semibold"
                      : "bg-white dark:bg-zinc-900/80 border-zinc-300 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-700 text-zinc-700 dark:text-zinc-300"
                  }`}
                >
                  <span>유형: {typeFilter}</span>
                  <svg
                    className="w-3.5 h-3.5 text-zinc-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>
                {openDropdown === "type" && (
                  <div className="absolute top-full left-0 mt-2 w-36 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-lg dark:shadow-2xl z-50 py-1.5">
                    {["전체", "프레젠테이션", "단일 곡", "배경 루프"].map(
                      (opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => {
                            setTypeFilter(opt);
                            setOpenDropdown(null);
                          }}
                          className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white"
                        >
                          {opt}
                        </button>
                      ),
                    )}
                  </div>
                )}
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => toggleDropdown("category")}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-medium border flex items-center gap-1.5 transition-all cursor-pointer ${
                    categoryFilter !== "전체"
                      ? "bg-indigo-50 dark:bg-zinc-800 border-indigo-500 text-indigo-700 dark:text-indigo-300 font-semibold"
                      : "bg-white dark:bg-zinc-900/80 border-zinc-300 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-700 text-zinc-700 dark:text-zinc-300"
                  }`}
                >
                  <span>카테고리: {categoryFilter}</span>
                  <svg
                    className="w-3.5 h-3.5 text-zinc-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>
                {openDropdown === "category" && (
                  <div className="absolute top-full left-0 mt-2 w-36 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-lg dark:shadow-2xl z-50 py-1.5">
                    {["전체", "잔잔한", "밝은", "웅장한", "따뜻한"].map(
                      (opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => {
                            setCategoryFilter(opt);
                            setOpenDropdown(null);
                          }}
                          className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white"
                        >
                          {opt}
                        </button>
                      ),
                    )}
                  </div>
                )}
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => toggleDropdown("owner")}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-medium border flex items-center gap-1.5 transition-all cursor-pointer ${
                    ownerFilter !== "전체"
                      ? "bg-teal-50 dark:bg-zinc-800 border-teal-500 text-teal-700 dark:text-teal-300 font-semibold"
                      : "bg-white dark:bg-zinc-900/80 border-zinc-300 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-700 text-zinc-700 dark:text-zinc-300"
                  }`}
                >
                  <span>소유자: {ownerFilter}</span>
                  <svg
                    className="w-3.5 h-3.5 text-zinc-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>
                {openDropdown === "owner" && (
                  <div className="absolute top-full left-0 mt-2 w-36 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-lg dark:shadow-2xl z-50 py-1.5">
                    {["전체", "내가 만든 항목", "공유된 항목"].map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => {
                          setOwnerFilter(opt);
                          setOpenDropdown(null);
                        }}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white"
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => toggleDropdown("sort")}
                  className="px-3.5 py-1.5 rounded-full text-xs font-medium border bg-white dark:bg-zinc-900/80 border-zinc-300 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-700 text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  <span>
                    정렬:{" "}
                    {sortOrder === "recent"
                      ? "수정된 날짜"
                      : sortOrder === "name"
                        ? "이름순"
                        : "슬라이드 수"}
                  </span>
                  <svg
                    className="w-3.5 h-3.5 text-zinc-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>
                {openDropdown === "sort" && (
                  <div className="absolute top-full left-0 mt-2 w-36 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-lg dark:shadow-2xl z-50 py-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        onSortOrderChange("recent");
                        setOpenDropdown(null);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white"
                    >
                      수정된 날짜순
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onSortOrderChange("name");
                        setOpenDropdown(null);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white"
                    >
                      이름순
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onSortOrderChange("slides");
                        setOpenDropdown(null);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white"
                    >
                      슬라이드 많은순
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </header>

      {showControls && (
        <div className="max-w-7xl w-full mx-auto px-6 sm:px-8 pt-6 pb-2 flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            {toolbarStart ?? (
              <div className="text-xs text-zinc-500">{itemCountLabel}</div>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() =>
                onSortOrderChange(sortOrder === "recent" ? "name" : "recent")
              }
              title="정렬 기준 전환"
              className="p-2 rounded-xl bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white transition-colors cursor-pointer"
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
                  d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"
                />
              </svg>
            </button>

            <div className="flex items-center p-0.5 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => onViewModeChange("grid")}
                title="그리드 뷰"
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                  viewMode === "grid"
                    ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm"
                    : "text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-300"
                }`}
              >
                <svg
                  className="w-4 h-4"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M4 4h7v7H4V4zm9 0h7v7h-7V4zm-9 9h7v7H4v-7zm9 0h7v7h-7v-7z" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => onViewModeChange("list")}
                title="리스트 뷰"
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                  viewMode === "list"
                    ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm"
                    : "text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-300"
                }`}
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

            {quickAddSlot ?? (
              <button
                type="button"
                onClick={onQuickAdd}
                title="새 항목 추가"
                className="w-8 h-8 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center shadow-sm hover:shadow dark:shadow-emerald-950/40 hover:scale-105 active:scale-95 transition-all cursor-pointer"
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
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
