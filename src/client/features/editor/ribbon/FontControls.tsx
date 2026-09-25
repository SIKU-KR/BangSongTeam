import React, { useEffect, useState } from "react";
import { ButtonGroup } from "#components/ui/button-group";
import { Input } from "#components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "#components/ui/select";
import type { DeckStyle } from "#shared";
import {
  DEFAULT_PRESET_FONTS,
  INDEX_POPULAR_FONT_NAMES,
  NOONNU_FONTS,
} from "#shared";
import { loadWebFont } from "../../../lib/fonts/fontLoader";
import { ColorPickerField } from "../ColorPickerField";
import { ToggleGroup, ToggleGroupItem } from "#components/ui/toggle-group";
import { RibbonChoices, RibbonDropdown } from "./RibbonDropdown";
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

  const [fontSearch, setFontSearch] = useState("");

  useEffect(() => {
    if (style.fontFamily) {
      loadWebFont(style.fontFamily);
    }
  }, [style.fontFamily]);

  const presetSet = new Set<string>(DEFAULT_PRESET_FONTS);
  const searchTrimmed = fontSearch.trim().toLowerCase();

  const filteredFonts = React.useMemo(() => {
    if (!searchTrimmed) {
      return NOONNU_FONTS.filter(
        (f) =>
          !presetSet.has(f.name) &&
          (INDEX_POPULAR_FONT_NAMES.includes(f.name) ||
            f.name === style.fontFamily),
      );
    }
    return NOONNU_FONTS.filter(
      (f) =>
        f.name.toLowerCase().includes(searchTrimmed) ||
        f.author.toLowerCase().includes(searchTrimmed) ||
        f.cardFamily.toLowerCase().includes(searchTrimmed),
    ).slice(0, 50);
  }, [searchTrimmed, style.fontFamily]);

  return (
    <RibbonGroup label="글꼴">
      <Select
        value={style.fontFamily}
        disabled={disabled}
        onValueChange={(value) => {
          if (value) {
            loadWebFont(value);
            onUpdateStyle({ fontFamily: value as DeckStyle["fontFamily"] });
          }
        }}
      >
        <SelectTrigger aria-label="글꼴" className="w-36 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-72 w-56">
          <div className="border-b border-border p-1">
            <Input
              type="text"
              placeholder="글꼴 검색 (1,100+종)..."
              value={fontSearch}
              onChange={(e) => setFontSearch(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              className="h-7 text-xs"
            />
          </div>
          {!searchTrimmed && (
            <>
              <SelectGroup>
                <SelectLabel className="px-2 py-1 text-2xs text-muted-foreground">
                  기본 글꼴
                </SelectLabel>
                {DEFAULT_PRESET_FONTS.map((font) => (
                  <SelectItem
                    key={font}
                    value={font}
                    style={{ fontFamily: font }}
                  >
                    {font}
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel className="px-2 py-1 text-2xs text-muted-foreground">
                  인기 무료 웹폰트
                </SelectLabel>
                {filteredFonts.map((font) => (
                  <SelectItem
                    key={font.name}
                    value={font.name}
                    style={{ fontFamily: font.name }}
                  >
                    {font.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </>
          )}
          {searchTrimmed && (
            <SelectGroup>
              <SelectLabel className="px-2 py-1 text-2xs text-muted-foreground">
                검색 결과 ({filteredFonts.length}개)
              </SelectLabel>
              {filteredFonts.map((font) => (
                <SelectItem
                  key={font.name}
                  value={font.name}
                  style={{ fontFamily: font.name }}
                >
                  {font.name}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>

      <ButtonGroup>
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
            className="w-12 text-center font-mono"
          />
        </RibbonTooltip>
        <RibbonDropdown
          label="글자 크기 목록"
          testId="font-size-list-btn"
          disabled={disabled}
          panelClassName="max-h-72 w-20 overflow-y-auto p-1"
        >
          {(close) => (
            <RibbonChoices
              label="글자 크기 목록"
              className="font-mono"
              value={String(sizePt)}
              choices={FONT_SIZE_PT_PRESETS.map((pt) => ({
                value: String(pt),
                label: pt,
              }))}
              onSelect={(value) => {
                onUpdateStyle({ fontSizeVw: ptToVw(Number(value)) });
                close();
              }}
            />
          )}
        </RibbonDropdown>
      </ButtonGroup>

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
            <ToggleGroup
              aria-label="글자 색"
              variant="outline"
              size="sm"
              value={[style.fontColor.toUpperCase()]}
              onValueChange={(next) => {
                if (next[0]) onUpdateStyle({ fontColor: next[0] });
              }}
              className="flex-wrap"
            >
              {PRESET_COLORS.map((color) => (
                <RibbonTooltip key={color.value} content={color.label}>
                  <ToggleGroupItem
                    value={color.value.toUpperCase()}
                    aria-label={color.label}
                    onMouseDown={(e) => e.preventDefault()}
                    style={{ backgroundColor: color.value }}
                    className="rounded-full aria-pressed:ring-3 aria-pressed:ring-ring/50"
                  />
                </RibbonTooltip>
              ))}
            </ToggleGroup>
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
        panelClassName="w-32 p-1"
        icon={
          <span className="text-sm leading-none font-bold text-shadow-sm">
            S
          </span>
        }
      >
        {(close) => (
          <RibbonChoices
            label="텍스트 그림자"
            value={style.textShadowLevel}
            choices={SHADOW_LEVELS.map((level) => ({
              value: level.id,
              label: `그림자 ${level.label}`,
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
