import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./icons";

export interface MenuAction {
  key: string;
  label: string;
  icon?: IconName;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  separated?: boolean;
  testId?: string;
}

export interface PopoverMenuProps {
  anchor: { x: number; y: number };
  actions: MenuAction[];
  onClose: () => void;
  label?: string;
  testId?: string;
  triggerRef?: React.RefObject<HTMLElement | null>;
}

/**
 * 화면 좌표에 뜨는 메뉴 (우클릭 컨텍스트 메뉴, ⋮ 메뉴, 새로 만들기 메뉴).
 *
 * 바깥 클릭·Esc·스크롤·창 크기 변경으로 닫힌다 (ThemeMenuButton과 같은 방식).
 * 화면 밖으로 넘치면 안쪽으로 당긴다.
 */
export function PopoverMenu({
  anchor,
  actions,
  onClose,
  label = "메뉴",
  testId = "drive-menu",
  triggerRef,
}: PopoverMenuProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(anchor);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const { width, height } = node.getBoundingClientRect();
    const margin = 8;
    setPosition({
      x: Math.max(
        margin,
        Math.min(anchor.x, window.innerWidth - width - margin),
      ),
      y: Math.max(
        margin,
        anchor.y + height > window.innerHeight - margin
          ? anchor.y - height
          : anchor.y,
      ),
    });
  }, [anchor]);

  useEffect(() => {
    const handlePointer = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (triggerRef?.current?.contains(target)) return;
      if (ref.current && !ref.current.contains(target)) onClose();
    };
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    const handleDismiss = (): void => onClose();
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey, true);
    window.addEventListener("resize", handleDismiss);
    window.addEventListener("blur", handleDismiss);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey, true);
      window.removeEventListener("resize", handleDismiss);
      window.removeEventListener("blur", handleDismiss);
    };
  }, [onClose, triggerRef]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      data-testid={testId}
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      className="fixed z-[80] min-w-[200px] py-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-lg dark:shadow-2xl"
    >
      {actions.map((action) => (
        <React.Fragment key={action.key}>
          {action.separated && (
            <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" />
          )}
          <button
            type="button"
            role="menuitem"
            data-testid={action.testId}
            disabled={action.disabled}
            onClick={() => {
              onClose();
              action.onSelect();
            }}
            className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2.5 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
              action.danger
                ? "text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white"
            }`}
          >
            {action.icon ? (
              <Icon
                name={action.icon}
                className="w-4 h-4 shrink-0 opacity-80"
              />
            ) : (
              <span className="w-4 h-4 shrink-0" />
            )}
            <span>{action.label}</span>
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}
