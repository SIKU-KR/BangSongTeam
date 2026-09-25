import React from "react";

export interface ExternalSearchLinksProps {
  /** 곡 제목 */
  title: string;
  className?: string;
}

/** 멜론 통합 검색 URL 생성. */
export function getMelonSearchUrl(title: string): string {
  return `https://www.melon.com/search/total/index.htm?q=${encodeURIComponent(title.trim())}`;
}

/** 벅스 통합 검색 URL 생성. */
export function getBugsSearchUrl(title: string): string {
  return `https://music.bugs.co.kr/search/integrated?q=${encodeURIComponent(title.trim())}`;
}

/**
 * 곡 제목을 기반으로 멜론/벅스 가사 검색 결과 페이지를 새 탭으로 여는 링크 컴포넌트.
 */
export function ExternalSearchLinks({
  title,
  className = "",
}: ExternalSearchLinksProps): React.JSX.Element {
  const trimmed = title.trim();
  const hasQuery = trimmed.length > 0;

  const melonUrl = hasQuery ? getMelonSearchUrl(trimmed) : undefined;
  const bugsUrl = hasQuery ? getBugsSearchUrl(trimmed) : undefined;

  return (
    <div className={`flex items-center gap-2 text-xs ${className}`}>
      <span className="font-medium text-zinc-500 dark:text-zinc-400">
        가사 검색:
      </span>

      <a
        role="link"
        href={hasQuery ? melonUrl : undefined}
        target="_blank"
        rel="noopener noreferrer"
        aria-disabled={!hasQuery}
        onClick={(e) => {
          if (!hasQuery) e.preventDefault();
        }}
        className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-all ${
          hasQuery
            ? "cursor-pointer border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-100 dark:border-emerald-700/60 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:border-emerald-600 dark:hover:bg-emerald-900/50"
            : "pointer-events-none cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-600"
        }`}
        title={
          hasQuery ? `멜론에서 '${trimmed}' 검색` : "곡 제목을 먼저 입력하세요"
        }
      >
        <span className="size-1.5 rounded-full bg-emerald-500" />
        멜론에서 찾기
        <span className="text-[10px] opacity-70">↗</span>
      </a>

      <a
        role="link"
        href={hasQuery ? bugsUrl : undefined}
        target="_blank"
        rel="noopener noreferrer"
        aria-disabled={!hasQuery}
        onClick={(e) => {
          if (!hasQuery) e.preventDefault();
        }}
        className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-all ${
          hasQuery
            ? "cursor-pointer border-orange-200 bg-orange-50 text-orange-700 hover:border-orange-300 hover:bg-orange-100 dark:border-orange-700/60 dark:bg-orange-950/40 dark:text-orange-300 dark:hover:border-orange-600 dark:hover:bg-orange-900/50"
            : "pointer-events-none cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-600"
        }`}
        title={
          hasQuery ? `벅스에서 '${trimmed}' 검색` : "곡 제목을 먼저 입력하세요"
        }
      >
        <span className="size-1.5 rounded-full bg-orange-500" />
        벅스에서 찾기
        <span className="text-[10px] opacity-70">↗</span>
      </a>
    </div>
  );
}
