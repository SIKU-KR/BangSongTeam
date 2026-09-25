import React, { useRef, useState } from "react";
import { useDrive } from "./driveContext";
import { PopoverMenu, type MenuAction } from "./PopoverMenu";
import { Icon } from "./icons";

export function useNewItemActions(): MenuAction[] {
  const drive = useDrive();
  const target = drive.isTrashView ? null : drive.currentFolderId;
  return [
    {
      key: "new-folder",
      label: "새 폴더",
      icon: "folderAdd",
      shortcut: "Shift+F",
      testId: "new-menu-folder",
      onSelect: () => drive.requestNewFolder(target),
    },
    {
      key: "new-presentation",
      label: "새 프레젠테이션",
      icon: "documentAdd",
      shortcut: "Shift+P",
      testId: "new-menu-presentation",
      onSelect: () => drive.createPresentationIn(target),
    },
  ];
}

/**
 * '새로 만들기' 버튼 (드라이브의 '+ 신규').
 * - `sidebar`: 사이드바 상단의 그라데이션 CTA
 * - `fab`: 툴바 오른쪽 원형 + 버튼
 */
export function NewMenuButton({
  variant,
  testId,
}: {
  variant: "sidebar" | "fab";
  testId?: string;
}): React.JSX.Element {
  const actions = useNewItemActions();
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const open = (event: React.MouseEvent<HTMLButtonElement>): void => {
    if (anchor) {
      setAnchor(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setAnchor(
      variant === "sidebar"
        ? { x: rect.left, y: rect.bottom + 6 }
        : { x: rect.right - 240, y: rect.bottom + 6 },
    );
  };

  return (
    <>
      {variant === "sidebar" ? (
        <button
          ref={triggerRef}
          type="button"
          data-testid={testId}
          aria-haspopup="menu"
          aria-expanded={anchor !== null}
          onClick={open}
          className="h-14 pl-4 pr-6 rounded-2xl bg-white dark:bg-zinc-800 hover:bg-emerald-50 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-100 font-medium text-sm shadow-md hover:shadow-lg dark:shadow-black/40 inline-flex items-center gap-3 cursor-pointer transition-all"
        >
          <Icon name="plus" className="w-6 h-6" strokeWidth={2} />
          <span>새로 만들기</span>
        </button>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          data-testid={testId}
          aria-haspopup="menu"
          aria-expanded={anchor !== null}
          onClick={open}
          title="새로 만들기"
          className="w-8 h-8 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center shadow-sm hover:shadow dark:shadow-emerald-950/40 hover:scale-105 active:scale-95 transition-all cursor-pointer"
        >
          <Icon name="plus" className="w-4 h-4" strokeWidth={2.5} />
        </button>
      )}
      {anchor && (
        <PopoverMenu
          anchor={anchor}
          actions={actions}
          label="새로 만들기"
          testId="new-menu"
          triggerRef={triggerRef}
          onClose={() => setAnchor(null)}
        />
      )}
    </>
  );
}
