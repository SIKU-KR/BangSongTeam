import React, { useEffect, useState } from "react";
import type { DeckStyle } from "#shared";
import { SUPPORTED_FONTS } from "#shared";
import { ColorPickerField } from "../ColorPickerField";
import { RibbonDropdown } from "./RibbonDropdown";
import { RibbonButton, RibbonGroup } from "./RibbonPrimitives";
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
      <select
        aria-label="글꼴"
        value={style.fontFamily}
        disabled={disabled}
        onChange={(e) =>
          onUpdateStyle({
            fontFamily: e.target.value as DeckStyle["fontFamily"],
          })
        }
        className="h-8 w-36 px-2 rounded-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-800 dark:text-zinc-200 focus:outline-none focus:border-emerald-500 cursor-pointer disabled:opacity-35"
      >
        {SUPPORTED_FONTS.map((font) => (
          <option key={font} value={font} style={{ fontFamily: font }}>
            {font}
          </option>
        ))}
      </select>

      <div className="flex items-center">
        <input
          type="text"
          inputMode="numeric"
          aria-label="글자 크기"
          title="글자 크기 (pt)"
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
          className="h-8 w-11 px-1.5 rounded-l-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-center font-mono text-zinc-800 dark:text-zinc-200 focus:outline-none focus:border-emerald-500 disabled:opacity-35"
        />
        <RibbonDropdown
          label="글자 크기 목록"
          testId="font-size-list-btn"
          disabled={disabled}
          panelClassName="w-20 max-h-72 overflow-y-auto !p-1"
        >
          {(close) =>
            FONT_SIZE_PT_PRESETS.map((pt) => (
              <button
                key={pt}
                type="button"
                aria-pressed={pt === sizePt}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onUpdateStyle({ fontSizeVw: ptToVw(pt) });
                  close();
                }}
                className={`w-full px-2 py-1 rounded text-left font-mono cursor-pointer ${
                  pt === sizePt
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300"
                    : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                }`}
              >
                {pt}
              </button>
            ))
          }
        </RibbonDropdown>
      </div>

      <RibbonButton
        label="글자 크기 키우기"
        title="글자 크기 키우기 (Ctrl/⌘+Shift+>)"
        testId="font-size-up-btn"
        disabled={disabled}
        onClick={() =>
          onUpdateStyle({ fontSizeVw: stepFontSize(style.fontSizeVw, 1) })
        }
        icon={
          <span className="font-bold text-sm leading-none">
            A<sup className="text-[9px]">+</sup>
          </span>
        }
      />
      <RibbonButton
        label="글자 크기 줄이기"
        title="글자 크기 줄이기 (Ctrl/⌘+Shift+<)"
        testId="font-size-down-btn"
        disabled={disabled}
        onClick={() =>
          onUpdateStyle({ fontSizeVw: stepFontSize(style.fontSizeVw, -1) })
        }
        icon={
          <span className="font-bold text-xs leading-none">
            A<sup className="text-[9px]">−</sup>
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
            <span className="font-bold text-sm">가</span>
            <span
              className="mt-0.5 h-1 w-4 rounded-sm border border-zinc-300 dark:border-zinc-600"
              style={{ backgroundColor: style.fontColor }}
            />
          </span>
        }
      >
        {() => (
          <div className="space-y-2.5">
            <div className="flex flex-wrap gap-1.5">
              {PRESET_COLORS.map((color) => {
                const selected =
                  style.fontColor.toUpperCase() === color.value.toUpperCase();
                return (
                  <button
                    key={color.value}
                    type="button"
                    aria-label={color.label}
                    aria-pressed={selected}
                    title={color.label}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onUpdateStyle({ fontColor: color.value })}
                    style={{ backgroundColor: color.value }}
                    className={`w-6 h-6 rounded-full border-2 cursor-pointer transition-transform hover:scale-110 ${
                      selected
                        ? "border-emerald-500 ring-2 ring-emerald-500/40"
                        : "border-zinc-300 dark:border-zinc-600"
                    }`}
                  />
                );
              })}
            </div>
            <ColorPickerField
              value={style.fontColor}
              onCommit={(hex) => onUpdateStyle({ fontColor: hex })}
            />
          </div>
        )}
      </RibbonDropdown>

      <RibbonDropdown
        label="텍스트 그림자"
        testId="text-shadow-btn"
        disabled={disabled}
        panelClassName="w-32 !p-1"
        icon={
          <span
            className="font-bold text-sm leading-none"
            style={{ textShadow: "1px 1px 2px rgba(0,0,0,0.6)" }}
          >
            S
          </span>
        }
      >
        {(close) =>
          SHADOW_LEVELS.map((level) => (
            <button
              key={level.id}
              type="button"
              aria-pressed={style.textShadowLevel === level.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onUpdateStyle({ textShadowLevel: level.id });
                close();
              }}
              className={`w-full px-2 py-1.5 rounded text-left cursor-pointer ${
                style.textShadowLevel === level.id
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300"
                  : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
            >
              그림자 {level.label}
            </button>
          ))
        }
      </RibbonDropdown>
    </RibbonGroup>
  );
}
