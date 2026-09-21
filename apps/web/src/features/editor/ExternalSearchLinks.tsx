import React from "react";

export interface ExternalSearchLinksProps {
  /** 곡 제목 */
  title: string;
  className?: string;
}

/**
 * 멜론 통합 검색 URL 생성
 */
export function getMelonSearchUrl(title: string): string {
  return `https://www.melon.com/search/total/index.htm?q=${encodeURIComponent(title.trim())}`;
}

/**
 * 벅스 통합 검색 URL 생성
 */
export function getBugsSearchUrl(title: string): string {
  return `https://music.bugs.co.kr/search/integrated?q=${encodeURIComponent(title.trim())}`;
}

/**
 * 곡 제목을 기반으로 멜론/벅스 가사 검색 결과 페이지를 새 탭으로 열어주는 링크 컴포넌트
 * - 저작권 법적 안전성 준수: 서비스가 직접 크롤링하지 않고 사용자가 새 탭에서 확인하도록 유도 (PRD 4.1)
 * - target="_blank" rel="noopener noreferrer" 속성 준수
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
      <span className="text-zinc-400 font-medium">가사 검색:</span>

      {/* Melon Link */}
      <a
        role="link"
        href={hasQuery ? melonUrl : undefined}
        target="_blank"
        rel="noopener noreferrer"
        aria-disabled={!hasQuery}
        onClick={(e) => {
          if (!hasQuery) e.preventDefault();
        }}
        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md border text-xs font-medium transition-all ${
          hasQuery
            ? "border-emerald-700/60 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/50 hover:border-emerald-600 cursor-pointer"
            : "border-zinc-800 bg-zinc-900 text-zinc-600 cursor-not-allowed pointer-events-none"
        }`}
        title={
          hasQuery ? `멜론에서 '${trimmed}' 검색` : "곡 제목을 먼저 입력하세요"
        }
      >
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        멜론에서 찾기
        <span className="text-[10px] opacity-70">↗</span>
      </a>

      {/* Bugs Link */}
      <a
        role="link"
        href={hasQuery ? bugsUrl : undefined}
        target="_blank"
        rel="noopener noreferrer"
        aria-disabled={!hasQuery}
        onClick={(e) => {
          if (!hasQuery) e.preventDefault();
        }}
        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md border text-xs font-medium transition-all ${
          hasQuery
            ? "border-orange-700/60 bg-orange-950/40 text-orange-300 hover:bg-orange-900/50 hover:border-orange-600 cursor-pointer"
            : "border-zinc-800 bg-zinc-900 text-zinc-600 cursor-not-allowed pointer-events-none"
        }`}
        title={
          hasQuery ? `벅스에서 '${trimmed}' 검색` : "곡 제목을 먼저 입력하세요"
        }
      >
        <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
        벅스에서 찾기
        <span className="text-[10px] opacity-70">↗</span>
      </a>
    </div>
  );
}
