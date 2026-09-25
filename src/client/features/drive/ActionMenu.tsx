import React from "react";
import type { LucideIcon } from "lucide-react";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from "#components/ui/context-menu";
import {
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

const PARTS = {
  dropdown: {
    Item: DropdownMenuItem,
    Separator: DropdownMenuSeparator,
    Shortcut: DropdownMenuShortcut,
  },
  context: {
    Item: ContextMenuItem,
    Separator: ContextMenuSeparator,
    Shortcut: ContextMenuShortcut,
  },
} as const;

/** 드라이브 메뉴 항목 목록. ⋮·▾ 드롭다운 메뉴와 우클릭 메뉴가 같은 항목을 쓴다 */
export function ActionMenuItems({
  actions,
  kind = "dropdown",
}: {
  actions: MenuAction[];
  kind?: keyof typeof PARTS;
}): React.JSX.Element {
  const { Item, Separator, Shortcut } = PARTS[kind];
  return (
    <>
      {actions.map((action, index) => (
        <React.Fragment key={action.key}>
          {action.separated && index > 0 && <Separator />}
          <Item
            data-testid={action.testId}
            variant={action.danger ? "destructive" : "default"}
            disabled={action.disabled}
            onClick={action.onSelect}
          >
            {action.icon ? <action.icon /> : <span className="size-4" />}
            {action.label}
            {action.shortcut && <Shortcut>{action.shortcut}</Shortcut>}
          </Item>
        </React.Fragment>
      ))}
    </>
  );
}
