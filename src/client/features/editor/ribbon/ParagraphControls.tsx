import React from "react";
import type { DeckStyle } from "#shared";
import { RibbonDropdown } from "./RibbonDropdown";
import { RibbonButton, RibbonGroup, RibbonIcon } from "./RibbonPrimitives";
import { LINE_HEIGHT_OPTIONS, TEXT_ALIGN_OPTIONS } from "./ribbonOptions";

const ALIGN_ICONS: Record<DeckStyle["textAlign"], string> = {
  left: "M4 6h16M4 12h10M4 18h16",
  center: "M4 6h16M7 12h10M4 18h16",
  right: "M4 6h16M10 12h10M4 18h16",
};

export interface ParagraphControlsProps {
  style: DeckStyle;
  disabled: boolean;
  onUpdateStyle: (update: Partial<DeckStyle>) => void;
}

/** 리본 '단락' 그룹: 정렬·줄 간격 */
export function ParagraphControls({
  style,
  disabled,
  onUpdateStyle,
}: ParagraphControlsProps): React.JSX.Element {
  return (
    <RibbonGroup label="단락">
      {TEXT_ALIGN_OPTIONS.map((option) => (
        <RibbonButton
          key={option.id}
          label={option.label}
          testId={`text-align-${option.id}-btn`}
          pressed={style.textAlign === option.id}
          disabled={disabled}
          onClick={() => onUpdateStyle({ textAlign: option.id })}
          icon={<RibbonIcon d={ALIGN_ICONS[option.id]} />}
        />
      ))}
      <RibbonDropdown
        label="줄 간격"
        testId="line-height-btn"
        disabled={disabled}
        panelClassName="w-28 !p-1"
        icon={
          <RibbonIcon d="M11 6h9M11 12h9M11 18h9M5 9V5m0 0L3 7m2-2l2 2m-2 8v4m0 0l-2-2m2 2l2-2" />
        }
      >
        {(close) =>
          LINE_HEIGHT_OPTIONS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={style.lineHeight === value}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onUpdateStyle({ lineHeight: value });
                close();
              }}
              className={`w-full px-2 py-1 rounded text-left font-mono cursor-pointer ${
                style.lineHeight === value
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300"
                  : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
            >
              {value.toFixed(1)}
            </button>
          ))
        }
      </RibbonDropdown>
    </RibbonGroup>
  );
}
