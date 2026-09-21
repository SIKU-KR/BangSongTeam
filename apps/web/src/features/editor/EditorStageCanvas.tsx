import React, { useState } from "react";
import type { Slide, DeckStyle } from "@repo/shared";
import { SlideStage } from "../../components/stage/SlideStage";

export interface EditorStageCanvasProps {
  slide?: Slide | null;
  style?: DeckStyle;
  backgroundUrl?: string;
  posterUrl?: string;
  songTitle?: string;
  slideIndex: number;
  totalSlides: number;
  onPrevSlide: () => void;
  onNextSlide: () => void;
  onPresent: () => void;
  className?: string;
}

/**
 * Canva / MiriCanvas 스타일 중앙 16:9 슬라이드 캔버스 작업 공간
 * - 16:9 비율 유지 프레젠테이션 스테이지 (Drop shadow & Framed)
 * - 리허설 모드 (암전 테스트, 가사 숨김 테스트)
 * - 슬라이드 넘김(이전/다음) 인터랙티브 버튼
 */
export function EditorStageCanvas({
  slide,
  style,
  backgroundUrl,
  posterUrl,
  songTitle = "곡 제목",
  slideIndex,
  totalSlides,
  onPrevSlide,
  onNextSlide,
  onPresent,
  className = "",
}: EditorStageCanvasProps): React.JSX.Element {
  const [isBlackout, setIsBlackout] = useState(false);
  const [isLyricsHidden, setIsLyricsHidden] = useState(false);

  return (
    <div
      data-testid="editor-stage-canvas"
      className={`relative flex-1 bg-zinc-900/60 overflow-hidden flex flex-col items-center justify-center p-6 select-none ${className}`}
    >
      {/* 캔버스 상단 안내 바 */}
      <div className="w-full max-w-4xl mb-3 flex items-center justify-between text-xs text-zinc-400">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-zinc-300">{songTitle}</span>
          <span className="px-2 py-0.5 rounded bg-zinc-800 text-[11px] font-mono text-zinc-400">
            {slideIndex + 1} / {totalSlides}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-zinc-500">
            16:9 와이드스크린 (1920 × 1080)
          </span>
        </div>
      </div>

      {/* 16:9 슬라이드 스테이지 컨테이너 (실제 프레젠테이션 시각적 룩앤필) */}
      <div className="relative w-full max-w-4xl aspect-video rounded-xl overflow-hidden shadow-2xl shadow-black ring-1 ring-zinc-800 bg-black group">
        <SlideStage
          slide={slide}
          style={style}
          backgroundUrl={backgroundUrl}
          posterUrl={posterUrl}
          isBlackout={isBlackout}
          isLyricsHidden={isLyricsHidden}
        />

        {/* 좌우 슬라이드 넘김 호버 화살표 */}
        <button
          type="button"
          data-testid="canvas-prev-btn"
          disabled={slideIndex <= 0}
          onClick={onPrevSlide}
          className="absolute left-3 top-1/2 -translate-y-1/2 z-40 w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center backdrop-blur-sm border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0 cursor-pointer shadow-lg"
          title="이전 슬라이드 (◀)"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>

        <button
          type="button"
          data-testid="canvas-next-btn"
          disabled={slideIndex >= totalSlides - 1}
          onClick={onNextSlide}
          className="absolute right-3 top-1/2 -translate-y-1/2 z-40 w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center backdrop-blur-sm border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0 cursor-pointer shadow-lg"
          title="다음 슬라이드 (▶)"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </button>
      </div>

      {/* 캔버스 하단 리허설 및 빠른 송출 도구 */}
      <div className="w-full max-w-4xl mt-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* 암전 테스트 토글 */}
          <button
            type="button"
            data-testid="test-blackout-btn"
            onClick={() => setIsBlackout((prev) => !prev)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 border cursor-pointer ${
              isBlackout
                ? "bg-zinc-800 text-amber-400 border-amber-500/50 shadow"
                : "bg-zinc-950/80 text-zinc-400 border-zinc-800 hover:text-white"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${isBlackout ? "bg-amber-400 animate-pulse" : "bg-zinc-600"}`}
            />
            <span>암전(B) {isBlackout ? "해제" : "테스트"}</span>
          </button>

          {/* 가사 숨김 테스트 토글 */}
          <button
            type="button"
            data-testid="test-lyrics-btn"
            onClick={() => setIsLyricsHidden((prev) => !prev)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 border cursor-pointer ${
              isLyricsHidden
                ? "bg-zinc-800 text-sky-400 border-sky-500/50 shadow"
                : "bg-zinc-950/80 text-zinc-400 border-zinc-800 hover:text-white"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${isLyricsHidden ? "bg-sky-400 animate-pulse" : "bg-zinc-600"}`}
            />
            <span>가사숨김(H) {isLyricsHidden ? "해제" : "테스트"}</span>
          </button>
        </div>

        {/* 전체화면 바로보기 */}
        <button
          type="button"
          data-testid="canvas-present-cta"
          onClick={onPresent}
          className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 hover:text-white border border-zinc-700 flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <svg
            className="w-3.5 h-3.5 text-emerald-400"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
          <span>전체화면 발표</span>
        </button>
      </div>
    </div>
  );
}
