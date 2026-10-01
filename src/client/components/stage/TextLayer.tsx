import React, { useEffect } from "react";
import type { Slide, DeckStyle, GridAnchorPreset, TextBackdrop } from "#shared";
import { GRID_ANCHOR_TRANSFORMS, TEXT_SHADOW_PRESETS } from "#shared";
import { loadWebFont, toCssFontFamily } from "../../lib/fonts/fontLoader";

export interface TextLayerProps {
  slide?: Slide | null;
  style: DeckStyle;
  isLyricsHidden?: boolean;
  boxRef?: React.Ref<HTMLDivElement>;
  isInteracting?: boolean;
  /** 가사 줄 대신 박스 안에 그릴 내용. 편집 캔버스의 직접 편집기가 쓴다 */
  content?: React.ReactNode;
}

/**
 * 1920x1080 고정 가상 스테이지 기준 텍스트 및 타이포그래피 레이어.
 *
 * 글자 배경은 같은 줄을 투명 글자로 한 번 더 그린 아래층이다. 따로 그려서 아랫줄
 * 박스가 윗줄 글자를 덮지 않고, 직접 편집 중인 textarea 아래에도 그대로 보인다.
 * 여백은 padding 대신 box-shadow spread로 넓혀 줄바꿈 폭(넘침 계산)이 박스가 없을
 * 때와 같고, 투명도는 층 전체에 걸어 박스끼리 겹친 곳이 더 진해지지 않는다.
 */
export function TextLayer({
  slide,
  style,
  isLyricsHidden = false,
  boxRef,
  isInteracting = false,
  content,
}: TextLayerProps): React.JSX.Element {
  const {
    position,
    fontFamily,
    fontSizeVw,
    fontColor,
    textAlign,
    lineHeight,
    textShadowLevel,
    textBackdrop,
  } = style;

  const transform =
    GRID_ANCHOR_TRANSFORMS[
      position.anchor as Exclude<GridAnchorPreset, "custom">
    ] ?? "translate(-50%, -50%)";

  const fontSizePx = fontSizeVw * 19.2;

  const textShadow =
    TEXT_SHADOW_PRESETS[textShadowLevel] ?? TEXT_SHADOW_PRESETS.medium;

  useEffect(() => {
    if (fontFamily) {
      void loadWebFont(fontFamily);
    }
  }, [fontFamily]);

  const lines = slide?.lines ?? [];

  return (
    <div
      data-testid="text-layer-container"
      className="pointer-events-none absolute inset-0 z-20 transition-opacity duration-150 ease-out select-none"
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
          fontFamily: toCssFontFamily(fontFamily),
          fontSize: `${fontSizePx}px`,
          color: fontColor,
          textAlign,
          lineHeight,
          textShadow,
          wordBreak: "keep-all",
          whiteSpace: "pre-wrap",
        }}
      >
        <div className="grid">
          {textBackdrop.enabled && (
            <TextBackdropLayer lines={lines} backdrop={textBackdrop} />
          )}
          <div className="relative col-start-1 row-start-1">
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
      </div>
    </div>
  );
}

function TextBackdropLayer({
  lines,
  backdrop,
}: {
  lines: readonly string[];
  backdrop: TextBackdrop;
}): React.JSX.Element {
  const paddingEm = backdrop.paddingPercent / 100;
  return (
    <div
      aria-hidden
      data-testid="text-backdrop"
      className="col-start-1 row-start-1"
      style={{
        opacity: backdrop.opacity / 100,
        color: "transparent",
        textShadow: "none",
      }}
    >
      {lines.map((line, idx) => (
        <p key={idx} className="m-0 p-0">
          <span
            style={{
              backgroundColor: "#000000",
              boxShadow: `0 0 0 ${paddingEm}em #000000`,
              borderRadius: `${backdrop.radiusPercent / 100}em`,
              boxDecorationBreak: "clone",
              WebkitBoxDecorationBreak: "clone",
            }}
          >
            {line}
          </span>
        </p>
      ))}
    </div>
  );
}
