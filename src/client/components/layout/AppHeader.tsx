import React, { useEffect, useRef } from "react";
import { SearchIcon, XIcon } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "#components/ui/input-group";
import { SidebarTrigger } from "#components/ui/sidebar";
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
    <header className="shrink-0 bg-background">
      <div className="flex h-16 items-center gap-2 px-4 sm:px-6">
        <SidebarTrigger />
        <InputGroup className="h-10 max-w-3xl">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
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
          />
          {searchQuery && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                aria-label="검색어 지우기"
                onClick={() => {
                  onSearchQueryChange("");
                  inputRef.current?.focus();
                }}
              >
                <XIcon />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
      </div>

      <div className="flex h-14 items-center justify-between gap-4 px-4 sm:px-6">
        {titleSlot ? (
          <div className="min-w-0 flex-1">
            <h1 className="sr-only">{title}</h1>
            {titleSlot}
          </div>
        ) : (
          <h1 className="min-w-0 flex-1 truncate px-2 text-2xl">{title}</h1>
        )}
        {actions && (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </div>
    </header>
  );
}
