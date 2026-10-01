import React from "react";
import type { DeckStyle } from "#shared";
import { ColorPalette } from "../ColorPalette";
import { FontFamilySelect } from "./FontFamilySelect";
import { FontSizeField } from "./FontSizeField";
import { RibbonChoices, RibbonDropdown } from "./RibbonDropdown";
import { RibbonButton, RibbonGroup } from "./RibbonPrimitives";
import { SHADOW_LEVELS, stepFontSize } from "./ribbonOptions";
import { EDITOR_COPY } from "#copy/editor";

interface FontControlsProps {
  style: DeckStyle;
  disabled: boolean;
  onUpdateStyle: (update: Partial<DeckStyle>) => void;
}

/** 리본 '글꼴' 그룹: 글꼴·크기(pt)·색·그림자. */
export function FontControls({
  style,
  disabled,
  onUpdateStyle,
}: FontControlsProps): React.JSX.Element {
  return (
    <RibbonGroup label={EDITOR_COPY.ribbon.font}>
      <FontFamilySelect
        value={style.fontFamily}
        disabled={disabled}
        onChange={(fontFamily) => onUpdateStyle({ fontFamily })}
      />

      <FontSizeField
        fontSizeVw={style.fontSizeVw}
        disabled={disabled}
        onChange={(fontSizeVw) => onUpdateStyle({ fontSizeVw })}
      />

      <RibbonButton
        label={EDITOR_COPY.ribbon.fontSizeUp}
        tooltip={EDITOR_COPY.ribbon.fontSizeUpTooltip}
        testId="font-size-up-btn"
        disabled={disabled}
        onClick={() =>
          onUpdateStyle({ fontSizeVw: stepFontSize(style.fontSizeVw, 1) })
        }
        icon={
          <span className="text-sm leading-none font-bold">
            A<sup className="text-xs">+</sup>
          </span>
        }
      />
      <RibbonButton
        label={EDITOR_COPY.ribbon.fontSizeDown}
        tooltip={EDITOR_COPY.ribbon.fontSizeDownTooltip}
        testId="font-size-down-btn"
        disabled={disabled}
        onClick={() =>
          onUpdateStyle({ fontSizeVw: stepFontSize(style.fontSizeVw, -1) })
        }
        icon={
          <span className="text-xs leading-none font-bold">
            A<sup className="text-xs">−</sup>
          </span>
        }
      />

      <RibbonDropdown
        label={EDITOR_COPY.ribbon.fontColor}
        testId="font-color-btn"
        disabled={disabled}
        panelClassName="w-auto"
        icon={
          <span className="flex flex-col items-center leading-none">
            <span className="text-sm font-bold">
              {EDITOR_COPY.ribbon.fontColorSample}
            </span>
            <span
              className="mt-0.5 h-1 w-4 rounded-sm border"
              style={{ backgroundColor: style.fontColor }}
            />
          </span>
        }
      >
        {(close) => (
          <ColorPalette
            label={EDITOR_COPY.ribbon.fontColor}
            testId="font-color-palette"
            value={style.fontColor}
            onPick={(hex) => {
              onUpdateStyle({ fontColor: hex });
              close();
            }}
          />
        )}
      </RibbonDropdown>

      <RibbonDropdown
        label={EDITOR_COPY.ribbon.textShadow}
        testId="text-shadow-btn"
        disabled={disabled}
        panelClassName="w-32 p-1"
        icon={
          <span className="text-sm leading-none font-bold text-shadow-sm">
            S
          </span>
        }
      >
        {(close) => (
          <RibbonChoices
            label={EDITOR_COPY.ribbon.textShadow}
            value={style.textShadowLevel}
            choices={SHADOW_LEVELS.map((level) => ({
              value: level.id,
              label: EDITOR_COPY.ribbon.shadowLevel(level.label),
            }))}
            onSelect={(value) => {
              const level = SHADOW_LEVELS.find((item) => item.id === value);
              if (level) onUpdateStyle({ textShadowLevel: level.id });
              close();
            }}
          />
        )}
      </RibbonDropdown>
    </RibbonGroup>
  );
}
