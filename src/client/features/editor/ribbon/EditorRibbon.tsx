import React from "react";
import type { Deck, DeckStyle } from "#shared";
import { DEFAULT_DECK_STYLE } from "#shared";
import { BackgroundControls } from "./BackgroundControls";
import { FontControls } from "./FontControls";
import { ParagraphControls } from "./ParagraphControls";
import { RibbonDivider, RibbonTooltip } from "./RibbonPrimitives";
import { SlideControls, type SlideControlsProps } from "./SlideControls";

export interface EditorRibbonProps {
  song: Deck | null | undefined;
  slideControls: SlideControlsProps;
  /** `coalesceField`가 같은 연속 변경(슬라이더 끌기)은 되돌리기 한 단계로 묶는다 */
  onUpdateStyle: (update: Partial<DeckStyle>, coalesceField?: string) => void;
  onUpdateBackground: (backgroundId: string | null) => void;
}

/**
 * 편집기 상단 리본 도구 모음 (PowerPoint '홈' 탭 방식). 서식은 곡 단위라 현재 곡의
 * 모든 슬라이드에 적용되며, 곡이 없으면 모든 컨트롤을 끈다.
 */
export function EditorRibbon({
  song,
  slideControls,
  onUpdateStyle,
  onUpdateBackground,
}: EditorRibbonProps): React.JSX.Element {
  const style = song?.style ?? DEFAULT_DECK_STYLE;
  const disabled = !song;

  return (
    <div
      data-testid="editor-ribbon"
      className="flex shrink-0 flex-wrap items-stretch gap-y-1 border-b bg-background px-2 py-1 select-none"
    >
      <SlideControls {...slideControls} />
      <RibbonDivider />
      <RibbonTooltip content="서식은 현재 곡의 모든 슬라이드에 적용됩니다">
        <div
          data-testid="ribbon-song-label"
          className="max-w-40 self-center px-2 text-2xs/tight text-muted-foreground"
        >
          {song ? (
            <>
              <span className="block truncate font-semibold text-foreground">
                ‘{song.title}’
              </span>
              <span>곡 서식</span>
            </>
          ) : (
            <span>곡 없음</span>
          )}
        </div>
      </RibbonTooltip>
      <FontControls
        style={style}
        disabled={disabled}
        onUpdateStyle={onUpdateStyle}
      />
      <RibbonDivider />
      <ParagraphControls
        style={style}
        disabled={disabled}
        onUpdateStyle={onUpdateStyle}
      />
      <RibbonDivider />
      <BackgroundControls
        style={style}
        backgroundId={song?.backgroundId}
        disabled={disabled}
        onUpdateStyle={onUpdateStyle}
        onUpdateBackground={onUpdateBackground}
      />
    </div>
  );
}
