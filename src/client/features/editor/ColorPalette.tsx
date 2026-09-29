import React from "react";
import { cn } from "cn";
import { Toggle } from "#components/ui/toggle";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#components/ui/tooltip";
import {
  STANDARD_COLORS,
  THEME_COLOR_ROWS,
  type PaletteColor,
} from "./paletteColors";
import { EDITOR_COPY } from "#copy/editor";

export interface ColorPaletteProps {
  /** 지금 색. 팔레트에 없는 색(예전의 자유 색)이면 아무 칸도 선택되지 않는다 */
  value: string | undefined;
  onPick: (hex: string) => void;
  /** 격자 전체의 접근성 이름 (예: 글자 색) */
  label: string;
  testId?: string;
}

function Swatch({
  color,
  selected,
  onPick,
  className,
}: {
  color: PaletteColor;
  selected: boolean;
  onPick: (hex: string) => void;
  className?: string;
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            aria-label={color.label}
            pressed={selected}
            onPressedChange={() => onPick(color.value)}
            onMouseDown={(e) => e.preventDefault()}
            style={{ backgroundColor: color.value }}
            className={cn(
              "size-6 min-h-6 min-w-6 rounded-none border border-foreground/15 p-0 hover:z-10 hover:ring-2 hover:ring-ring focus-visible:z-10 aria-pressed:z-10 aria-pressed:ring-2 aria-pressed:ring-primary",
              className,
            )}
          />
        }
      />
      <TooltipContent>{color.label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * PowerPoint 색 선택 격자. 테마 색(기본 한 줄 + 밝게·어둡게 다섯 줄)과 표준 색 한 줄만
 * 고를 수 있다. 자유 색을 막아 송출 화면의 색이 곡마다 제멋대로 흩어지지 않게 한다.
 */
export function ColorPalette({
  value,
  onPick,
  label,
  testId,
}: ColorPaletteProps): React.JSX.Element {
  const current = value?.toUpperCase();
  const [baseRow, ...shadeRows] = THEME_COLOR_ROWS;

  return (
    <div
      role="group"
      aria-label={label}
      data-testid={testId}
      className="flex w-max flex-col gap-1.5 text-xs"
    >
      <span className="font-semibold text-muted-foreground">
        {EDITOR_COPY.ribbon.palette.theme}
      </span>
      <div className="grid grid-cols-10 gap-1">
        {baseRow?.map((color) => (
          <Swatch
            key={color.value}
            color={color}
            selected={current === color.value}
            onPick={onPick}
            className="mb-1"
          />
        ))}
        {shadeRows.flat().map((color) => (
          <Swatch
            key={color.value + color.label}
            color={color}
            selected={current === color.value}
            onPick={onPick}
          />
        ))}
      </div>
      <span className="mt-1 font-semibold text-muted-foreground">
        {EDITOR_COPY.ribbon.palette.standard}
      </span>
      <div className="grid grid-cols-10 gap-1">
        {STANDARD_COLORS.map((color) => (
          <Swatch
            key={color.value + color.label}
            color={color}
            selected={current === color.value}
            onPick={onPick}
          />
        ))}
      </div>
    </div>
  );
}
