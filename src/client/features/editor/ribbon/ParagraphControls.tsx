import React from "react";
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  ListIcon,
  type LucideIcon,
} from "lucide-react";
import type { DeckStyle } from "#shared";
import { RibbonDropdown, RibbonOption } from "./RibbonDropdown";
import { RibbonButton, RibbonGroup } from "./RibbonPrimitives";
import { LINE_HEIGHT_OPTIONS, TEXT_ALIGN_OPTIONS } from "./ribbonOptions";

const ALIGN_ICONS: Record<DeckStyle["textAlign"], LucideIcon> = {
  left: AlignLeftIcon,
  center: AlignCenterIcon,
  right: AlignRightIcon,
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
      {TEXT_ALIGN_OPTIONS.map((option) => {
        const Icon = ALIGN_ICONS[option.id];
        return (
          <RibbonButton
            key={option.id}
            label={option.label}
            testId={`text-align-${option.id}-btn`}
            pressed={style.textAlign === option.id}
            disabled={disabled}
            onClick={() => onUpdateStyle({ textAlign: option.id })}
            icon={<Icon />}
          />
        );
      })}
      <RibbonDropdown
        label="줄 간격"
        testId="line-height-btn"
        disabled={disabled}
        panelClassName="w-28 gap-0 p-1"
        icon={<ListIcon />}
      >
        {(close) =>
          LINE_HEIGHT_OPTIONS.map((value) => (
            <RibbonOption
              key={value}
              selected={style.lineHeight === value}
              className="font-mono"
              onSelect={() => {
                onUpdateStyle({ lineHeight: value });
                close();
              }}
            >
              {value.toFixed(1)}
            </RibbonOption>
          ))
        }
      </RibbonDropdown>
    </RibbonGroup>
  );
}
