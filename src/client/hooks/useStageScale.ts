import { useState, useEffect } from "react";

export interface StageScaleResult {
  scale: number;
  translateX: number;
  translateY: number;
  stageWidth: number;
  stageHeight: number;
}

export interface UseStageScaleOptions {
  width?: number;
  height?: number;
}

export const VIRTUAL_STAGE_WIDTH = 1920;
export const VIRTUAL_STAGE_HEIGHT = 1080;

/**
 * 16:9 가상 스테이지(1920x1080)를 왜곡 없이 컨테이너 영역에 맞추기 위한 scale 및 center translate 오프셋 계산
 */
export function calculateStageScale(
  containerWidth: number,
  containerHeight: number,
  stageWidth = VIRTUAL_STAGE_WIDTH,
  stageHeight = VIRTUAL_STAGE_HEIGHT,
): StageScaleResult {
  if (containerWidth <= 0 || containerHeight <= 0) {
    return {
      scale: 1,
      translateX: 0,
      translateY: 0,
      stageWidth,
      stageHeight,
    };
  }

  const scale = Math.min(
    containerWidth / stageWidth,
    containerHeight / stageHeight,
  );
  const scaledWidth = stageWidth * scale;
  const scaledHeight = stageHeight * scale;

  const translateX = (containerWidth - scaledWidth) / 2;
  const translateY = (containerHeight - scaledHeight) / 2;

  return {
    scale,
    translateX,
    translateY,
    stageWidth,
    stageHeight,
  };
}

/**
 * 반응형 화면 크기 변경을 감지하여 16:9 가상 스테이지의 CSS scale/translate를 반환하는 훅
 */
export function useStageScale(
  options?: UseStageScaleOptions,
): StageScaleResult {
  const [windowDimensions, setWindowDimensions] = useState(() => {
    if (typeof window !== "undefined") {
      return { width: window.innerWidth, height: window.innerHeight };
    }
    return { width: VIRTUAL_STAGE_WIDTH, height: VIRTUAL_STAGE_HEIGHT };
  });

  useEffect(() => {
    if (options?.width !== undefined && options?.height !== undefined) {
      return;
    }

    const handleResize = (): void => {
      setWindowDimensions({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    handleResize();

    window.addEventListener("resize", handleResize);
    return (): void => {
      window.removeEventListener("resize", handleResize);
    };
  }, [options?.width, options?.height]);

  const targetWidth = options?.width ?? windowDimensions.width;
  const targetHeight = options?.height ?? windowDimensions.height;

  return calculateStageScale(targetWidth, targetHeight);
}
