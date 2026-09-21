import React from "react";
import type { Slide, DeckStyle } from "@repo/shared";
import { SlideStage } from "../../components/stage/SlideStage";

export interface SlideFilmstripProps {
  slides: Slide[];
  activeSlideIndex: number;
  onSelectSlide: (index: number) => void;
  onAddSlide: () => void;
  onDuplicateSlide?: (index: number) => void;
  onDeleteSlide?: (index: number) => void;
  songStyle?: DeckStyle;
  backgroundUrl?: string;
  posterUrl?: string;
  zoomLevel?: number;
  onZoomChange?: (zoom: number) => void;
  className?: string;
}

/**
 * Canva 스타일 하단 슬라이드 썸네일 스트립 (Filmstrip)
 * - 슬라이드 가로 스크롤 카드 스트립
 * - 활성 슬라이드 하이라이트 (Emerald Ring)
 * - 슬라이드 번호 및 가사 텍스트 요약
 * - 슬라이드 추가(+), 복제, 삭제 기능
 */
export function SlideFilmstrip({
  slides,
  activeSlideIndex,
  onSelectSlide,
  onAddSlide,
  onDuplicateSlide,
  onDeleteSlide,
  songStyle,
  backgroundUrl,
  posterUrl,
  zoomLevel = 100,
  onZoomChange,
  className = "",
}: SlideFilmstripProps): React.JSX.Element {
  return (
    <div
      data-testid="slide-filmstrip"
      className={`h-36 bg-zinc-950 border-t border-zinc-800/80 flex flex-col justify-between select-none ${className}`}
    >
      {/* 상단 툴바: 슬라이드 카운터 및 줌 컨트롤 */}
      <div className="px-4 py-1.5 flex items-center justify-between text-xs text-zinc-400 border-b border-zinc-900 bg-zinc-900/30">
        <div className="flex items-center gap-3">
          <span className="font-medium text-zinc-300">
            슬라이드 스트립 ({slides.length}장)
          </span>
          <span className="text-[11px] text-zinc-500 font-mono">
            선택: {activeSlideIndex + 1} / {slides.length}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {onZoomChange && (
            <div className="flex items-center gap-1 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800 text-[11px]">
              <button
                type="button"
                onClick={() => onZoomChange(Math.max(50, zoomLevel - 15))}
                className="hover:text-white px-1 cursor-pointer"
                title="축소"
              >
                -
              </button>
              <span className="w-10 text-center font-mono">{zoomLevel}%</span>
              <button
                type="button"
                onClick={() => onZoomChange(Math.min(150, zoomLevel + 15))}
                className="hover:text-white px-1 cursor-pointer"
                title="확대"
              >
                +
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 슬라이드 가로 스크롤 카드 목록 */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden px-4 py-2 flex items-center gap-3 scrollbar-thin">
        {slides.map((slide, index) => {
          const isActive = index === activeSlideIndex;
          const previewText = slide.lines[0] || "(빈 슬라이드)";

          return (
            <div
              key={slide.id || index}
              data-testid={`slide-strip-item-${index}`}
              onClick={() => onSelectSlide(index)}
              className={`group relative flex flex-col shrink-0 rounded-lg overflow-hidden cursor-pointer transition-all duration-150 ${
                isActive
                  ? "ring-2 ring-emerald-500 shadow-lg shadow-emerald-950/60"
                  : "hover:ring-1 hover:ring-zinc-600 opacity-80 hover:opacity-100"
              }`}
              style={{ width: "148px", height: "83px" }}
            >
              {/* 16:9 축소 슬라이드 프리뷰 */}
              <div className="w-full h-full bg-black relative overflow-hidden pointer-events-none">
                <SlideStage
                  slide={slide}
                  style={songStyle}
                  backgroundUrl={backgroundUrl}
                  posterUrl={posterUrl}
                />
              </div>

              {/* 번호 배지 */}
              <div className="absolute top-1 left-1 z-20 px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-black/80 text-white border border-zinc-700/50">
                {index + 1}
              </div>

              {/* 하단 가사 텍스트 요약 툴팁형태 */}
              <div className="absolute bottom-0 inset-x-0 bg-black/75 px-1.5 py-0.5 text-[9px] text-zinc-300 truncate pointer-events-none">
                {previewText}
              </div>

              {/* 호버 액션: 복제/삭제 */}
              <div className="absolute top-1 right-1 z-20 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-black/80 p-0.5 rounded border border-zinc-700">
                {onDuplicateSlide && (
                  <button
                    type="button"
                    data-testid={`duplicate-slide-btn-${index}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDuplicateSlide(index);
                    }}
                    className="p-0.5 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded transition-colors cursor-pointer"
                    title="슬라이드 복제"
                  >
                    <svg
                      className="w-3 h-3"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                      />
                    </svg>
                  </button>
                )}
                {onDeleteSlide && slides.length > 1 && (
                  <button
                    type="button"
                    data-testid={`delete-slide-btn-${index}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteSlide(index);
                    }}
                    className="p-0.5 text-zinc-400 hover:text-red-400 hover:bg-zinc-700 rounded transition-colors cursor-pointer"
                    title="슬라이드 삭제"
                  >
                    <svg
                      className="w-3 h-3"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {/* 새 슬라이드 추가 버튼 */}
        <button
          type="button"
          data-testid="add-slide-filmstrip-btn"
          onClick={onAddSlide}
          className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-800 hover:border-emerald-500/70 hover:bg-zinc-900/50 text-zinc-500 hover:text-emerald-400 transition-colors shrink-0 cursor-pointer"
          style={{ width: "148px", height: "83px" }}
          title="새 슬라이드 추가"
        >
          <svg
            className="w-5 h-5 mb-1"
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
          <span className="text-[11px] font-medium">슬라이드 추가</span>
        </button>
      </div>
    </div>
  );
}
