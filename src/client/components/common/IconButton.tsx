import React from "react";
import { Button } from "#components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#components/ui/tooltip";

export type IconButtonProps = React.ComponentProps<typeof Button> & {
  /** 스크린 리더 이름이자 툴팁 문구 */
  label: string;
  tooltipSide?: React.ComponentProps<typeof TooltipContent>["side"];
};

/**
 * 아이콘만 있는 버튼. 레이블을 `aria-label`과 툴팁으로 함께 붙여, 보이는 글자가
 * 없어도 무슨 버튼인지 알 수 있게 한다.
 */
export function IconButton({
  label,
  tooltipSide,
  variant = "ghost",
  size = "icon",
  children,
  ...props
}: IconButtonProps): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant={variant} size={size} aria-label={label} {...props} />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>{label}</TooltipContent>
    </Tooltip>
  );
}
