import React from "react";
import { DEFAULT_DECK_STYLE } from "@repo/shared";
import type { PresentationItem } from "@repo/shared";
import { SlideStage } from "../../components/stage/SlideStage";
import {
  getSlideAt,
  getTotalSlideCount,
  peekNext,
  slideNumberOf,
  type ProjectionPosition,
} from "./projectionState";

export interface PresenterPreviewPanelProps {
  songs: readonly PresentationItem[];
  position: ProjectionPosition;
  isBlackout: boolean;
  isLyricsHidden: boolean;
}

/**
 * 조작 창의 현재·다음 슬라이드 미리보기.
 *
 * 청중 화면과 같은 `SlideStage`(3-Layer)를 그대로 쓴다. 조작 창에서만 다른
 * 렌더러를 쓰면 조작자가 보는 것과 청중이 보는 것이 달라져, 넘침이나 위치
 * 문제를 예배 중에야 알게 된다.
 */
/**
 * 미리보기 상자.
 *
 * `aspect-video`로 높이를 강제하지 않는다. 조작 창 높이가 모자라면 그 높이가
 * 넘쳐 아래 조작 바를 덮어 버리고, 블랙아웃 버튼이 눌리지 않는다(2026-09-22
 * 실제 Chrome 렌더에서 확인). 대신 주어진 상자를 꽉 채우고, 16:9 비율은
 * `SlideStage`가 내부에서 레터박스로 맞춘다.
 */
function StagePreview({
  songs,
  position,
  isBlackout,
  isLyricsHidden,
}: {
  songs: readonly PresentationItem[];
  position: ProjectionPosition | null;
  isBlackout: boolean;
  isLyricsHidden: boolean;
}): React.JSX.Element {
  if (!position) {
    return (
      <div className="w-full h-full rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-500 text-sm">
        마지막 슬라이드입니다
      </div>
    );
  }

  const deck = songs[position.songIndex]?.deck;
  return (
    <div className="w-full h-full rounded-lg overflow-hidden border border-zinc-800 bg-black">
      <SlideStage
        slide={getSlideAt(position, songs)}
        style={deck?.style ?? DEFAULT_DECK_STYLE}
        isBlackout={isBlackout}
        isLyricsHidden={isLyricsHidden}
      />
    </div>
  );
}

export function PresenterPreviewPanel({
  songs,
  position,
  isBlackout,
  isLyricsHidden,
}: PresenterPreviewPanelProps): React.JSX.Element {
  const next = peekNext(position, songs);
  const currentSong = songs[position.songIndex]?.deck;
  const nextSong = next ? songs[next.songIndex]?.deck : undefined;
  const isNextNewSong = next ? next.songIndex !== position.songIndex : false;
  // 숫자 키패드로 치는 번호와 같은 세트 전체 번호 (PPT식)
  const currentNumber = slideNumberOf(position, songs);
  const nextNumber = next ? slideNumberOf(next, songs) : null;
  const totalSlides = getTotalSlideCount(songs);

  return (
    <div
      data-testid="presenter-preview-panel"
      className="flex flex-col gap-3 h-full min-h-0"
    >
      <section className="flex-1 min-h-0 flex flex-col">
        <header className="flex items-baseline justify-between mb-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-emerald-400">
            현재
          </h2>
          <span
            data-testid="presenter-current-label"
            className="text-xs text-zinc-400 tabular-nums"
          >
            {currentNumber !== null && `${currentNumber} / ${totalSlides} `}
            {currentSong?.title ?? ""}
          </span>
        </header>
        <div data-testid="presenter-current-stage" className="flex-1 min-h-0">
          <StagePreview
            songs={songs}
            position={position}
            isBlackout={isBlackout}
            isLyricsHidden={isLyricsHidden}
          />
        </div>
      </section>

      <section className="h-[30%] min-h-[96px] flex flex-col">
        <header className="flex items-baseline justify-between mb-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            다음
          </h2>
          <span
            data-testid="presenter-next-label"
            className="text-xs text-zinc-500 tabular-nums"
          >
            {next
              ? `${nextNumber ?? ""} ${
                  isNextNewSong ? (nextSong?.title ?? "") : ""
                }`.trim()
              : "—"}
          </span>
        </header>
        <div
          data-testid="presenter-next-stage"
          className="flex-1 min-h-0 max-w-[60%] opacity-80"
        >
          {/* 다음 슬라이드 미리보기는 블랙아웃·가사 숨김의 영향을 받지 않는다.
              조작자는 지금 청중에게 안 보이더라도 다음에 무엇이 나올지 알아야 한다. */}
          <StagePreview
            songs={songs}
            position={next}
            isBlackout={false}
            isLyricsHidden={false}
          />
        </div>
      </section>
    </div>
  );
}
