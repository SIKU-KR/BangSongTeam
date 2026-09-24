import React, { useEffect, useRef } from "react";
import type { PresentationItem } from "@repo/shared";
import { slideNumberOf, type ProjectionPosition } from "./projectionState";

export interface PresenterJumpPanelProps {
  songs: readonly PresentationItem[];
  position: ProjectionPosition;
  onJump: (songIndex: number, slideIndex: number) => void;
}

/**
 * 곡·슬라이드 점프 패널.
 *
 * 슬라이드 칩에 세트 전체에서 1부터 이어지는 번호를 표시한다 (PPT식, PRD 5).
 * 이 번호가 곧 숫자 키패드로 치는 `N`이므로, 화면에 보이는 번호와 키패드 입력이
 * 어긋나면 조작자가 예배 중에 엉뚱한 슬라이드를 띄운다.
 */
export function PresenterJumpPanel({
  songs,
  position,
  onJump,
}: PresenterJumpPanelProps): React.JSX.Element {
  const activeRef = useRef<HTMLLIElement | null>(null);

  // 세트가 길어도 현재 곡이 보이게 따라간다.
  // jsdom에는 scrollIntoView가 없다 — 없다고 조작 창이 죽으면 안 된다.
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [position.songIndex]);

  return (
    <nav
      data-testid="presenter-jump-panel"
      aria-label="곡 및 슬라이드 이동"
      className="h-full overflow-y-auto"
    >
      <ul className="flex flex-col gap-2">
        {songs.map((item, songIndex) => {
          const deck = item.deck;
          const isActiveSong = songIndex === position.songIndex;

          return (
            <li
              key={item.id}
              ref={isActiveSong ? activeRef : undefined}
              data-testid="presenter-jump-song"
              className={`rounded-lg border p-2.5 transition-colors ${
                isActiveSong
                  ? "border-emerald-500/60 bg-emerald-500/10"
                  : "border-zinc-800 bg-zinc-900/60"
              }`}
            >
              <button
                type="button"
                data-testid={`presenter-jump-song-${songIndex}`}
                onClick={() => onJump(songIndex, 0)}
                className="w-full flex items-baseline gap-2 text-left cursor-pointer"
              >
                <span className="text-sm font-medium truncate text-zinc-100">
                  {deck?.title ?? "(제목 없음)"}
                </span>
                <span className="ml-auto text-[11px] text-zinc-500 shrink-0">
                  {deck?.slides.length ?? 0}장
                </span>
              </button>

              <div className="mt-2 flex flex-wrap gap-1">
                {(deck?.slides ?? []).map((slide, slideIndex) => {
                  const isActiveSlide =
                    isActiveSong && slideIndex === position.slideIndex;
                  return (
                    <button
                      key={slide.id}
                      type="button"
                      data-testid={`presenter-jump-slide-${songIndex}-${slideIndex}`}
                      title={slide.lines.join(" / ")}
                      onClick={() => onJump(songIndex, slideIndex)}
                      className={`min-w-7 h-7 px-1 rounded text-[11px] tabular-nums transition-colors cursor-pointer ${
                        isActiveSlide
                          ? "bg-emerald-500 text-zinc-950 font-semibold"
                          : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                      }`}
                    >
                      {slideNumberOf({ songIndex, slideIndex }, songs)}
                    </button>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
