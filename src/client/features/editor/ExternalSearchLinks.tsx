import React from "react";
import { ExternalLinkIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "#components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#components/ui/tooltip";

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

function SearchLink({
  site,
  href,
  query,
}: {
  site: string;
  href: string | undefined;
  query: string;
}): React.JSX.Element {
  const hasQuery = href !== undefined;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="outline"
            size="xs"
            nativeButton={false}
            render={
              <a
                role="link"
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-disabled={!hasQuery}
                onClick={(e) => {
                  if (!hasQuery) e.preventDefault();
                }}
              />
            }
            className={cn(!hasQuery && "cursor-not-allowed opacity-50")}
          />
        }
      >
        {site}에서 찾기
        <ExternalLinkIcon className="opacity-70" />
      </TooltipTrigger>
      <TooltipContent>
        {hasQuery ? `${site}에서 '${query}' 검색` : "곡 제목을 먼저 입력하세요"}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * 곡 제목을 기반으로 멜론/벅스 가사 검색 결과 페이지를 새 탭으로 여는 링크 컴포넌트.
 */
export function ExternalSearchLinks({
  title,
  className,
}: ExternalSearchLinksProps): React.JSX.Element {
  const trimmed = title.trim();
  const hasQuery = trimmed.length > 0;

  return (
    <div className={cn("flex items-center gap-2 text-xs", className)}>
      <span className="font-medium text-muted-foreground">가사 검색:</span>
      <SearchLink
        site="멜론"
        href={hasQuery ? getMelonSearchUrl(trimmed) : undefined}
        query={trimmed}
      />
      <SearchLink
        site="벅스"
        href={hasQuery ? getBugsSearchUrl(trimmed) : undefined}
        query={trimmed}
      />
    </div>
  );
}
