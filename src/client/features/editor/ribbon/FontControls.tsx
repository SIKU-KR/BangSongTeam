import React, { useEffect, useState } from "react";
import { Button } from "#components/ui/button";
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
import type { DeckStyle, NoonnuFont } from "#shared";
import { DEFAULT_PRESET_FONTS, loadNoonnuFontCatalog } from "#shared";
import { loadWebFont } from "../../../lib/fonts/fontLoader";
import { ColorPalette } from "../ColorPalette";
import { RibbonChoices, RibbonDropdown } from "./RibbonDropdown";
import { RibbonButton, RibbonGroup, RibbonTooltip } from "./RibbonPrimitives";
import {
  FONT_SIZE_PT_PRESETS,
  SHADOW_LEVELS,
  ptToVw,
  stepFontSize,
  vwToPt,
} from "./ribbonOptions";
import { EDITOR_COPY } from "#copy/editor";

export interface FontControlsProps {
  style: DeckStyle;
  disabled: boolean;
  onUpdateStyle: (update: Partial<DeckStyle>) => void;
}

/**
 * 기본 글꼴의 미리보기 이미지 ID. 기본 글꼴은 카탈로그 청크를 기다리지 않고 드롭다운을
 * 여는 즉시 보여야 해서 카탈로그의 `id`를 여기 따로 둔다.
 */
const PRESET_FONT_PREVIEW_IDS: Record<
  (typeof DEFAULT_PRESET_FONTS)[number],
  string
> = {
  Pretendard: "core-pretendard",
  "Noto Sans KR": "core-noto-sans-kr",
  "Nanum Myeongjo": "core-nanum-myeongjo",
  "Gmarket Sans": "core-gmarket-sans",
  "KoPubWorld Batang": "core-kopub-batang",
};

const PRESET_FONTS = DEFAULT_PRESET_FONTS.map((name) => ({
  id: PRESET_FONT_PREVIEW_IDS[name],
  name,
}));

function FontOption({
  font,
}: {
  font: Pick<NoonnuFont, "id" | "name">;
}): React.JSX.Element {
  return (
    <SelectItem value={font.name}>
      <span
        aria-hidden
        className="h-6 flex-1 bg-current"
        style={{
          maskImage: `url("/font-previews/${font.id}.webp")`,
          maskSize: "auto 100%",
          maskRepeat: "no-repeat",
          maskPosition: "left center",
        }}
      />
      <span className="sr-only">{font.name}</span>
    </SelectItem>
  );
}

/**
 * 리본 '글꼴' 그룹: 글꼴·크기(pt)·색·그림자.
 *
 * 글꼴 목록은 폰트 파일 대신 `scripts/buildFontPreviews.mjs`가 미리 그려 둔 이름 이미지
 * (`/font-previews/<id>.webp`)를 mask로 보여 준다. 한글 폰트는 파일 하나가 수 MB라 목록을
 * 그 글꼴로 그리면 드롭다운 하나로 수십~수백 MB를 받는다. 폰트 파일은 고른 글꼴만 받는다.
 */
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
  const [displayLimit, setDisplayLimit] = useState(60);

  const [catalog, setCatalog] = useState<readonly NoonnuFont[]>([]);

  useEffect(() => {
    if (style.fontFamily) {
      void loadWebFont(style.fontFamily);
    }
  }, [style.fontFamily]);

  const loadCatalog = (): void => {
    if (catalog.length === 0) void loadNoonnuFontCatalog().then(setCatalog);
  };

  const searchTrimmed = fontSearch.trim().toLowerCase();

  const allAdditionalFonts = React.useMemo(() => {
    const presetSet = new Set<string>(DEFAULT_PRESET_FONTS);
    return catalog.filter((f) => !presetSet.has(f.name));
  }, [catalog]);

  const filteredFonts = React.useMemo(() => {
    if (!searchTrimmed) {
      return allAdditionalFonts.slice(0, displayLimit);
    }
    return catalog
      .filter(
        (f) =>
          f.name.toLowerCase().includes(searchTrimmed) ||
          f.author.toLowerCase().includes(searchTrimmed) ||
          f.cardFamily.toLowerCase().includes(searchTrimmed),
      )
      .slice(0, 60);
  }, [catalog, allAdditionalFonts, searchTrimmed, displayLimit]);

  return (
    <RibbonGroup label={EDITOR_COPY.ribbon.font}>
      <Select
        value={style.fontFamily}
        disabled={disabled}
        onOpenChange={(open) => {
          if (open) loadCatalog();
        }}
        onValueChange={(value) => {
          if (value) {
            onUpdateStyle({ fontFamily: value as DeckStyle["fontFamily"] });
          }
        }}
      >
        <SelectTrigger
          aria-label={EDITOR_COPY.ribbon.font}
          className="w-36 text-xs"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent
          alignItemWithTrigger={false}
          align="start"
          className="max-h-80 w-64"
        >
          <div className="border-b border-border p-1">
            <Input
              type="text"
              placeholder={EDITOR_COPY.ribbon.fontSearch}
              value={fontSearch}
              onChange={(e) => setFontSearch(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              className="h-7 text-xs"
            />
          </div>
          {!searchTrimmed && (
            <>
              <SelectGroup>
                <SelectLabel className="px-2 py-1 text-xs text-muted-foreground">
                  {EDITOR_COPY.ribbon.presetFonts}
                </SelectLabel>
                {PRESET_FONTS.map((font) => (
                  <FontOption key={font.id} font={font} />
                ))}
              </SelectGroup>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel className="px-2 py-1 text-xs text-muted-foreground">
                  {catalog.length > 0
                    ? EDITOR_COPY.ribbon.noonnuFonts(allAdditionalFonts.length)
                    : EDITOR_COPY.ribbon.noonnuLoading}
                </SelectLabel>
                {filteredFonts.map((font) => (
                  <FontOption key={font.id} font={font} />
                ))}
                {displayLimit < allAdditionalFonts.length && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDisplayLimit((prev) => prev + 60);
                    }}
                    className="w-full py-1 text-center text-xs text-muted-foreground hover:text-foreground"
                  >
                    {EDITOR_COPY.ribbon.showMore(
                      allAdditionalFonts.length - displayLimit,
                    )}
                  </Button>
                )}
              </SelectGroup>
            </>
          )}
          {searchTrimmed && (
            <SelectGroup>
              <SelectLabel className="px-2 py-1 text-xs text-muted-foreground">
                {EDITOR_COPY.ribbon.searchResults(filteredFonts.length)}
              </SelectLabel>
              {filteredFonts.map((font) => (
                <FontOption key={font.id} font={font} />
              ))}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>

      <ButtonGroup>
        <RibbonTooltip content={EDITOR_COPY.ribbon.fontSizeTooltip}>
          <Input
            type="text"
            inputMode="numeric"
            aria-label={EDITOR_COPY.ribbon.fontSize}
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
          label={EDITOR_COPY.ribbon.fontSizeList}
          testId="font-size-list-btn"
          disabled={disabled}
          panelClassName="max-h-72 w-20 overflow-y-auto p-1"
        >
          {(close) => (
            <RibbonChoices
              label={EDITOR_COPY.ribbon.fontSizeList}
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
