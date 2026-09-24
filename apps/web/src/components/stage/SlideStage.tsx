import React, { useRef, useState, useEffect } from "react";
import type { Slide, DeckStyle } from "@repo/shared";
import { DEFAULT_DECK_STYLE } from "@repo/shared";
import {
  useStageScale,
  VIRTUAL_STAGE_WIDTH,
  VIRTUAL_STAGE_HEIGHT,
} from "../../hooks/useStageScale";
import { VideoLayer } from "./VideoLayer";
import { OverlayLayer } from "./OverlayLayer";
import { TextLayer } from "./TextLayer";

export interface SlideStageProps {
  slide?: Slide | null;
  style?: DeckStyle;
  backgroundUrl?: string;
  nextBackgroundUrl?: string;
  posterUrl?: string;
  isBlackout?: boolean;
  isLyricsHidden?: boolean;
  textBoxRef?: React.Ref<HTMLDivElement>;
  isTextInteracting?: boolean;
  containerDimensions?: { width?: number; height?: number };
  staticBackground?: boolean;
  className?: string;
}

/** 16:9 가상 스테이지 위에서 3-Layer로 슬라이드를 렌더링하는 컴포넌트 */
export function SlideStage({
  slide,
  style = DEFAULT_DECK_STYLE,
  backgroundUrl,
  nextBackgroundUrl,
  posterUrl,
  isBlackout = false,
  isLyricsHidden = false,
  textBoxRef,
  isTextInteracting = false,
  containerDimensions,
  staticBackground = false,
  className = "",
}: SlideStageProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [measuredSize, setMeasuredSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    if (containerDimensions?.width && containerDimensions?.height) {
      return;
    }
    const elem = containerRef.current;
    if (!elem) return;

    const checkSize = () => {
      if (elem.clientWidth > 0 && elem.clientHeight > 0) {
        setMeasuredSize((prev) => {
          if (
            prev?.width === elem.clientWidth &&
            prev?.height === elem.clientHeight
          ) {
            return prev;
          }
          return { width: elem.clientWidth, height: elem.clientHeight };
        });
      }
    };

    checkSize();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          if (width > 0 && height > 0) {
            setMeasuredSize({ width, height });
          }
        }
      });
      observer.observe(elem);
      return () => observer.disconnect();
    }
  }, [containerDimensions?.width, containerDimensions?.height]);

  const effectiveDimensions =
    containerDimensions?.width && containerDimensions?.height
      ? containerDimensions
      : (measuredSize ?? undefined);

  const { scale, translateX, translateY } = useStageScale(effectiveDimensions);

  return (
    <div
      ref={containerRef}
      data-testid="slide-stage-viewport"
      className={`relative w-full h-full overflow-hidden bg-black select-none ${className}`}
    >
      <div
        data-testid="virtual-slide-stage"
        className="absolute overflow-hidden bg-black"
        style={{
          width: `${VIRTUAL_STAGE_WIDTH}px`,
          height: `${VIRTUAL_STAGE_HEIGHT}px`,
          left: `${translateX}px`,
          top: `${translateY}px`,
          transform: `scale(${scale})`,
          transformOrigin: "0 0",
        }}
      >
        {staticBackground ? (
          <div
            data-testid="static-background-layer"
            className="absolute inset-0 overflow-hidden bg-black z-0 select-none pointer-events-none"
          >
            {posterUrl && (
              <img
                src={posterUrl}
                alt=""
                draggable={false}
                className="absolute inset-0 w-full h-full object-cover"
              />
            )}
          </div>
        ) : (
          <VideoLayer
            src={backgroundUrl}
            nextSrc={nextBackgroundUrl}
            posterUrl={posterUrl}
          />
        )}

        <OverlayLayer
          opacity={style.overlayOpacity}
          color={style.overlayColor}
          isBlackout={isBlackout}
        />

        <TextLayer
          slide={slide}
          style={style}
          isLyricsHidden={isLyricsHidden || isBlackout}
          boxRef={textBoxRef}
          isInteracting={isTextInteracting}
        />
      </div>
    </div>
  );
}
