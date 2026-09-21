import React from "react";
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
  /** 컨테이너 커스텀 크기 (선택적) */
  containerDimensions?: { width?: number; height?: number };
  className?: string;
}

/**
 * 3-Layer SlideStage 통합 컴포넌트
 * - 16:9 가상 스테이지(1920x1080) 위에서 DOM 3-Layer로 슬라이드를 렌더링
 * - Layer 1 (z-0): VideoLayer (Dual Video A/B 교차 루프)
 * - Layer 2 (z-10): OverlayLayer (Blackout & Opacity)
 * - Layer 3 (z-20): TextLayer (Typography & Safe Margin)
 * - useStageScale을 통해 어떤 해상도/비율에서도 왜곡 없이 화면 중앙에 scale
 */
export function SlideStage({
  slide,
  style = DEFAULT_DECK_STYLE,
  backgroundUrl,
  nextBackgroundUrl,
  posterUrl,
  isBlackout = false,
  isLyricsHidden = false,
  containerDimensions,
  className = "",
}: SlideStageProps): React.JSX.Element {
  const { scale, translateX, translateY } = useStageScale(containerDimensions);

  return (
    <div
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
        {/* Layer 1: Motion Background Loop (Dual Video A/B) */}
        <VideoLayer
          src={backgroundUrl}
          nextSrc={nextBackgroundUrl}
          posterUrl={posterUrl}
        />

        {/* Layer 2: Readability Black Overlay & Blackout */}
        <OverlayLayer
          opacity={style.overlayOpacity}
          color={style.overlayColor}
          isBlackout={isBlackout}
        />

        {/* Layer 3: Typography & Text Box */}
        <TextLayer
          slide={slide}
          style={style}
          isLyricsHidden={isLyricsHidden}
        />
      </div>
    </div>
  );
}
