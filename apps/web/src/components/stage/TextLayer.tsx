import React from "react";
import type { Slide, DeckStyle, GridAnchorPreset } from "@repo/shared";
import { GRID_ANCHOR_TRANSFORMS, TEXT_SHADOW_PRESETS } from "@repo/shared";

export interface TextLayerProps {
  slide?: Slide | null;
  style: DeckStyle;
  isLyricsHidden?: boolean;
  /** 텍스트 박스 DOM 참조 (편집기에서 Moveable 타깃으로 사용) */
  boxRef?: React.Ref<HTMLDivElement>;
  /** 드래그/리사이즈 중에는 위치 transition을 꺼서 포인터를 지연 없이 따라가게 한다 */
  isInteracting?: boolean;
  className?: string;
}

/**
 * 3-Layer Stage Layer 3: 가독성 보장 텍스트 및 타이포그래피 레이어
 * 1920x1080 고정 가상 스테이지 좌표계 기준 퍼센트 위치와 앵커 성장을 적용한다.
 */
export function TextLayer({
  slide,
  style,
  isLyricsHidden = false,
  boxRef,
  isInteracting = false,
  className = "",
}: TextLayerProps): React.JSX.Element {
  const {
    position,
    fontFamily,
    fontSizeVw,
    fontColor,
    textAlign,
    lineHeight,
    textShadowLevel,
  } = style;

  // 앵커별 CSS transform (top: 0, middle: -50%, bottom: -100%)
  const transform =
    GRID_ANCHOR_TRANSFORMS[
      position.anchor as Exclude<GridAnchorPreset, "custom">
    ] ?? "translate(-50%, -50%)";

  // 1920px 기준 절대 폰트 크기 계산 (1vw of 1920 = 19.2px)
  const fontSizePx = fontSizeVw * 19.2;

  // 텍스트 그림자 프리셋 적용
  const textShadow =
    TEXT_SHADOW_PRESETS[textShadowLevel] ?? TEXT_SHADOW_PRESETS.medium;

  const lines = slide?.lines ?? [];

  return (
    <div
      data-testid="text-layer-container"
      className={`absolute inset-0 pointer-events-none select-none transition-opacity duration-150 ease-out z-20 ${className}`}
      style={{
        opacity: isLyricsHidden ? 0 : 1,
      }}
    >
      <div
        ref={boxRef}
        data-testid="text-layer-box"
        className={`absolute flex flex-col justify-center ${
          isInteracting ? "" : "transition-all duration-100 ease-out"
        }`}
        style={{
          left: `${position.xPercent}%`,
          top: `${position.yPercent}%`,
          width: `${position.widthPercent}%`,
          transform,
          fontFamily,
          fontSize: `${fontSizePx}px`,
          color: fontColor,
          textAlign,
          lineHeight,
          textShadow,
          wordBreak: "keep-all",
          whiteSpace: "pre-wrap",
        }}
      >
        {lines.map((line, idx) => (
          <p key={idx} className="m-0 p-0">
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}
