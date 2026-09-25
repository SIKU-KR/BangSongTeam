import React from "react";
import type { Slide, DeckStyle, GridAnchorPreset } from "#shared";
import { GRID_ANCHOR_TRANSFORMS, TEXT_SHADOW_PRESETS } from "#shared";

export interface TextLayerProps {
  slide?: Slide | null;
  style: DeckStyle;
  isLyricsHidden?: boolean;
  boxRef?: React.Ref<HTMLDivElement>;
  isInteracting?: boolean;
  /** 가사 줄 대신 박스 안에 그릴 내용. 편집 캔버스의 직접 편집기가 쓴다 */
  content?: React.ReactNode;
  className?: string;
}

/** 1920x1080 고정 가상 스테이지 기준 텍스트 및 타이포그래피 레이어 */
export function TextLayer({
  slide,
  style,
  isLyricsHidden = false,
  boxRef,
  isInteracting = false,
  content,
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

  const transform =
    GRID_ANCHOR_TRANSFORMS[
      position.anchor as Exclude<GridAnchorPreset, "custom">
    ] ?? "translate(-50%, -50%)";

  const fontSizePx = fontSizeVw * 19.2;

  const textShadow =
    TEXT_SHADOW_PRESETS[textShadowLevel] ?? TEXT_SHADOW_PRESETS.medium;

  const lines = slide?.lines ?? [];

  return (
    <div
      data-testid="text-layer-container"
      className={`pointer-events-none absolute inset-0 z-20 transition-opacity duration-150 ease-out select-none ${className}`}
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
        {content !== undefined ? (
          <div className="pointer-events-auto">{content}</div>
        ) : (
          lines.map((line, idx) => (
            <p key={idx} className="m-0 p-0">
              {line}
            </p>
          ))
        )}
      </div>
    </div>
  );
}
