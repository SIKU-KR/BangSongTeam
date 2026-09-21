import React, { useState } from "react";
import {
  INITIAL_BACKGROUNDS,
  getBackgroundMediaUrl,
  getBackgroundPosterUrl,
} from "@repo/shared";

export interface BackgroundPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedBackgroundId?: string | null;
  onSelect: (backgroundId: string) => void;
}

const FILTER_TAGS = [
  "전체",
  "잔잔한",
  "밝은",
  "웅장한",
  "따뜻한",
  "차가운",
  "어두운",
] as const;

/**
 * 모션 배경 영상 선택 모달 컴포넌트
 * - 사전 주입된 R2 기반 루프 비디오 10종 그리드 렌더링
 * - 태그 필터 (전체, 분위기, 색감)
 * - 현재 선택된 배경 하이라이트
 */
export function BackgroundPickerModal({
  isOpen,
  onClose,
  selectedBackgroundId,
  onSelect,
}: BackgroundPickerModalProps): React.JSX.Element | null {
  const [activeTag, setActiveTag] = useState<string>("전체");
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  if (!isOpen) return null;

  const filteredBackgrounds =
    activeTag === "전체"
      ? INITIAL_BACKGROUNDS
      : INITIAL_BACKGROUNDS.filter((bg) => bg.tags.includes(activeTag));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="background-picker-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-xl dark:shadow-2xl overflow-hidden text-zinc-900 dark:text-zinc-100">
        {/* 모달 헤더 */}
        <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <div>
            <h2
              id="background-picker-title"
              className="text-lg font-bold text-zinc-900 dark:text-white flex items-center gap-2"
            >
              <span>모션 배경 라이브러리</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                10종 고화질 루프
              </span>
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              찬양 분위기에 어울리는 무음 H.264 모션 비디오 루프를 선택하세요.
            </p>
          </div>

          <button
            type="button"
            data-testid="close-bg-modal-btn"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            title="닫기"
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
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* 태그 필터 탭 */}
        <div className="px-6 py-3 border-b border-zinc-200 dark:border-zinc-800/80 bg-zinc-50 dark:bg-zinc-950/40 flex items-center gap-1.5 overflow-x-auto">
          {FILTER_TAGS.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setActiveTag(tag)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-all shrink-0 cursor-pointer ${
                activeTag === tag
                  ? "bg-emerald-600 text-white shadow-sm dark:shadow-emerald-950/40"
                  : "bg-zinc-200/80 dark:bg-zinc-800/70 text-zinc-700 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>

        {/* 배경 그리드 */}
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {filteredBackgrounds.map((bg) => {
            const isSelected = bg.id === selectedBackgroundId;
            const posterUrl = getBackgroundPosterUrl(bg.id);
            const videoUrl = getBackgroundMediaUrl(bg.id);
            const isHovered = hoveredId === bg.id;

            return (
              <div
                key={bg.id}
                data-testid={`bg-item-${bg.id}`}
                onClick={() => {
                  onSelect(bg.id);
                  onClose();
                }}
                onMouseEnter={() => setHoveredId(bg.id)}
                onMouseLeave={() => setHoveredId(null)}
                className={`group relative flex flex-col rounded-xl overflow-hidden border cursor-pointer transition-all duration-200 ${
                  isSelected
                    ? "border-emerald-500 ring-2 ring-emerald-500/30 bg-emerald-50/50 dark:bg-zinc-800"
                    : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-600 bg-white dark:bg-zinc-900/60 shadow-sm dark:shadow-none"
                }`}
              >
                {/* 16:9 썸네일 */}
                <div className="relative aspect-video w-full bg-black overflow-hidden">
                  {isHovered && videoUrl ? (
                    <video
                      src={videoUrl}
                      autoPlay
                      muted
                      loop
                      playsInline
                      className="w-full h-full object-cover"
                    />
                  ) : posterUrl ? (
                    <img
                      src={posterUrl}
                      alt={bg.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full bg-zinc-800 flex items-center justify-center text-xs text-zinc-500">
                      배경
                    </div>
                  )}

                  {/* 선택 표시 */}
                  {isSelected && (
                    <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-lg">
                      <svg
                        className="w-3.5 h-3.5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={3}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    </div>
                  )}

                  {/* 재생 길이 배지 */}
                  <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded text-[10px] font-mono bg-black/70 text-zinc-300 backdrop-blur-sm">
                    {bg.durationSec}s
                  </span>
                </div>

                {/* 메타 정보 */}
                <div className="p-2.5 flex flex-col gap-1">
                  <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-200 truncate group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                    {bg.title}
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {bg.tags.map((t) => (
                      <span
                        key={t}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200/60 dark:border-zinc-700/60"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* 푸터 */}
        <div className="px-6 py-3 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/40 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
          <span>무손실 H.264 비디오 스트리밍 (Cloudflare R2)</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition-colors cursor-pointer"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
