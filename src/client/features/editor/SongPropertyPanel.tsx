import React, { useState } from "react";
import type { DeckStyle, GridAnchorPreset, Slide } from "#shared";
import {
  DEFAULT_DECK_STYLE,
  SUPPORTED_FONTS,
  GRID_ANCHOR_PRESET_COORDINATES,
} from "#shared";
import { useBackground } from "../backgrounds/backgroundCatalog";
import { BackgroundPickerModal } from "./BackgroundPickerModal";
import { ColorPickerField } from "./ColorPickerField";

export interface SongPropertyPanelProps {
  style: DeckStyle;
  backgroundId?: string | null;
  activeSlide?: Slide | null;
  onUpdateStyle: (update: Partial<DeckStyle>) => void;
  onUpdateBackground: (backgroundId: string | null) => void;
  onUpdateSlideLines?: (lines: string[]) => void;
  footer?: React.ReactNode;
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

const STYLE_PRESETS: {
  name: string;
  desc: string;
  badge: string;
  style: Partial<DeckStyle>;
}[] = [
  {
    name: "클래식 워십",
    desc: "Pretendard · 화이트 · 은은한 그림자",
    badge: "기본",
    style: {
      fontFamily: "Pretendard",
      fontColor: "#FFFFFF",
      textShadowLevel: "soft",
      overlayOpacity: 45,
    },
  },
  {
    name: "다크 모던",
    desc: "Noto Sans KR · 민트 · 보통 그림자",
    badge: "모던",
    style: {
      fontFamily: "Noto Sans KR",
      fontColor: "#A7F3D0",
      textShadowLevel: "medium",
      overlayOpacity: 60,
    },
  },
  {
    name: "선샤인 웜",
    desc: "Gmarket Sans · 옐로우 · 강한 그림자",
    badge: "따뜻함",
    style: {
      fontFamily: "Gmarket Sans",
      fontColor: "#FEF08A",
      textShadowLevel: "strong",
      overlayOpacity: 50,
    },
  },
  {
    name: "오션 블루",
    desc: "Pretendard · 스카이 · 은은한 그림자",
    badge: "청량함",
    style: {
      fontFamily: "Pretendard",
      fontColor: "#BAE6FD",
      textShadowLevel: "soft",
      overlayOpacity: 40,
    },
  },
  {
    name: "감성 고운바탕",
    desc: "KoPubWorld Batang · 핑크 · 소프트",
    badge: "명조",
    style: {
      fontFamily: "KoPubWorld Batang",
      fontColor: "#FBCFE8",
      textShadowLevel: "soft",
      overlayOpacity: 50,
    },
  },
];

const SHADOW_LEVELS = [
  { id: "none", label: "없음" },
  { id: "soft", label: "은은함" },
  { id: "medium", label: "보통" },
  { id: "strong", label: "강함" },
] as const;

/** 곡 스타일과 속성을 편집하는 인스펙터 패널 컴포넌트. */
export function SongPropertyPanel({
  style = DEFAULT_DECK_STYLE,
  backgroundId,
  activeSlide,
  onUpdateStyle,
  onUpdateBackground,
  onUpdateSlideLines,
  footer,
  className = "",
}: SongPropertyPanelProps): React.JSX.Element {
  const [isBgModalOpen, setIsBgModalOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const currentBg = useBackground(backgroundId);

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
        className={`w-12 bg-white dark:bg-zinc-950 border-l border-zinc-200 dark:border-zinc-800/80 flex flex-col items-center py-4 text-zinc-500 dark:text-zinc-400 select-none ${className}`}
      >
        <button
          type="button"
          data-testid="expand-property-panel-btn"
          onClick={() => setIsCollapsed(false)}
          className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white transition-colors cursor-pointer"
          title="속성 패널 펼치기"
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
        <span className="mt-4 text-[11px] font-medium [writing-mode:vertical-lr] tracking-widest text-zinc-400 dark:text-zinc-500">
          디자인 속성
        </span>
      </aside>
    );
  }

  return (
    <aside
      data-testid="song-property-panel"
      className={`w-80 bg-white dark:bg-zinc-950 border-l border-zinc-200 dark:border-zinc-800/80 flex flex-col text-zinc-800 dark:text-zinc-200 select-none overflow-y-auto ${className}`}
    >
      <div className="p-4 border-b border-zinc-200 dark:border-zinc-800/80 bg-zinc-50 dark:bg-zinc-900/30 flex items-center justify-between">
        <h3 className="text-sm font-bold text-zinc-900 dark:text-white flex items-center gap-1.5">
          <svg
            className="w-4 h-4 text-emerald-600 dark:text-emerald-400"
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
            className="text-[11px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300 underline cursor-pointer"
            title="기본값으로 복원"
          >
            초기화
          </button>
          <button
            type="button"
            data-testid="collapse-property-panel-btn"
            onClick={() => setIsCollapsed(true)}
            className="p-1 rounded text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            title="속성 패널 접기"
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
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
        </div>
      </div>

      <div className="p-4 flex flex-col gap-6">
        <section className="space-y-2.5">
          <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider flex items-center justify-between">
            <span>곡 배경</span>
            {currentBg && (
              <span className="text-[10px] text-zinc-500 dark:text-zinc-400 normal-case">
                {currentBg.source === "user" ? "내 배경" : "기본 제공"} ·{" "}
                {currentBg.kind === "video" ? "영상" : "이미지"}
              </span>
            )}
          </label>

          <button
            type="button"
            data-testid="open-bg-picker-btn"
            onClick={() => setIsBgModalOpen(true)}
            className="group relative block aspect-video w-full rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800 hover:border-emerald-500 cursor-pointer transition-all bg-black"
          >
            {currentBg ? (
              <img
                src={currentBg.posterUrl}
                alt={currentBg.title}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform"
              />
            ) : (
              <div className="w-full h-full bg-zinc-900 flex items-center justify-center text-xs text-zinc-400">
                배경 없음
              </div>
            )}
            <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-colors flex items-center justify-center">
              <span className="px-2.5 py-1 rounded bg-black/70 backdrop-blur-sm text-xs text-white font-medium border border-white/20">
                배경 변경
              </span>
            </div>
            {currentBg && (
              <div className="absolute bottom-1.5 left-2 right-2 z-10 text-left text-[11px] font-medium text-white drop-shadow truncate">
                {currentBg.title}
              </div>
            )}
          </button>
        </section>

        <section className="space-y-2">
          <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider block">
            테마 프리셋
          </label>
          <div className="grid grid-cols-5 gap-1.5">
            {STYLE_PRESETS.map((preset, index) => (
              <button
                key={preset.name}
                type="button"
                data-testid={`style-preset-${index}`}
                onClick={() => onUpdateStyle(preset.style)}
                className="group flex flex-col items-center gap-1 cursor-pointer"
                title={`${preset.name} · ${preset.desc}`}
              >
                <span
                  className="w-full aspect-square rounded-lg bg-zinc-900 border border-zinc-200 dark:border-zinc-800 group-hover:ring-2 group-hover:ring-emerald-500/60 flex items-center justify-center text-base font-bold transition-shadow"
                  style={{
                    color: preset.style.fontColor,
                    fontFamily: preset.style.fontFamily,
                  }}
                >
                  가
                </span>
                <span className="text-[10px] text-zinc-500 dark:text-zinc-400 truncate max-w-full">
                  {preset.badge}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">
              검정 오버레이 (암전 대비)
            </span>
            <span className="font-mono text-emerald-600 dark:text-emerald-400 font-bold">
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
          <div className="flex justify-between text-[10px] text-zinc-400 dark:text-zinc-500">
            <span>0% (투명)</span>
            <span>50% (권장)</span>
            <span>100% (완전 암전)</span>
          </div>
        </section>

        <section className="space-y-3 pt-2 border-t border-zinc-200 dark:border-zinc-900">
          <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider block">
            타이포그래피
          </label>

          <div className="space-y-1">
            <span className="text-[11px] text-zinc-600 dark:text-zinc-400">
              웹폰트 (오프라인 번들)
            </span>
            <select
              value={style.fontFamily}
              onChange={(e) =>
                onUpdateStyle({
                  fontFamily: e.target.value as DeckStyle["fontFamily"],
                })
              }
              className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-emerald-500 cursor-pointer"
            >
              {SUPPORTED_FONTS.map((font) => (
                <option key={font} value={font} style={{ fontFamily: font }}>
                  {font}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-zinc-600 dark:text-zinc-400">
              <span>글자 크기</span>
              <span className="font-mono text-zinc-700 dark:text-zinc-300 font-semibold">
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

          <div className="space-y-1">
            <span className="text-[11px] text-zinc-600 dark:text-zinc-400">
              텍스트 정렬
            </span>
            <div className="grid grid-cols-3 gap-1 bg-zinc-100 dark:bg-zinc-900 p-1 rounded-lg border border-zinc-200 dark:border-zinc-800">
              {(["left", "center", "right"] as const).map((align) => (
                <button
                  key={align}
                  type="button"
                  onClick={() => onUpdateStyle({ textAlign: align })}
                  className={`py-1 text-xs rounded font-medium transition-colors cursor-pointer ${
                    style.textAlign === align
                      ? "bg-emerald-600 text-white shadow-sm dark:shadow"
                      : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
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

          <div className="space-y-1">
            <span className="text-[11px] text-zinc-600 dark:text-zinc-400">
              텍스트 그림자 (가독성 강화)
            </span>
            <div className="grid grid-cols-4 gap-1 bg-zinc-100 dark:bg-zinc-900 p-1 rounded-lg border border-zinc-200 dark:border-zinc-800">
              {SHADOW_LEVELS.map((lvl) => (
                <button
                  key={lvl.id}
                  type="button"
                  onClick={() => onUpdateStyle({ textShadowLevel: lvl.id })}
                  className={`py-1 text-[11px] rounded transition-colors cursor-pointer ${
                    style.textShadowLevel === lvl.id
                      ? "bg-emerald-600 text-white font-semibold"
                      : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
                  }`}
                >
                  {lvl.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <span className="text-[11px] text-zinc-600 dark:text-zinc-400">
              글자 색상
            </span>
            <div className="flex items-center gap-1.5">
              {PRESET_COLORS.map((col) => (
                <button
                  key={col.value}
                  type="button"
                  onClick={() => onUpdateStyle({ fontColor: col.value })}
                  style={{ backgroundColor: col.value }}
                  className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 cursor-pointer ${
                    style.fontColor.toUpperCase() === col.value.toUpperCase()
                      ? "border-emerald-500 scale-110 shadow-sm dark:shadow-md ring-2 ring-emerald-500/40"
                      : "border-zinc-300 dark:border-zinc-700"
                  }`}
                  title={col.label}
                />
              ))}
              <ColorPickerField
                className="ml-auto"
                value={style.fontColor}
                onCommit={(hex) => onUpdateStyle({ fontColor: hex })}
              />
            </div>
          </div>
        </section>

        <section className="space-y-3 pt-2 border-t border-zinc-200 dark:border-zinc-900">
          <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider block">
            위치 및 크기
          </label>

          <div className="space-y-1.5">
            <span className="text-[11px] text-zinc-600 dark:text-zinc-400">
              3×3 화면 기준점 (Anchor)
            </span>
            <div className="grid grid-cols-3 gap-1.5 w-32 mx-auto bg-zinc-100 dark:bg-zinc-900 p-2 rounded-xl border border-zinc-200 dark:border-zinc-800">
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
                        ? "bg-emerald-500 text-white shadow-sm dark:shadow-md dark:shadow-emerald-950/60 ring-2 ring-emerald-400/50"
                        : "bg-zinc-200 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-300 dark:hover:bg-zinc-700 hover:text-zinc-700 dark:hover:text-zinc-300"
                    }`}
                    title={preset}
                  >
                    <div
                      className={`w-2 h-2 rounded-full ${isSelected ? "bg-white" : "bg-zinc-400 dark:bg-zinc-500"}`}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-zinc-600 dark:text-zinc-400">
              <span>텍스트 박스 가로 폭</span>
              <span className="font-mono text-zinc-700 dark:text-zinc-300 font-semibold">
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

        {activeSlide && onUpdateSlideLines && (
          <section className="space-y-2 pt-2 border-t border-zinc-200 dark:border-zinc-900">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">
                현재 슬라이드 가사
              </label>
              <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-mono">
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
              className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-2.5 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none focus:border-emerald-500 resize-none font-sans leading-relaxed"
            />
          </section>
        )}

        {footer}
      </div>

      <BackgroundPickerModal
        isOpen={isBgModalOpen}
        onClose={() => setIsBgModalOpen(false)}
        selectedBackgroundId={currentBg?.id ?? null}
        onSelect={onUpdateBackground}
      />
    </aside>
  );
}
