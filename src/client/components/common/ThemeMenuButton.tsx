import React, { useState, useRef, useEffect } from "react";
import { useTheme, type ThemeMode } from "../../features/theme";

export interface ThemeMenuButtonProps {
  variant?: "full" | "compact";
  direction?: "up" | "down";
  align?: "left" | "right";
  className?: string;
}

interface ThemeOption {
  mode: ThemeMode;
  label: string;
  description: string;
  icon: (className?: string) => React.JSX.Element;
}

const THEME_OPTIONS: ThemeOption[] = [
  {
    mode: "light",
    label: "라이트 모드",
    description: "밝은 화면 테마",
    icon: (className = "w-4 h-4") => (
      <svg
        className={className}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <circle cx="12" cy="12" r="4" strokeWidth={2} />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41m14.14-14.14l-1.41 1.41"
        />
      </svg>
    ),
  },
  {
    mode: "dark",
    label: "다크 모드",
    description: "어두운 화면 테마",
    icon: (className = "w-4 h-4") => (
      <svg
        className={className}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
        />
      </svg>
    ),
  },
  {
    mode: "system",
    label: "시스템 설정",
    description: "기기 설정에 맞춤",
    icon: (className = "w-4 h-4") => (
      <svg
        className={className}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <rect x="2" y="3" width="20" height="14" rx="2" strokeWidth={2} />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M8 21h8m-4-4v4"
        />
      </svg>
    ),
  },
];

/** 테마 모드 전환 메뉴 버튼 */
export function ThemeMenuButton({
  variant = "full",
  direction = "up",
  align = "left",
  className = "",
}: ThemeMenuButtonProps): React.JSX.Element {
  const { theme, setTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentOption =
    THEME_OPTIONS.find((opt) => opt.mode === theme) ?? THEME_OPTIONS[2];

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const handleSelect = (mode: ThemeMode) => {
    setTheme(mode);
    setIsOpen(false);
  };

  const dropdownPositionClass =
    direction === "up" ? "bottom-full mb-2" : "top-full mt-2";

  return (
    <div ref={containerRef} className={`relative select-none ${className}`}>
      {variant === "compact" ? (
        <button
          type="button"
          data-testid="theme-menu-button"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((prev) => !prev)}
          title={`테마 설정: ${currentOption.label}`}
          className="flex size-10 cursor-pointer items-center justify-center rounded-xl text-zinc-600 transition-colors hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
        >
          {currentOption.icon("w-5 h-5")}
        </button>
      ) : (
        <button
          type="button"
          data-testid="theme-menu-button"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((prev) => !prev)}
          className="flex w-full cursor-pointer items-center justify-between gap-2.5 rounded-xl border border-zinc-200 bg-zinc-100 px-3 py-2.5 text-xs font-medium text-zinc-800 shadow-sm transition-all hover:bg-zinc-200/80 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-200 dark:hover:bg-zinc-900"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-zinc-200 text-emerald-600 dark:bg-zinc-800 dark:text-emerald-400">
              {currentOption.icon("w-3.5 h-3.5")}
            </div>
            <div className="min-w-0 text-left">
              <span className="block truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                {currentOption.label}
              </span>
              <span className="block truncate text-[10px] text-zinc-500">
                화면 모드 전환
              </span>
            </div>
          </div>

          <div className="shrink-0 text-zinc-400 dark:text-zinc-500">
            {direction === "up" ? (
              <svg
                className={`size-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 15l7-7 7 7"
                />
              </svg>
            ) : (
              <svg
                className={`size-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
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
            )}
          </div>
        </button>
      )}

      {isOpen && (
        <div
          role="menu"
          data-testid="theme-menu-dropdown"
          className={`absolute ${dropdownPositionClass} ${align === "right" ? "right-0" : "left-0"} ${
            variant === "compact" ? "w-52" : "w-full"
          } z-50 animate-in rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-xl duration-100 zoom-in-95 fade-in dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-2xl`}
        >
          <div className="mb-1 border-b border-zinc-100 px-2.5 py-1.5 dark:border-zinc-800/80">
            <span className="text-[10px] font-bold tracking-wider text-zinc-500 uppercase dark:text-zinc-500">
              테마 설정
            </span>
          </div>

          <div className="space-y-0.5">
            {THEME_OPTIONS.map((option) => {
              const isSelected = theme === option.mode;
              return (
                <button
                  key={option.mode}
                  type="button"
                  role="menuitem"
                  data-testid={`theme-option-${option.mode}`}
                  onClick={() => handleSelect(option.mode)}
                  className={`flex w-full cursor-pointer items-center justify-between gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs transition-colors ${
                    isSelected
                      ? "bg-emerald-50 font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                      : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800/80"
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div
                      className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${
                        isSelected
                          ? "bg-emerald-500 text-white"
                          : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                      }`}
                    >
                      {option.icon("w-4 h-4")}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-xs">{option.label}</div>
                      <div className="truncate text-[10px] text-zinc-500 dark:text-zinc-500">
                        {option.description}
                      </div>
                    </div>
                  </div>

                  {isSelected && (
                    <svg
                      className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2.5}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default ThemeMenuButton;
