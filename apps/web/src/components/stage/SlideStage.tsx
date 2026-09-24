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
  /** 현재 슬라이드 데이터 (ID, order, lines) */
  slide?: Slide | null;
  /** 곡 단위 타이포그래피 & 스타일 */
  style?: DeckStyle;
  /** 현재 배경 영상 URL */
  backgroundUrl?: string;
  /** 다음 곡 배경 영상 URL (사전 로드용) */
  nextBackgroundUrl?: string;
  /** 포스터 이미지 URL */
  posterUrl?: string;
  /** 전체 화면 암전 여부 (B 단축키) */
  isBlackout?: boolean;
  /** 가사 숨김 여부 (H 단축키) */
  isLyricsHidden?: boolean;
  /** 텍스트 박스 DOM 참조 (편집기 Moveable 타깃용) */
  textBoxRef?: React.Ref<HTMLDivElement>;
  /** 텍스트 박스 드래그/리사이즈 진행 중 여부 */
  isTextInteracting?: boolean;
  /** 컨테이너 커스텀 크기 (선택적) */
  containerDimensions?: { width?: number; height?: number };
  /**
   * Layer 1을 영상 대신 포스터 이미지로 그린다 (편집기 썸네일용).
   * 썸네일 수십 장이 각자 `<video autoplay>`를 띄우지 않게 한다.
   */
  staticBackground?: boolean;
  className?: string;
}

/**
 * 3-Layer SlideStage 통합 컴포넌트
 * - 16:9 가상 스테이지(1920x1080) 위에서 DOM 3-Layer로 슬라이드를 렌더링
 * - Layer 1 (z-0): VideoLayer (Dual Video A/B 교차 루프)
 * - Layer 2 (z-10): OverlayLayer (Blackout & Opacity)
 * - Layer 3 (z-20): TextLayer (Typography & Safe Margin)
 * - useStageScale을 통해 어떤 해상도/비율/컨테이너에서도 왜곡 없이 화면 중앙에 scale
 */
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
        {/* Layer 1: Motion Background Loop (Dual Video A/B) — 썸네일은 정지 포스터 */}
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

        {/* Layer 2: Readability Black Overlay & Blackout */}
        <OverlayLayer
          opacity={style.overlayOpacity}
          color={style.overlayColor}
          isBlackout={isBlackout}
        />

        {/* Layer 3: Typography & Text Box */}
        {/* 블랙아웃은 '화면 검게 하기'(PRD 4.x)다. 오버레이만 불투명하게 만들면
            텍스트 레이어(z-20)가 오버레이(z-10) 위에 남아 가사가 계속 보인다. */}
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
