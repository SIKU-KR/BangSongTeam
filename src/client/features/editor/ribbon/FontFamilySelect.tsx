import React, { useEffect, useState } from "react";
import { Button } from "#components/ui/button";
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
import {
  FONT_LIST_PAGE_SIZE,
  FONT_SEARCH_RESULT_LIMIT,
  excludePresetFonts,
  searchFonts,
} from "./ribbonOptions";
import { EDITOR_COPY } from "#copy/editor";

interface FontFamilySelectProps {
  value: DeckStyle["fontFamily"];
  disabled: boolean;
  onChange: (fontFamily: DeckStyle["fontFamily"]) => void;
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

function fontPreviewPath(id: string): string {
  return `/font-previews/${id}.webp`;
}

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
          maskImage: `url("${fontPreviewPath(font.id)}")`,
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
 * 리본 글꼴 선택 드롭다운. 눈누 카탈로그는 별도 청크라 드롭다운을 처음 열 때 불러온다.
 *
 * 글꼴 목록은 폰트 파일 대신 `scripts/buildFontPreviews.mjs`가 미리 그려 둔 이름 이미지
 * (`/font-previews/<id>.webp`)를 mask로 보여 준다. 한글 폰트는 파일 하나가 수 MB라 목록을
 * 그 글꼴로 그리면 드롭다운 하나로 수십~수백 MB를 받는다. 폰트 파일은 고른 글꼴만 받는다.
 */
export function FontFamilySelect({
  value,
  disabled,
  onChange,
}: FontFamilySelectProps): React.JSX.Element {
  const [fontSearch, setFontSearch] = useState("");
  const [displayLimit, setDisplayLimit] = useState(FONT_LIST_PAGE_SIZE);

  const [catalog, setCatalog] = useState<readonly NoonnuFont[]>([]);

  useEffect(() => {
    if (value) {
      void loadWebFont(value);
    }
  }, [value]);

  const loadCatalog = (): void => {
    if (catalog.length === 0) void loadNoonnuFontCatalog().then(setCatalog);
  };

  const isSearching = fontSearch.trim() !== "";

  const allAdditionalFonts = React.useMemo(
    () => excludePresetFonts(catalog),
    [catalog],
  );

  const filteredFonts = React.useMemo(() => {
    if (!isSearching) {
      return allAdditionalFonts.slice(0, displayLimit);
    }
    return searchFonts(catalog, fontSearch, FONT_SEARCH_RESULT_LIMIT);
  }, [catalog, allAdditionalFonts, isSearching, fontSearch, displayLimit]);

  return (
    <Select
      value={value}
      disabled={disabled}
      onOpenChange={(open) => {
        if (open) loadCatalog();
      }}
      onValueChange={(next) => {
        if (next) {
          onChange(next as DeckStyle["fontFamily"]);
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
        {!isSearching && (
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
                    setDisplayLimit((prev) => prev + FONT_LIST_PAGE_SIZE);
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
        {isSearching && (
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
  );
}
