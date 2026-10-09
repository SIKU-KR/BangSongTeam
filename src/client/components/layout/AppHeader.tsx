import React, { useEffect, useRef } from "react";
import { SearchIcon, XIcon } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "#components/ui/input-group";
import { SidebarTrigger } from "#components/ui/sidebar";
import { isTypingTarget } from "../../lib/browser/keyboardTarget";
import { ThemeMenuButton } from "../common/ThemeMenuButton";
import { useRotatingPlaceholder } from "#hooks/useRotatingPlaceholder";
import { COMMON_COPY } from "#copy/common";

interface AppHeaderProps {
  /** 페이지 제목. `titleSlot`이 있으면 화면 읽기 프로그램용 제목으로만 쓴다 */
  title: string;
  /** 여러 개면 검색창이 비어 있는 동안 돌려 가며 보여 준다 */
  searchPlaceholder: string | readonly string[];
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  /** 있으면 Enter나 '검색' 버튼으로 제출할 때만 검색한다 (배경 벡터 검색) */
  onSearchSubmit?: () => void;
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
  onSearchSubmit,
  titleSlot,
  actions,
}: AppHeaderProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const placeholder = useRotatingPlaceholder(
    searchPlaceholder,
    searchQuery !== "",
  );

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
        <form
          role="search"
          className="w-full max-w-3xl"
          onSubmit={(e) => {
            e.preventDefault();
            onSearchSubmit?.();
          }}
        >
          <InputGroup className="h-10">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              ref={inputRef}
              type="search"
              aria-label={COMMON_COPY.search}
              data-testid="shell-search-input"
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Escape") return;
                if (searchQuery) onSearchQueryChange("");
                else e.currentTarget.blur();
              }}
              placeholder={placeholder}
            />
            {(searchQuery || onSearchSubmit) && (
              <InputGroupAddon align="inline-end">
                {searchQuery && (
                  <InputGroupButton
                    size="icon-xs"
                    aria-label={COMMON_COPY.clearSearch}
                    onClick={() => {
                      onSearchQueryChange("");
                      inputRef.current?.focus();
                    }}
                  >
                    <XIcon />
                  </InputGroupButton>
                )}
                {onSearchSubmit && (
                  <InputGroupButton
                    type="submit"
                    variant="secondary"
                    disabled={searchQuery.trim() === ""}
                  >
                    {COMMON_COPY.search}
                  </InputGroupButton>
                )}
              </InputGroupAddon>
            )}
          </InputGroup>
        </form>
        <div className="ml-auto">
          <ThemeMenuButton />
        </div>
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
