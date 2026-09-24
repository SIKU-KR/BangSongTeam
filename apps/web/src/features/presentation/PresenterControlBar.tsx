import React from "react";
import type { ProjectionPeerState } from "./useProjectionChannel";

export interface PresenterControlBarProps {
  isBlackout: boolean;
  isLyricsHidden: boolean;
  onToggleBlackout: () => void;
  onToggleLyrics: () => void;
  onPrev: () => void;
  onNext: () => void;
  onOpenAudience: () => void;
  onExit: () => void;
  /** 입력 중인 번호 버퍼 (예: `12`) — 조작 창에만 표시한다 */
  buffer: string;
  /** 없는 번호 알림 (2초 뒤 사라짐) */
  invalidJump: string | null;
  peerState: ProjectionPeerState;
  audienceMessage: string | null;
  elapsed: string;
  clock: string;
}

const TOGGLE_BASE =
  "px-3 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer border";

/**
 * 조작 창 하단 바.
 *
 * 송출 종료는 단축키가 아니라 이 버튼으로만 한다 (PRD 5: "송출 종료는 단축키
 * 없이 발표자 보기의 종료 버튼으로만 한다"). 예배 중 Esc를 잘못 눌러 송출이
 * 끝나는 것을 막기 위한 규칙이다.
 */
export function PresenterControlBar({
  isBlackout,
  isLyricsHidden,
  onToggleBlackout,
  onToggleLyrics,
  onPrev,
  onNext,
  onOpenAudience,
  onExit,
  buffer,
  invalidJump,
  peerState,
  audienceMessage,
  elapsed,
  clock,
}: PresenterControlBarProps): React.JSX.Element {
  return (
    <div
      data-testid="presenter-control-bar"
      className="flex flex-col gap-2 border-t border-zinc-800 bg-zinc-900/80 px-4 py-3"
    >
      {/* 번호 입력 상태 및 안내 — 청중 화면에는 절대 나오지 않는다 */}
      <div className="flex items-center gap-3 min-h-[20px]">
        {buffer && (
          <span
            data-testid="presenter-buffer"
            className="text-sm font-mono text-emerald-400 tabular-nums"
          >
            {buffer}_
          </span>
        )}
        {invalidJump && (
          <span
            data-testid="presenter-invalid-jump"
            role="status"
            className="text-sm text-amber-400"
          >
            없는 번호입니다: {invalidJump}
          </span>
        )}
        {audienceMessage && (
          <span
            data-testid="presenter-audience-message"
            className="text-xs text-zinc-400"
          >
            {audienceMessage}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="presenter-prev-btn"
          onClick={onPrev}
          className={`${TOGGLE_BASE} border-zinc-700 text-zinc-200 hover:bg-zinc-800`}
        >
          ← 이전
        </button>
        <button
          type="button"
          data-testid="presenter-next-btn"
          onClick={onNext}
          className={`${TOGGLE_BASE} border-zinc-700 text-zinc-200 hover:bg-zinc-800`}
        >
          다음 →
        </button>

        <span className="w-px h-6 bg-zinc-800 mx-1" />

        <button
          type="button"
          data-testid="presenter-blackout-btn"
          aria-pressed={isBlackout}
          onClick={onToggleBlackout}
          className={`${TOGGLE_BASE} ${
            isBlackout
              ? "border-amber-400 bg-amber-400 text-zinc-950"
              : "border-zinc-700 text-zinc-200 hover:bg-zinc-800"
          }`}
        >
          블랙아웃 (B)
        </button>
        <button
          type="button"
          data-testid="presenter-lyrics-btn"
          aria-pressed={isLyricsHidden}
          onClick={onToggleLyrics}
          className={`${TOGGLE_BASE} ${
            isLyricsHidden
              ? "border-sky-400 bg-sky-400 text-zinc-950"
              : "border-zinc-700 text-zinc-200 hover:bg-zinc-800"
          }`}
        >
          가사 숨기기 (H)
        </button>

        <div className="ml-auto flex items-center gap-3">
          <span
            data-testid="presenter-timer"
            className="text-sm tabular-nums text-zinc-300"
          >
            {elapsed}
            <span className="ml-2 text-zinc-500">{clock}</span>
          </span>

          <span
            data-testid="presenter-peer-state"
            data-state={peerState}
            className={`text-xs px-2 py-1 rounded-full ${
              peerState === "connected"
                ? "bg-emerald-500/15 text-emerald-400"
                : "bg-zinc-800 text-zinc-400"
            }`}
          >
            {peerState === "connected" ? "송출 창 연결됨" : "송출 창 없음"}
          </span>

          <button
            type="button"
            data-testid="presenter-open-audience-btn"
            onClick={onOpenAudience}
            className={`${TOGGLE_BASE} border-zinc-700 text-zinc-200 hover:bg-zinc-800`}
          >
            {peerState === "connected" ? "송출 창 다시 연결" : "송출 창 열기"}
          </button>
          <button
            type="button"
            data-testid="presenter-exit-btn"
            onClick={onExit}
            className={`${TOGGLE_BASE} border-red-500/60 text-red-400 hover:bg-red-500/10`}
          >
            송출 종료
          </button>
        </div>
      </div>
    </div>
  );
}
