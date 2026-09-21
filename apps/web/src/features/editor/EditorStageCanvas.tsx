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
  zoomLevel?: number;
  onZoomChange?: (zoom: number) => void;
  onResetSetlist?: () => void;
  onOpenLyricModal?: () => void;
  className?: string;
}

/**
 * Canva / MiriCanvas 스타일 중앙 16:9 슬라이드 캔버스 작업 공간
 * - 16:9 비율 유지 프레젠테이션 스테이지 (Drop shadow & Framed & Zoom Scale)
 * - 슬라이드 없음 / 빈 세트 예외 상태(Empty State) 완벽 방어
 * - 리허설 모드 (암전 테스트, 가사 숨김 테스트)
 * - 슬라이드 넘김(이전/다음) 인터랙티브 버튼
 * - 캔버스 줌 레벨 조절 (- / + / 100% 맞춤)
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
  zoomLevel = 100,
  onZoomChange,
  onResetSetlist,
  onOpenLyricModal,
  className = "",
}: EditorStageCanvasProps): React.JSX.Element {
  const [isBlackout, setIsBlackout] = useState(false);
  const [isLyricsHidden, setIsLyricsHidden] = useState(false);

  // 빈 상태 (등록된 곡 또는 슬라이드가 없을 때)
  if (!slide || totalSlides === 0) {
    return (
      <div
        data-testid="editor-stage-canvas"
        className={`relative flex-1 bg-zinc-900/60 overflow-hidden flex flex-col items-center justify-center p-6 select-none ${className}`}
      >
        <div className="w-full max-w-xl p-8 rounded-2xl bg-zinc-950/80 border border-zinc-800 text-center flex flex-col items-center gap-4 shadow-2xl">
          <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-700/60 flex items-center justify-center text-emerald-400">
            <svg className="w-8 h-8 fill-current" viewBox="0 0 24 24">
              <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z" />
            </svg>
          </div>

          <div>
            <h3 className="text-lg font-bold text-white">
              등록된 찬양 곡 또는 슬라이드가 없습니다
            </h3>
            <p className="text-xs text-zinc-400 mt-1 max-w-md">
              새 찬양 가사를 빠른 입력으로 추가하거나, 기본 찬양 콘티를 불러와
              프레젠테이션 제작을 시작하세요.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            {onOpenLyricModal && (
              <button
                type="button"
                onClick={onOpenLyricModal}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-950/50 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4v16m8-8H4"
                  />
                </svg>
                <span>가사 붙여넣기로 새 곡 추가</span>
              </button>
            )}

            {onResetSetlist && (
              <button
                type="button"
                onClick={onResetSetlist}
                className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white border border-zinc-700 font-medium text-xs transition-colors cursor-pointer"
              >
                기본 5곡 세트 불러오기
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const zoomScale = zoomLevel / 100;

  return (
    <div
      data-testid="editor-stage-canvas"
      className={`relative flex-1 bg-zinc-900/60 overflow-hidden flex flex-col items-center justify-between p-6 select-none ${className}`}
    >
      {/* 캔버스 상단 안내 바 */}
      <div className="w-full max-w-4xl mb-2 flex items-center justify-between text-xs text-zinc-400 shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-zinc-200">{songTitle}</span>
          <span className="px-2 py-0.5 rounded bg-zinc-800 text-[11px] font-mono text-zinc-300">
            {slideIndex + 1} / {totalSlides}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-zinc-500">
            16:9 와이드스크린 (1920 × 1080)
          </span>
        </div>
      </div>

      {/* 중앙: 16:9 슬라이드 스테이지 컨테이너 (Zoom Scale 적용) */}
      <div className="flex-1 w-full flex items-center justify-center overflow-hidden py-2">
        <div
          className="relative w-full max-w-4xl aspect-video rounded-xl overflow-hidden shadow-2xl shadow-black ring-1 ring-zinc-800 bg-black group transition-transform duration-150"
          style={{
            transform: `scale(${zoomScale})`,
            transformOrigin: "center center",
          }}
        >
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
      </div>

      {/* 캔버스 하단 리허설 및 줌/송출 도구 */}
      <div className="w-full max-w-4xl mt-2 flex items-center justify-between shrink-0">
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

        {/* 줌 컨트롤 */}
        {onZoomChange && (
          <div className="hidden sm:flex items-center gap-1 bg-zinc-950/90 border border-zinc-800 rounded-lg px-2 py-1 text-xs text-zinc-400">
            <button
              type="button"
              onClick={() => onZoomChange(Math.max(50, zoomLevel - 15))}
              className="hover:text-white px-1 font-bold cursor-pointer"
              title="캔버스 축소"
            >
              -
            </button>
            <span className="w-12 text-center font-mono text-zinc-200">
              {zoomLevel}%
            </span>
            <button
              type="button"
              onClick={() => onZoomChange(Math.min(150, zoomLevel + 15))}
              className="hover:text-white px-1 font-bold cursor-pointer"
              title="캔버스 확대"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => onZoomChange(100)}
              className="ml-1 pl-1.5 border-l border-zinc-800 text-[11px] text-zinc-500 hover:text-zinc-200 cursor-pointer"
              title="100% 원본 맞춤"
            >
              맞춤
            </button>
          </div>
        )}

        {/* 전체화면 바로보기 */}
        <button
          type="button"
          data-testid="canvas-present-cta"
          onClick={onPresent}
          className="px-3.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 hover:text-white border border-zinc-700 flex items-center gap-1.5 transition-colors cursor-pointer"
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
