import React from "react";
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  ListIcon,
  type LucideIcon,
} from "lucide-react";
import type { DeckStyle } from "#shared";
import { ToggleGroup, ToggleGroupItem } from "#components/ui/toggle-group";
import { RibbonChoices, RibbonDropdown } from "./RibbonDropdown";
import { RibbonGroup, RibbonTooltip } from "./RibbonPrimitives";
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
      <ToggleGroup
        aria-label="정렬"
        spacing={0}
        size="sm"
        value={[style.textAlign]}
        disabled={disabled}
        onValueChange={(next) => {
          const picked = TEXT_ALIGN_OPTIONS.find(
            (option) => option.id === next[0],
          );
          if (picked) onUpdateStyle({ textAlign: picked.id });
        }}
      >
        {TEXT_ALIGN_OPTIONS.map((option) => {
          const Icon = ALIGN_ICONS[option.id];
          return (
            <RibbonTooltip key={option.id} content={option.label}>
              <ToggleGroupItem
                value={option.id}
                aria-label={option.label}
                data-testid={`text-align-${option.id}-btn`}
                onMouseDown={(e) => e.preventDefault()}
              >
                <Icon />
              </ToggleGroupItem>
            </RibbonTooltip>
          );
        })}
      </ToggleGroup>
      <RibbonDropdown
        label="줄 간격"
        testId="line-height-btn"
        disabled={disabled}
        panelClassName="w-28 p-1"
        icon={<ListIcon />}
      >
        {(close) => (
          <RibbonChoices
            label="줄 간격"
            className="font-mono"
            value={String(style.lineHeight)}
            choices={LINE_HEIGHT_OPTIONS.map((value) => ({
              value: String(value),
              label: value.toFixed(1),
            }))}
            onSelect={(value) => {
              onUpdateStyle({ lineHeight: Number(value) });
              close();
            }}
          />
        )}
      </RibbonDropdown>
    </RibbonGroup>
  );
}
