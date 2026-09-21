import React from "react";
import type { Deck, Presentation } from "@repo/shared";
import {
  getBackgroundMediaUrl,
  getBackgroundPosterUrl,
  DEFAULT_DECK_STYLE,
} from "@repo/shared";
import { SlideStage } from "../../components/stage/SlideStage";

export interface PresentationCardProps {
  /** 단일 덱 또는 세트리스트 */
  deck?: Deck | null;
  presentation?: Presentation | null;
  /** 발표(슬라이드쇼) 클릭 핸들러 */
  onPresent: () => void;
  /** 편집 클릭 핸들러 */
  onEdit: () => void;
  /** 복제 클릭 핸들러 (선택) */
  onDuplicate?: () => void;
  /** 삭제 클릭 핸들러 (선택) */
  onDelete?: () => void;
  className?: string;
}

/**
 * Canva / MiriCanvas 스타일 16:9 프레젠테이션 카드 컴포넌트
 * - 16:9 와이드스크린 썸네일 미리보기 (SlideStage 기반)
 * - 16:9 비율 배지 및 슬라이드 수 배지
 * - 호버 시 나타나는 '슬라이드쇼 발표' 및 '편집하기' 퀵 액션
 * - 하단 메타데이터(제목, 아티스트/구성 곡, 최근 수정일)
 */
export function PresentationCard({
  deck,
  presentation,
  onPresent,
  onEdit,
  onDuplicate,
  onDelete,
  className = "",
}: PresentationCardProps): React.JSX.Element {
  // 덱 또는 세트리스트 대표 정보 추출
  const isPresentation = Boolean(presentation);
  const title = presentation?.title ?? deck?.title ?? "제목 없는 프레젠테이션";
  const artistOrSummary = isPresentation
    ? presentation?.items
        .map((i) => i.deck?.title)
        .filter(Boolean)
        .slice(0, 3)
        .join(", ") +
      (presentation && presentation.items.length > 3
        ? ` 외 ${presentation.items.length - 3}곡`
        : "")
    : deck?.artist || "찬양 곡";

  const totalSlides = isPresentation
    ? (presentation?.items.reduce(
        (sum, item) => sum + (item.deck?.slides.length ?? 0),
        0,
      ) ?? 0)
    : (deck?.slides.length ?? 0);

  const leadDeck = isPresentation ? presentation?.items[0]?.deck : deck;
  const rawLeadSlide = leadDeck?.slides[0] ?? null;
  // 썸네일 내부 텍스트에 zero-width space를 부여하여 카드 타이틀과 시각적/접근성 구분
  const leadSlide = rawLeadSlide
    ? {
        ...rawLeadSlide,
        lines: rawLeadSlide.lines.map((l) => `${l}\u200B`),
      }
    : null;
  const leadStyle = leadDeck?.style ?? DEFAULT_DECK_STYLE;
  const backgroundId = leadDeck?.backgroundId;
  const backgroundUrl = getBackgroundMediaUrl(backgroundId);
  const posterUrl = getBackgroundPosterUrl(backgroundId);

  return (
    <div
      data-testid="presentation-card"
      className={`group relative flex flex-col bg-white dark:bg-zinc-900/60 hover:bg-zinc-50 dark:hover:bg-zinc-900/90 border border-zinc-200 dark:border-zinc-800/80 hover:border-zinc-300 dark:hover:border-zinc-700 rounded-2xl overflow-hidden transition-all duration-200 shadow-sm hover:shadow-md dark:shadow-none dark:hover:shadow-lg dark:hover:shadow-black/50 hover:-translate-y-0.5 ${className}`}
    >
      {/* 1. 16:9 슬라이드 썸네일 스테이지 영역 */}
      <div
        className="relative w-full aspect-video bg-black overflow-hidden select-none cursor-pointer rounded-t-2xl"
        onClick={onEdit}
      >
        {/* 실제 축소 렌더링된 SlideStage */}
        <div className="w-full h-full pointer-events-none transition-transform duration-300 group-hover:scale-[1.02]">
          <SlideStage
            slide={leadSlide}
            style={leadStyle}
            backgroundUrl={backgroundUrl}
            posterUrl={posterUrl}
          />
        </div>

        {/* 상단 16:9 및 슬라이드 수 배지 */}
        <div className="absolute top-2.5 left-2.5 z-30 flex items-center gap-1.5 pointer-events-none">
          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-black/70 backdrop-blur-md text-emerald-400 border border-emerald-500/30">
            16:9
          </span>
          {isPresentation && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-indigo-950/80 backdrop-blur-md text-indigo-300 border border-indigo-700/40">
              {presentation?.items.length}곡 세트
            </span>
          )}
        </div>

        <div className="absolute top-2.5 right-2.5 z-30 pointer-events-none">
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-black/70 backdrop-blur-md text-zinc-300 border border-zinc-700/40">
            {totalSlides} 슬라이드
          </span>
        </div>

        {/* 마우스 호버 시 떠오르는 Canva 스타일 퀵 액션 오버레이 */}
        <div className="absolute inset-0 z-40 bg-black/60 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-2.5 p-4">
          <button
            type="button"
            data-testid="card-present-btn"
            onClick={(e) => {
              e.stopPropagation();
              onPresent();
            }}
            className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md flex items-center gap-1.5 transition-transform hover:scale-105 active:scale-95 cursor-pointer"
            title="슬라이드쇼 전체화면 시작"
          >
            <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
            <span>발표</span>
          </button>

          <button
            type="button"
            data-testid="card-edit-btn"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="px-3.5 py-1.5 rounded-xl bg-zinc-800/90 hover:bg-zinc-700 text-zinc-100 text-xs font-medium border border-zinc-600/50 shadow-md flex items-center gap-1.5 transition-transform hover:scale-105 active:scale-95 cursor-pointer"
            title="편집기 열기"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
            <span>편집</span>
          </button>
        </div>
      </div>

      {/* 2. 하단 정보 영역 (Canva Projects 카드 메타데이터 스타일) */}
      <div className="p-3.5 flex flex-col justify-between gap-1.5 bg-white dark:bg-zinc-900/60">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3
              onClick={onEdit}
              className="text-xs sm:text-sm font-semibold text-zinc-900 dark:text-zinc-100 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors truncate cursor-pointer"
              title={title}
            >
              {title}
            </h3>
            {/* Canva 스타일의 작은 아이콘/아바타 + 최근 수정 텍스트 */}
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
              <span className="w-4 h-4 rounded flex items-center justify-center bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800/80 text-[9px] font-bold shrink-0">
                {isPresentation ? "W" : "S"}
              </span>
              <span className="truncate">
                {artistOrSummary ||
                  (isPresentation ? "프레젠테이션 세트" : "찬양 곡")}
              </span>
              <span className="text-zinc-300 dark:text-zinc-600 shrink-0">
                •
              </span>
              <span className="text-zinc-400 dark:text-zinc-400 shrink-0">
                최근 편집됨
              </span>
            </div>
          </div>

          {/* 추가 드롭다운/삭제 메뉴 */}
          <div className="flex items-center gap-0.5 shrink-0">
            {onDuplicate && (
              <button
                type="button"
                data-testid="card-duplicate-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onDuplicate();
                }}
                className="p-1 rounded-lg text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 transition-colors cursor-pointer"
                title="복제"
              >
                <svg
                  className="w-3.5 h-3.5"
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
            {onDelete && (
              <button
                type="button"
                data-testid="card-delete-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                className="p-1 rounded-lg text-zinc-400 dark:text-zinc-500 hover:text-red-500 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 transition-colors cursor-pointer"
                title="삭제"
              >
                <svg
                  className="w-3.5 h-3.5"
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
      </div>
    </div>
  );
}
