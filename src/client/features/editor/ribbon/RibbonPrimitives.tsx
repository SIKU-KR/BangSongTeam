import React from "react";
import { cn } from "cn";
import { Button } from "#components/ui/button";
import { Separator } from "#components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#components/ui/tooltip";

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
        className="hidden text-2xs leading-none text-muted-foreground xl:block"
      >
        {label}
      </span>
    </div>
  );
}

export function RibbonDivider(): React.JSX.Element {
  return (
    <Separator
      orientation="vertical"
      aria-hidden="true"
      className="my-1.5 self-stretch"
    />
  );
}

/**
 * 리본 버튼에 툴팁을 붙인다. 트리거를 감싼 span에 걸어, 비활성 버튼에서도
 * 왜 누를 수 없는지 안내가 뜬다.
 */
export function RibbonTooltip({
  content,
  children,
}: {
  content: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        {children}
      </TooltipTrigger>
      <TooltipContent className="max-w-72">{content}</TooltipContent>
    </Tooltip>
  );
}

/** 리본 버튼 모양. 켜진 상태(`aria-pressed`)와 펼친 상태를 같은 색으로 보인다 */
export const RIBBON_BUTTON_CLASS =
  "h-8 min-w-8 gap-1 px-1.5 text-xs aria-pressed:bg-accent aria-pressed:text-accent-foreground data-popup-open:bg-accent";

export interface RibbonButtonProps {
  label: string;
  icon?: React.ReactNode;
  text?: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  testId?: string;
  /** 툴팁 문구. 없으면 `label`을 쓴다 */
  tooltip?: string;
  className?: string;
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
  tooltip,
  className,
}: RibbonButtonProps): React.JSX.Element {
  return (
    <RibbonTooltip content={tooltip ?? label}>
      <Button
        variant="ghost"
        data-testid={testId}
        aria-label={label}
        aria-pressed={pressed}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        className={cn(RIBBON_BUTTON_CLASS, className)}
      >
        {icon}
        {text && <span className="hidden xl:inline">{text}</span>}
      </Button>
    </RibbonTooltip>
  );
}
