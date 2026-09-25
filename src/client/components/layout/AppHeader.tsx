import React, { useEffect, useRef } from "react";
import { isTypingTarget } from "../../features/drive";

export interface AppHeaderProps {
  /** 페이지 제목. `titleSlot`이 있으면 화면 읽기 프로그램용 제목으로만 쓴다 */
  title: string;
  searchPlaceholder: string;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  /** 제목 대신 넣을 내용 (드라이브의 경로) */
  titleSlot?: React.ReactNode;
  /** 제목 줄 오른쪽 */
  actions?: React.ReactNode;
}

/**
 * 구글 드라이브식 셸 헤더: 검색 막대와 페이지 제목 줄.
 *
 * `/`를 누르면 어디서든 검색창으로 간다 (입력 중일 때는 제외).
 */
export function AppHeader({
  title,
  searchPlaceholder,
  searchQuery,
  onSearchQueryChange,
  titleSlot,
  actions,
}: AppHeaderProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent): void => {
      if (
        event.key !== "/" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isTypingTarget(event.target)
      ) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  return (
    <header className="shrink-0 bg-zinc-50 dark:bg-zinc-950">
      <div className="h-16 px-4 sm:px-6 flex items-center">
        <div className="w-full max-w-3xl h-12 rounded-full bg-zinc-200/70 dark:bg-zinc-800/70 focus-within:bg-white dark:focus-within:bg-zinc-900 focus-within:shadow-md dark:focus-within:ring-1 dark:focus-within:ring-zinc-700 flex items-center gap-2 px-2 transition-all">
          <span className="p-2 text-zinc-500 dark:text-zinc-400">
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </span>
          <input
            ref={inputRef}
            type="search"
            aria-label="검색"
            data-testid="shell-search-input"
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              if (searchQuery) onSearchQueryChange("");
              else e.currentTarget.blur();
            }}
            placeholder={searchPlaceholder}
            className="flex-1 min-w-0 bg-transparent text-base text-zinc-900 dark:text-zinc-100 placeholder-zinc-500 dark:placeholder-zinc-400 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {searchQuery && (
            <button
              type="button"
              aria-label="검색어 지우기"
              title="검색어 지우기"
              onClick={() => {
                onSearchQueryChange("");
                inputRef.current?.focus();
              }}
              className="p-2 rounded-full hover:bg-zinc-300/60 dark:hover:bg-zinc-700/60 text-zinc-500 hover:text-zinc-800 dark:hover:text-white cursor-pointer"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
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

      <div className="h-14 px-4 sm:px-6 flex items-center justify-between gap-4">
        {titleSlot ? (
          <div className="min-w-0 flex-1">
            <h1 className="sr-only">{title}</h1>
            {titleSlot}
          </div>
        ) : (
          <h1 className="min-w-0 flex-1 px-2 text-2xl text-zinc-900 dark:text-white truncate">
            {title}
          </h1>
        )}
        {actions && (
          <div className="flex items-center gap-2 shrink-0">{actions}</div>
        )}
      </div>
    </header>
  );
}
