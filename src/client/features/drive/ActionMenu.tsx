import React, { useEffect, useMemo, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "#components/ui/dropdown-menu";

export interface MenuAction {
  key: string;
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  separated?: boolean;
  /** 메뉴 오른쪽에 흐리게 보이는 단축키 안내 ("F2") */
  shortcut?: string;
  testId?: string;
}

/** 드라이브 메뉴 항목 목록. 트리거가 있는 DropdownMenu와 좌표 메뉴가 함께 쓴다 */
export function ActionMenuItems({
  actions,
}: {
  actions: MenuAction[];
}): React.JSX.Element {
  return (
    <>
      {actions.map((action, index) => (
        <React.Fragment key={action.key}>
          {action.separated && index > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem
            data-testid={action.testId}
            variant={action.danger ? "destructive" : "default"}
            disabled={action.disabled}
            onClick={action.onSelect}
          >
            {action.icon ? <action.icon /> : <span className="size-4" />}
            {action.label}
            {action.shortcut && (
              <DropdownMenuShortcut>{action.shortcut}</DropdownMenuShortcut>
            )}
          </DropdownMenuItem>
        </React.Fragment>
      ))}
    </>
  );
}

export interface ActionMenuProps {
  anchor: { x: number; y: number };
  actions: MenuAction[];
  onClose: () => void;
  label?: string;
  testId?: string;
  /** 키보드로 연 메뉴는 첫 항목에 바로 포커스를 둔다 */
  autoFocusFirst?: boolean;
}

/**
 * 화면 좌표에 뜨는 메뉴 (우클릭 컨텍스트 메뉴, 행의 ⋮, Shift+F10).
 *
 * 트리거 없이 가상 앵커에 붙인다. 바깥 클릭·Esc로 닫히고, 닫히면 열기 전의
 * 요소로 포커스가 돌아간다.
 */
export function ActionMenu({
  anchor,
  actions,
  onClose,
  label = "메뉴",
  testId = "drive-menu",
  autoFocusFirst = false,
}: ActionMenuProps): React.JSX.Element {
  const popupRef = useRef<HTMLDivElement>(null);
  const virtualAnchor = useMemo(
    () => ({
      getBoundingClientRect: () =>
        DOMRect.fromRect({ x: anchor.x, y: anchor.y, width: 0, height: 0 }),
    }),
    [anchor],
  );

  useEffect(() => {
    if (!autoFocusFirst) return;
    const frame = requestAnimationFrame(() => {
      popupRef.current
        ?.querySelector<HTMLElement>('[role="menuitem"]:not([data-disabled])')
        ?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [autoFocusFirst]);

  return (
    <DropdownMenu
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DropdownMenuContent
        ref={popupRef}
        anchor={virtualAnchor}
        aria-label={label}
        data-testid={testId}
        className="min-w-60"
        onContextMenu={(event) => event.preventDefault()}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <ActionMenuItems actions={actions} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
