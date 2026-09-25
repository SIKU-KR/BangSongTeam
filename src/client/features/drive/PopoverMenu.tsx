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
  /** 메뉴 오른쪽에 흐리게 보이는 단축키 안내 ("F2") */
  shortcut?: string;
  testId?: string;
}

export interface PopoverMenuProps {
  anchor: { x: number; y: number };
  actions: MenuAction[];
  onClose: () => void;
  label?: string;
  testId?: string;
  triggerRef?: React.RefObject<HTMLElement | null>;
  /** 키보드로 연 메뉴는 첫 항목에 바로 포커스를 둔다 */
  autoFocusFirst?: boolean;
}

function menuItems(menu: HTMLElement | null): HTMLButtonElement[] {
  if (!menu) return [];
  return [
    ...menu.querySelectorAll<HTMLButtonElement>(
      'button[role="menuitem"]:not(:disabled)',
    ),
  ];
}

/**
 * 화면 좌표에 뜨는 메뉴 (우클릭 컨텍스트 메뉴, ⋮ 메뉴, 새로 만들기 메뉴).
 *
 * 바깥 클릭·Esc·Tab·창 크기 변경으로 닫힌다. 화면 밖으로 넘치면 안쪽으로 당긴다.
 * ↑↓·Home·End로 항목을 옮겨 다니고, 닫히면 메뉴를 열기 전의 요소로 포커스를 돌려준다.
 */
export function PopoverMenu({
  anchor,
  actions,
  onClose,
  label = "메뉴",
  testId = "drive-menu",
  triggerRef,
  autoFocusFirst = false,
}: PopoverMenuProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(anchor);

  useLayoutEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (autoFocusFirst) menuItems(ref.current)[0]?.focus();
    else ref.current?.focus();
    const menu = ref.current;
    return () => {
      const active = document.activeElement;
      const focusInMenu =
        active === document.body || (menu?.contains(active) ?? false);
      if (focusInMenu && previous?.isConnected) previous.focus();
    };
  }, [autoFocusFirst]);

  const handleMenuKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === "Tab") {
      event.preventDefault();
      onClose();
      return;
    }
    const items = menuItems(ref.current);
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | null = null;
    if (event.key === "ArrowDown") next = (current + 1) % items.length;
    else if (event.key === "ArrowUp") {
      next = current <= 0 ? items.length - 1 : current - 1;
    } else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    items[next].focus();
  };

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
      tabIndex={-1}
      style={{ left: position.x, top: position.y }}
      onKeyDown={handleMenuKeyDown}
      onContextMenu={(event) => event.preventDefault()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      className="fixed z-[80] min-w-[240px] py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-lg dark:shadow-2xl outline-none"
    >
      {actions.map((action, index) => (
        <React.Fragment key={action.key}>
          {action.separated && index > 0 && (
            <div className="my-2 border-t border-zinc-200 dark:border-zinc-800" />
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
            className={`w-full text-left px-4 py-2 text-sm flex items-center gap-3 transition-colors cursor-pointer outline-none disabled:opacity-40 disabled:cursor-not-allowed ${
              action.danger
                ? "text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 focus-visible:bg-rose-50 dark:focus-visible:bg-rose-950/40"
                : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white focus-visible:bg-zinc-100 dark:focus-visible:bg-zinc-800"
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
            <span className="flex-1">{action.label}</span>
            {action.shortcut && (
              <kbd className="ml-6 font-sans text-xs text-zinc-400 dark:text-zinc-500">
                {action.shortcut}
              </kbd>
            )}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}
