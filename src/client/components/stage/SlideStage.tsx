import React, { useRef, useState, useEffect } from "react";
import type { Slide, DeckStyle } from "#shared";
import { DEFAULT_DECK_STYLE } from "#shared";
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
  /**
   * 이미지 배경. 영상 레이어는 포스터까지 비운 채로 두고 그 위에 원본 이미지를 그린다.
   * 포스터는 썸네일용 축소본이라 원본 뒤에서 따로 받을 까닭이 없다
   */
  backgroundImageUrl?: string;
  nextBackgroundUrl?: string;
  posterUrl?: string;
  isBlackout?: boolean;
  isLyricsHidden?: boolean;
  textBoxRef?: React.Ref<HTMLDivElement>;
  isTextInteracting?: boolean;
  /** 가사 줄 대신 텍스트 박스 안에 그릴 내용 (편집 캔버스 전용) */
  textContent?: React.ReactNode;
  containerDimensions?: { width?: number; height?: number };
  staticBackground?: boolean;
  className?: string;
}

/** 16:9 가상 스테이지 위에서 3-Layer로 슬라이드를 렌더링하는 컴포넌트 */
export function SlideStage({
  slide,
  style = DEFAULT_DECK_STYLE,
  backgroundUrl,
  backgroundImageUrl,
  nextBackgroundUrl,
  posterUrl,
  isBlackout = false,
  isLyricsHidden = false,
  textBoxRef,
  isTextInteracting = false,
  textContent,
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
      className={`relative size-full overflow-hidden bg-black select-none ${className}`}
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
            className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-black select-none"
          >
            {posterUrl && (
              <img
                src={posterUrl}
                alt=""
                loading="lazy"
                decoding="async"
                draggable={false}
                className="absolute inset-0 size-full object-cover"
              />
            )}
          </div>
        ) : (
          <>
            <VideoLayer
              src={backgroundImageUrl ? undefined : backgroundUrl}
              nextSrc={nextBackgroundUrl}
              posterUrl={backgroundImageUrl ? undefined : posterUrl}
            />
            {backgroundImageUrl && (
              <img
                data-testid="image-background-layer"
                src={backgroundImageUrl}
                alt=""
                draggable={false}
                className="pointer-events-none absolute inset-0 z-0 size-full object-cover select-none"
              />
            )}
          </>
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
          content={textContent}
        />
      </div>
    </div>
  );
}
