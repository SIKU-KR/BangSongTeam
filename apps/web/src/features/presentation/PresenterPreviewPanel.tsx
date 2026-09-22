import React from "react";
import { DEFAULT_DECK_STYLE } from "@repo/shared";
import type { PresentationItem } from "@repo/shared";
import { SlideStage } from "../../components/stage/SlideStage";
import {
  getSlideAt,
  peekNext,
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
      <div className="w-full aspect-video rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-500 text-sm">
        마지막 슬라이드입니다
      </div>
    );
  }

  const deck = songs[position.songIndex]?.deck;
  return (
    <div className="w-full aspect-video rounded-lg overflow-hidden border border-zinc-800 bg-black">
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

  return (
    <div
      data-testid="presenter-preview-panel"
      className="flex flex-col gap-4"
    >
      <section>
        <header className="flex items-baseline justify-between mb-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-emerald-400">
            현재
          </h2>
          <span
            data-testid="presenter-current-label"
            className="text-xs text-zinc-400 tabular-nums"
          >
            {position.songIndex + 1}.{position.slideIndex + 1}{" "}
            {currentSong?.title ?? ""}
          </span>
        </header>
        <div data-testid="presenter-current-stage">
          <StagePreview
            songs={songs}
            position={position}
            isBlackout={isBlackout}
            isLyricsHidden={isLyricsHidden}
          />
        </div>
      </section>

      <section>
        <header className="flex items-baseline justify-between mb-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            다음
          </h2>
          <span
            data-testid="presenter-next-label"
            className="text-xs text-zinc-500 tabular-nums"
          >
            {next
              ? `${next.songIndex + 1}.${next.slideIndex + 1} ${
                  isNextNewSong ? (nextSong?.title ?? "") : ""
                }`.trim()
              : "—"}
          </span>
        </header>
        <div
          data-testid="presenter-next-stage"
          className="max-w-[60%] opacity-80"
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
