import React, { useEffect, useState } from "react";
import { cn } from "cn";
import { Button } from "#components/ui/button";
import { Input } from "#components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#components/ui/select";
import type { DeckStyle } from "#shared";
import { SUPPORTED_FONTS } from "#shared";
import { ColorPickerField } from "../ColorPickerField";
import { RibbonDropdown, RibbonOption } from "./RibbonDropdown";
import { RibbonButton, RibbonGroup, RibbonTooltip } from "./RibbonPrimitives";
import {
  FONT_SIZE_PT_PRESETS,
  PRESET_COLORS,
  SHADOW_LEVELS,
  ptToVw,
  stepFontSize,
  vwToPt,
} from "./ribbonOptions";

export interface FontControlsProps {
  style: DeckStyle;
  disabled: boolean;
  onUpdateStyle: (update: Partial<DeckStyle>) => void;
}

/** 리본 '글꼴' 그룹: 글꼴·크기(pt)·색·그림자 */
export function FontControls({
  style,
  disabled,
  onUpdateStyle,
}: FontControlsProps): React.JSX.Element {
  const sizePt = vwToPt(style.fontSizeVw);
  const [sizeText, setSizeText] = useState(String(sizePt));

  useEffect(() => {
    setSizeText(String(sizePt));
  }, [sizePt]);

  const commitSize = () => {
    const pt = Number(sizeText);
    if (sizeText.trim() && Number.isFinite(pt) && pt > 0) {
      onUpdateStyle({ fontSizeVw: ptToVw(pt) });
    }
    setSizeText(String(sizePt));
  };

  return (
    <RibbonGroup label="글꼴">
      <Select
        value={style.fontFamily}
        disabled={disabled}
        onValueChange={(value) => {
          if (value) {
            onUpdateStyle({ fontFamily: value as DeckStyle["fontFamily"] });
          }
        }}
      >
        <SelectTrigger aria-label="글꼴" className="w-36 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SUPPORTED_FONTS.map((font) => (
            <SelectItem key={font} value={font} style={{ fontFamily: font }}>
              {font}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center">
        <RibbonTooltip content="글자 크기 (pt)">
          <Input
            type="text"
            inputMode="numeric"
            aria-label="글자 크기"
            value={sizeText}
            disabled={disabled}
            onChange={(e) => setSizeText(e.target.value)}
            onBlur={commitSize}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitSize();
              }
              if (e.key === "Escape") setSizeText(String(sizePt));
            }}
            className="w-11 rounded-r-none px-1.5 text-center font-mono text-xs md:text-xs"
          />
        </RibbonTooltip>
        <RibbonDropdown
          label="글자 크기 목록"
          testId="font-size-list-btn"
          disabled={disabled}
          panelClassName="max-h-72 w-20 gap-0 overflow-y-auto p-1"
        >
          {(close) =>
            FONT_SIZE_PT_PRESETS.map((pt) => (
              <RibbonOption
                key={pt}
                selected={pt === sizePt}
                className="font-mono"
                onSelect={() => {
                  onUpdateStyle({ fontSizeVw: ptToVw(pt) });
                  close();
                }}
              >
                {pt}
              </RibbonOption>
            ))
          }
        </RibbonDropdown>
      </div>

      <RibbonButton
        label="글자 크기 키우기"
        tooltip="글자 크기 키우기 (Ctrl/⌘+Shift+>)"
        testId="font-size-up-btn"
        disabled={disabled}
        onClick={() =>
          onUpdateStyle({ fontSizeVw: stepFontSize(style.fontSizeVw, 1) })
        }
        icon={
          <span className="text-sm leading-none font-bold">
            A<sup className="text-2xs">+</sup>
          </span>
        }
      />
      <RibbonButton
        label="글자 크기 줄이기"
        tooltip="글자 크기 줄이기 (Ctrl/⌘+Shift+<)"
        testId="font-size-down-btn"
        disabled={disabled}
        onClick={() =>
          onUpdateStyle({ fontSizeVw: stepFontSize(style.fontSizeVw, -1) })
        }
        icon={
          <span className="text-xs leading-none font-bold">
            A<sup className="text-2xs">−</sup>
          </span>
        }
      />

      <RibbonDropdown
        label="글자 색"
        testId="font-color-btn"
        disabled={disabled}
        panelClassName="w-60"
        icon={
          <span className="flex flex-col items-center leading-none">
            <span className="text-sm font-bold">가</span>
            <span
              className="mt-0.5 h-1 w-4 rounded-sm border"
              style={{ backgroundColor: style.fontColor }}
            />
          </span>
        }
      >
        {() => (
          <>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_COLORS.map((color) => {
                const selected =
                  style.fontColor.toUpperCase() === color.value.toUpperCase();
                return (
                  <RibbonTooltip key={color.value} content={color.label}>
                    <Button
                      variant="outline"
                      size="icon-xs"
                      aria-label={color.label}
                      aria-pressed={selected}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onUpdateStyle({ fontColor: color.value })}
                      style={{ backgroundColor: color.value }}
                      className={cn(
                        "rounded-full border-2 transition-transform hover:scale-110",
                        selected && "border-primary ring-2 ring-ring/50",
                      )}
                    />
                  </RibbonTooltip>
                );
              })}
            </div>
            <ColorPickerField
              value={style.fontColor}
              onCommit={(hex) => onUpdateStyle({ fontColor: hex })}
            />
          </>
        )}
      </RibbonDropdown>

      <RibbonDropdown
        label="텍스트 그림자"
        testId="text-shadow-btn"
        disabled={disabled}
        panelClassName="w-32 gap-0 p-1"
        icon={
          <span className="text-sm leading-none font-bold text-shadow-sm">
            S
          </span>
        }
      >
        {(close) =>
          SHADOW_LEVELS.map((level) => (
            <RibbonOption
              key={level.id}
              selected={style.textShadowLevel === level.id}
              onSelect={() => {
                onUpdateStyle({ textShadowLevel: level.id });
                close();
              }}
            >
              그림자 {level.label}
            </RibbonOption>
          ))
        }
      </RibbonDropdown>
    </RibbonGroup>
  );
}
