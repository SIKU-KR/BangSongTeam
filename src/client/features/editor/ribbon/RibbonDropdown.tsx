import React, { useCallback, useRef, useState } from "react";
import { useDismiss } from "../../../hooks/useDismiss";
import { RibbonButton, RibbonIcon } from "./RibbonPrimitives";

export interface RibbonDropdownProps {
  label: string;
  icon?: React.ReactNode;
  text?: string;
  disabled?: boolean;
  testId?: string;
  panelTestId?: string;
  panelClassName?: string;
  align?: "left" | "right";
  children: (close: () => void) => React.ReactNode;
}

/**
 * 리본의 펼침 메뉴. 패널에 `role="dialog"`를 쓰지 않는다. 편집기 단축키가
 * 모달이 떠 있는지를 그 역할로 판단하기 때문이다.
 */
export function RibbonDropdown({
  label,
  icon,
  text,
  disabled,
  testId,
  panelTestId,
  panelClassName = "w-56",
  align = "left",
  children,
}: RibbonDropdownProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(rootRef, open, close);

  return (
    <div ref={rootRef} className="relative">
      <RibbonButton
        label={label}
        testId={testId}
        disabled={disabled}
        ariaHasPopup
        ariaExpanded={open}
        pressed={open}
        onClick={() => setOpen((prev) => !prev)}
        icon={
          <>
            {icon}
            {text && <span className="hidden xl:inline">{text}</span>}
            <RibbonIcon d="M19 9l-7 7-7-7" className="w-3 h-3 opacity-60" />
          </>
        }
      />
      {open && (
        <div
          data-testid={panelTestId}
          className={`absolute top-full mt-1 z-40 p-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-lg dark:shadow-2xl text-xs text-zinc-800 dark:text-zinc-200 ${
            align === "right" ? "right-0" : "left-0"
          } ${panelClassName}`}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}
