import React, { useState, useRef, useEffect } from "react";
import { useTheme, type ThemeMode } from "../../features/theme";

export interface ThemeMenuButtonProps {
  variant?: "full" | "compact";
  direction?: "up" | "down";
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

export function ThemeMenuButton({
  variant = "full",
  direction = "up",
  className = "",
}: ThemeMenuButtonProps): React.JSX.Element {
  const { theme, setTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentOption =
    THEME_OPTIONS.find((opt) => opt.mode === theme) ?? THEME_OPTIONS[2];

  // 외부 클릭 시 드롭다운 닫기
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
      {/* ── 테마 전환 트리거 버튼 ── */}
      {variant === "compact" ? (
        <button
          type="button"
          data-testid="theme-menu-button"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((prev) => !prev)}
          title={`테마 설정: ${currentOption.label}`}
          className="w-10 h-10 rounded-xl flex items-center justify-center text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/70 dark:hover:bg-zinc-900 transition-colors cursor-pointer"
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
          className="w-full px-3 py-2.5 rounded-xl bg-zinc-100 hover:bg-zinc-200/80 dark:bg-zinc-900/70 dark:hover:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-800 dark:text-zinc-200 flex items-center justify-between gap-2.5 transition-all cursor-pointer shadow-sm text-xs font-medium"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-6 h-6 rounded-lg bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
              {currentOption.icon("w-3.5 h-3.5")}
            </div>
            <div className="text-left min-w-0">
              <span className="block text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                {currentOption.label}
              </span>
              <span className="block text-[10px] text-zinc-500 truncate">
                화면 모드 전환
              </span>
            </div>
          </div>

          {/* 화살표 인디케이터 (열리는 방향에 맞춰 표시) */}
          <div className="text-zinc-400 dark:text-zinc-500 shrink-0">
            {direction === "up" ? (
              <svg
                className={`w-3.5 h-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
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
                className={`w-3.5 h-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
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

      {/* ── 드롭다운 / 팝오버 메뉴 ── */}
      {isOpen && (
        <div
          role="menu"
          data-testid="theme-menu-dropdown"
          className={`absolute ${dropdownPositionClass} left-0 ${
            variant === "compact" ? "w-52" : "w-full"
          } bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xl dark:shadow-2xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100`}
        >
          <div className="px-2.5 py-1.5 border-b border-zinc-100 dark:border-zinc-800/80 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-500">
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
                  className={`w-full px-2.5 py-2 rounded-xl text-xs flex items-center justify-between gap-2.5 transition-colors cursor-pointer text-left ${
                    isSelected
                      ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-semibold"
                      : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/80"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                        isSelected
                          ? "bg-emerald-500 text-white"
                          : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400"
                      }`}
                    >
                      {option.icon("w-4 h-4")}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs truncate">{option.label}</div>
                      <div className="text-[10px] text-zinc-500 dark:text-zinc-500 truncate">
                        {option.description}
                      </div>
                    </div>
                  </div>

                  {isSelected && (
                    <svg
                      className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0"
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
