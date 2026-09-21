import React, { useState } from "react";
import type { DeckStyle, GridAnchorPreset, Slide } from "@repo/shared";
import {
  DEFAULT_DECK_STYLE,
  SUPPORTED_FONTS,
  GRID_ANCHOR_PRESET_COORDINATES,
  INITIAL_BACKGROUNDS,
  getBackgroundPosterUrl,
} from "@repo/shared";
import { BackgroundPickerModal } from "./BackgroundPickerModal";

export interface SongPropertyPanelProps {
  style: DeckStyle;
  backgroundId?: string | null;
  activeSlide?: Slide | null;
  onUpdateStyle: (update: Partial<DeckStyle>) => void;
  onUpdateBackground: (bgId: string) => void;
  onUpdateSlideLines?: (lines: string[]) => void;
  className?: string;
}

const PRESET_COLORS = [
  { label: "화이트", value: "#FFFFFF" },
  { label: "옐로우", value: "#FEF08A" },
  { label: "스카이", value: "#BAE6FD" },
  { label: "민트", value: "#A7F3D0" },
  { label: "핑크", value: "#FBCFE8" },
];

const GRID_PRESETS: GridAnchorPreset[] = [
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "middle-center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];

const SHADOW_LEVELS = [
  { id: "none", label: "없음" },
  { id: "soft", label: "은은함" },
  { id: "medium", label: "보통" },
  { id: "strong", label: "강함" },
] as const;

/**
 * Canva / MiriCanvas 스타일 속성 인스펙터 패널
 * - 모션 배경 선택
 * - 검정 오버레이 불투명도 조절
 * - 타이포그래피 (폰트, 크기, 정렬, 색상, 그림자)
 * - 3×3 격자 위치 및 가로 폭 조절
 * - 현재 슬라이드 가사 즉각 수정
 */
export function SongPropertyPanel({
  style = DEFAULT_DECK_STYLE,
  backgroundId,
  activeSlide,
  onUpdateStyle,
  onUpdateBackground,
  onUpdateSlideLines,
  className = "",
}: SongPropertyPanelProps): React.JSX.Element {
  const [isBgModalOpen, setIsBgModalOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const currentBg =
    INITIAL_BACKGROUNDS.find((b) => b.id === backgroundId) ||
    INITIAL_BACKGROUNDS[0];
  const posterUrl = getBackgroundPosterUrl(currentBg.id);

  const handleGridPresetClick = (preset: GridAnchorPreset) => {
    if (preset === "custom") return;
    const coords = GRID_ANCHOR_PRESET_COORDINATES[preset];
    onUpdateStyle({
      position: {
        anchor: preset,
        xPercent: coords.xPercent,
        yPercent: coords.yPercent,
        widthPercent: style.position?.widthPercent ?? 80,
      },
    });
  };

  const handleResetStyle = () => {
    onUpdateStyle(DEFAULT_DECK_STYLE);
  };

  if (isCollapsed) {
    return (
      <aside
        data-testid="song-property-panel-collapsed"
        className={`w-12 bg-zinc-950 border-l border-zinc-800/80 flex flex-col items-center py-4 text-zinc-400 select-none ${className}`}
      >
        <button
          type="button"
          data-testid="expand-property-panel-btn"
          onClick={() => setIsCollapsed(false)}
          className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors cursor-pointer"
          title="속성 패널 펼치기"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="mt-4 text-[11px] font-medium [writing-mode:vertical-lr] tracking-widest text-zinc-500">
          디자인 속성
        </span>
      </aside>
    );
  }

  return (
    <aside
      data-testid="song-property-panel"
      className={`w-80 bg-zinc-950 border-l border-zinc-800/80 flex flex-col text-zinc-200 select-none overflow-y-auto ${className}`}
    >
      <div className="p-4 border-b border-zinc-800/80 bg-zinc-900/30 flex items-center justify-between">
        <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
          <svg
            className="w-4 h-4 text-emerald-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
            />
          </svg>
          <span>슬라이드 디자인 & 속성</span>
        </h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleResetStyle}
            className="text-[11px] text-zinc-500 hover:text-zinc-300 underline cursor-pointer"
            title="기본값으로 복원"
          >
            초기화
          </button>
          <button
            type="button"
            data-testid="collapse-property-panel-btn"
            onClick={() => setIsCollapsed(true)}
            className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
            title="속성 패널 접기"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      <div className="p-4 flex flex-col gap-6">
        {/* 1. 모션 배경 섹션 */}
        <section className="space-y-2.5">
          <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center justify-between">
            <span>모션 루프 배경</span>
            <span className="text-[10px] text-emerald-400 font-mono">
              Cloudflare R2
            </span>
          </label>

          <div
            onClick={() => setIsBgModalOpen(true)}
            className="group relative aspect-video w-full rounded-lg overflow-hidden border border-zinc-800 hover:border-emerald-500 cursor-pointer transition-all bg-black"
          >
            {posterUrl ? (
              <img
                src={posterUrl}
                alt={currentBg.title}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform"
              />
            ) : (
              <div className="w-full h-full bg-zinc-900 flex items-center justify-center text-xs text-zinc-500">
                배경
              </div>
            )}
            <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-colors flex items-center justify-center">
              <span className="px-2.5 py-1 rounded bg-black/70 backdrop-blur-sm text-xs text-white font-medium border border-white/20">
                배경 변경
              </span>
            </div>
            <div className="absolute bottom-1.5 left-2 z-10 text-[11px] font-medium text-white drop-shadow">
              {currentBg.title}
            </div>
          </div>
        </section>

        {/* 2. 가독성 오버레이 (검정 불투명도) */}
        <section className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-zinc-400 uppercase tracking-wider">
              검정 오버레이 (암전 대비)
            </span>
            <span className="font-mono text-emerald-400 font-bold">
              {style.overlayOpacity}%
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={style.overlayOpacity}
            onChange={(e) =>
              onUpdateStyle({ overlayOpacity: Number(e.target.value) })
            }
            className="w-full accent-emerald-500 cursor-pointer"
            aria-label="검정 오버레이 불투명도"
          />
          <div className="flex justify-between text-[10px] text-zinc-500">
            <span>0% (투명)</span>
            <span>50% (권장)</span>
            <span>100% (완전 암전)</span>
          </div>
        </section>

        {/* 3. 타이포그래피 */}
        <section className="space-y-3 pt-2 border-t border-zinc-900">
          <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block">
            타이포그래피
          </label>

          {/* 폰트 선택 */}
          <div className="space-y-1">
            <span className="text-[11px] text-zinc-400">
              웹폰트 (오프라인 번들)
            </span>
            <select
              value={style.fontFamily}
              onChange={(e) =>
                onUpdateStyle({
                  fontFamily: e.target.value as DeckStyle["fontFamily"],
                })
              }
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500 cursor-pointer"
            >
              {SUPPORTED_FONTS.map((font) => (
                <option key={font} value={font} style={{ fontFamily: font }}>
                  {font}
                </option>
              ))}
            </select>
          </div>

          {/* 폰트 크기 */}
          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-zinc-400">
              <span>글자 크기</span>
              <span className="font-mono text-zinc-300 font-semibold">
                {style.fontSizeVw}vw
              </span>
            </div>
            <input
              type="range"
              min="2.0"
              max="7.0"
              step="0.1"
              value={style.fontSizeVw}
              onChange={(e) =>
                onUpdateStyle({ fontSizeVw: Number(e.target.value) })
              }
              className="w-full accent-emerald-500 cursor-pointer"
              aria-label="글자 크기"
            />
          </div>

          {/* 텍스트 정렬 */}
          <div className="space-y-1">
            <span className="text-[11px] text-zinc-400">텍스트 정렬</span>
            <div className="grid grid-cols-3 gap-1 bg-zinc-900 p-1 rounded-lg border border-zinc-800">
              {(["left", "center", "right"] as const).map((align) => (
                <button
                  key={align}
                  type="button"
                  onClick={() => onUpdateStyle({ textAlign: align })}
                  className={`py-1 text-xs rounded font-medium transition-colors cursor-pointer ${
                    style.textAlign === align
                      ? "bg-emerald-600 text-white shadow"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {align === "left"
                    ? "좌측"
                    : align === "center"
                      ? "중앙"
                      : "우측"}
                </button>
              ))}
            </div>
          </div>

          {/* 텍스트 그림자 */}
          <div className="space-y-1">
            <span className="text-[11px] text-zinc-400">
              텍스트 그림자 (가독성 강화)
            </span>
            <div className="grid grid-cols-4 gap-1 bg-zinc-900 p-1 rounded-lg border border-zinc-800">
              {SHADOW_LEVELS.map((lvl) => (
                <button
                  key={lvl.id}
                  type="button"
                  onClick={() => onUpdateStyle({ textShadowLevel: lvl.id })}
                  className={`py-1 text-[11px] rounded transition-colors cursor-pointer ${
                    style.textShadowLevel === lvl.id
                      ? "bg-emerald-600 text-white font-semibold"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {lvl.label}
                </button>
              ))}
            </div>
          </div>

          {/* 폰트 색상 프리셋 */}
          <div className="space-y-1">
            <span className="text-[11px] text-zinc-400">글자 색상</span>
            <div className="flex items-center gap-1.5">
              {PRESET_COLORS.map((col) => (
                <button
                  key={col.value}
                  type="button"
                  onClick={() => onUpdateStyle({ fontColor: col.value })}
                  style={{ backgroundColor: col.value }}
                  className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 cursor-pointer ${
                    style.fontColor.toUpperCase() === col.value.toUpperCase()
                      ? "border-emerald-500 scale-110 shadow-md ring-2 ring-emerald-500/40"
                      : "border-zinc-700"
                  }`}
                  title={col.label}
                />
              ))}
              <input
                type="text"
                value={style.fontColor}
                onChange={(e) => onUpdateStyle({ fontColor: e.target.value })}
                className="w-20 ml-auto bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] font-mono text-zinc-300 uppercase"
              />
            </div>
          </div>
        </section>

        {/* 4. 3×3 격자 위치 프리셋 & 박스 폭 */}
        <section className="space-y-3 pt-2 border-t border-zinc-900">
          <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block">
            위치 및 크기
          </label>

          <div className="space-y-1.5">
            <span className="text-[11px] text-zinc-400">
              3×3 화면 기준점 (Anchor)
            </span>
            <div className="grid grid-cols-3 gap-1.5 w-32 mx-auto bg-zinc-900 p-2 rounded-xl border border-zinc-800">
              {GRID_PRESETS.map((preset) => {
                const isSelected = style.position?.anchor === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    data-testid={`grid-anchor-${preset}`}
                    onClick={() => handleGridPresetClick(preset)}
                    className={`w-8 h-8 rounded flex items-center justify-center transition-all cursor-pointer ${
                      isSelected
                        ? "bg-emerald-500 text-white shadow-md shadow-emerald-950/60 ring-2 ring-emerald-400/50"
                        : "bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
                    }`}
                    title={preset}
                  >
                    <div
                      className={`w-2 h-2 rounded-full ${isSelected ? "bg-white" : "bg-zinc-500"}`}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-zinc-400">
              <span>텍스트 박스 가로 폭</span>
              <span className="font-mono text-zinc-300 font-semibold">
                {style.position?.widthPercent ?? 80}%
              </span>
            </div>
            <input
              type="range"
              min="20"
              max="90"
              step="1"
              value={style.position?.widthPercent ?? 80}
              onChange={(e) =>
                onUpdateStyle({
                  position: {
                    anchor: style.position?.anchor ?? "middle-center",
                    xPercent: style.position?.xPercent ?? 50,
                    yPercent: style.position?.yPercent ?? 50,
                    widthPercent: Number(e.target.value),
                  },
                })
              }
              className="w-full accent-emerald-500 cursor-pointer"
              aria-label="텍스트 박스 가로 폭"
            />
          </div>
        </section>

        {/* 5. 활성 슬라이드 가사 즉각 편집 */}
        {activeSlide && onUpdateSlideLines && (
          <section className="space-y-2 pt-2 border-t border-zinc-900">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                현재 슬라이드 가사
              </label>
              <span className="text-[10px] text-zinc-500 font-mono">
                줄 단위 입력
              </span>
            </div>
            <textarea
              rows={4}
              value={activeSlide.lines.join("\n")}
              onChange={(e) => {
                const lines = e.target.value.split("\n");
                onUpdateSlideLines(lines);
              }}
              placeholder="슬라이드 가사를 입력하세요 (Enter로 줄바꿈)"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500 resize-none font-sans leading-relaxed"
            />
          </section>
        )}
      </div>

      {/* 모션 배경 선택 모달 */}
      <BackgroundPickerModal
        isOpen={isBgModalOpen}
        onClose={() => setIsBgModalOpen(false)}
        selectedBackgroundId={currentBg.id}
        onSelect={onUpdateBackground}
      />
    </aside>
  );
}
