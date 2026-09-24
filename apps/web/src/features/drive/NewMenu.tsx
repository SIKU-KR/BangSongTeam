import React, { useRef, useState } from "react";
import { useDrive } from "./driveContext";
import { PopoverMenu, type MenuAction } from "./PopoverMenu";
import { Icon } from "./icons";

/** 새 폴더·새 프레젠테이션 메뉴 항목 (지금 보고 있는 폴더에 만든다) */
export function useNewItemActions(): MenuAction[] {
  const drive = useDrive();
  const target = drive.isTrashView ? null : drive.currentFolderId;
  return [
    {
      key: "new-folder",
      label: "새 폴더",
      icon: "folderAdd",
      testId: "new-menu-folder",
      onSelect: () => drive.requestNewFolder(target),
    },
    {
      key: "new-presentation",
      label: "새 프레젠테이션",
      icon: "documentAdd",
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
        : { x: rect.right - 200, y: rect.bottom + 6 },
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
          className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-500 hover:from-emerald-500 hover:to-teal-400 text-white font-bold text-xs shadow-sm hover:shadow-md hover:shadow-emerald-600/20 dark:shadow-emerald-950/50 flex items-center justify-center gap-2 cursor-pointer transition-all hover:scale-[1.02] active:scale-[0.98]"
        >
          <Icon name="plus" className="w-4 h-4" strokeWidth={2.5} />
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
