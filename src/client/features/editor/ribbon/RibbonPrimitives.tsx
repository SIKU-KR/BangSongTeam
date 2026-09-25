import React from "react";

/** 리본 그룹. 컨트롤 줄 아래에 PowerPoint처럼 그룹 이름을 단다 */
export function RibbonGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex flex-col items-center justify-between gap-1 px-2.5 py-1"
    >
      <div className="flex items-center gap-1">{children}</div>
      <span
        aria-hidden="true"
        className="hidden xl:block text-[10px] leading-none text-zinc-400 dark:text-zinc-500"
      >
        {label}
      </span>
    </div>
  );
}

export function RibbonDivider(): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      className="self-stretch w-px my-1.5 bg-zinc-200 dark:bg-zinc-800"
    />
  );
}

export interface RibbonButtonProps {
  label: string;
  icon?: React.ReactNode;
  text?: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  testId?: string;
  title?: string;
  className?: string;
  ariaHasPopup?: boolean;
  ariaExpanded?: boolean;
}

/**
 * 리본 버튼. mousedown 기본 동작을 막아, 슬라이드 위에서 가사를 편집하는 중에
 * 눌러도 textarea의 포커스와 커서가 그대로 남는다.
 */
export function RibbonButton({
  label,
  icon,
  text,
  pressed,
  disabled,
  onClick,
  testId,
  title,
  className = "",
  ariaHasPopup,
  ariaExpanded,
}: RibbonButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      aria-pressed={pressed}
      aria-haspopup={ariaHasPopup}
      aria-expanded={ariaExpanded}
      title={title ?? label}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`h-8 min-w-8 px-1.5 rounded-md flex items-center justify-center gap-1 text-xs font-medium transition-colors cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed ${
        pressed
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300"
          : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 disabled:hover:bg-transparent"
      } ${className}`}
    >
      {icon}
      {text && <span className="hidden xl:inline">{text}</span>}
    </button>
  );
}

/** 리본 아이콘 (24×24 선 아이콘) */
export function RibbonIcon({
  d,
  className = "w-4 h-4",
}: {
  d: string;
  className?: string;
}): React.JSX.Element {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d={d}
      />
    </svg>
  );
}
