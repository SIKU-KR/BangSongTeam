import React from "react";
import type { Deck, DeckStyle } from "#shared";
import { DEFAULT_DECK_STYLE } from "#shared";
import type { BackgroundChoice } from "../../presentation/presentationStore";
import { BackgroundControls } from "./BackgroundControls";
import { FontControls } from "./FontControls";
import { ParagraphControls } from "./ParagraphControls";
import { RibbonDivider, RibbonTooltip } from "./RibbonPrimitives";
import { SlideControls, type SlideControlsProps } from "./SlideControls";
import { EDITOR_COPY } from "#copy/editor";

interface EditorRibbonProps {
  song: Deck | null | undefined;
  slideControls: SlideControlsProps;
  /** `coalesceField`가 같은 연속 변경(슬라이더 끌기)은 되돌리기 한 단계로 묶는다 */
  onUpdateStyle: (update: Partial<DeckStyle>, coalesceField?: string) => void;
  /** `songId`는 배경 선택 창을 연 때의 곡이다 */
  onUpdateBackground: (songId: string, choice: BackgroundChoice) => void;
}

/**
 * 편집기 상단 리본 도구 모음 (PowerPoint '홈' 탭 방식). 서식은 곡 단위라 현재 곡의
 * 모든 슬라이드에 적용되며, 곡이 없으면 모든 컨트롤을 끈다.
 *
 * md 이상은 컨트롤 묶음이 줄을 바꿔 모두 보인다. 폰 폭에서는 줄을 바꾸면 리본이 화면의 3분의 1을
 * 차지하고, 한 줄에 두면 폭이 모자라 글자 색·그림자가 잘리므로 한 줄에서 가로로 스크롤한다.
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
      className="flex shrink-0 flex-wrap items-stretch gap-y-1 border-b bg-background px-2 py-1 select-none max-md:flex-nowrap max-md:overflow-x-auto max-md:*:shrink-0"
    >
      <SlideControls {...slideControls} />
      <RibbonDivider />
      <RibbonTooltip content={EDITOR_COPY.song.formatTooltip}>
        <div
          data-testid="ribbon-song-label"
          className="max-w-40 self-center px-2 text-xs/tight text-muted-foreground"
        >
          {song ? (
            <>
              <span className="block truncate font-semibold text-foreground">
                ‘{song.title}’
              </span>
              <span>{EDITOR_COPY.song.songFormat}</span>
            </>
          ) : (
            <span>{EDITOR_COPY.song.noSong}</span>
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
        songId={song?.id}
        backgroundId={song?.backgroundId}
        disabled={disabled}
        onUpdateStyle={onUpdateStyle}
        onUpdateBackground={onUpdateBackground}
      />
    </div>
  );
}
