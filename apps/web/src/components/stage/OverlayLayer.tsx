import React from "react";

export interface OverlayLayerProps {
  /** 오버레이 불투명도 (0 ~ 100, 기본값: 40) */
  opacity?: number;
  /** 오버레이 색상 (기본값: #000000) */
  color?: string;
  /** 즉각 무대 전체 암전 여부 */
  isBlackout?: boolean;
  className?: string;
}

/**
 * 3-Layer Stage Layer 2: Black Overlay 가독성 조절 레이어
 * 비디오 배경과 텍스트 사이에 위치하여 배경 밝기를 0~100% 감쇄하거나 Blackout(B) 시 즉시 암전한다.
 */
export function OverlayLayer({
  opacity = 40,
  color = "#000000",
  isBlackout = false,
  className = "",
}: OverlayLayerProps): React.JSX.Element {
  // Clamped opacity: 0 ~ 1.0 (Blackout 시 즉시 1.0 강제)
  const effectiveOpacity = isBlackout
    ? 1
    : Math.max(0, Math.min(100, opacity)) / 100;

  return (
    <div
      data-testid="overlay-layer"
      className={`absolute inset-0 pointer-events-none transition-opacity duration-150 ease-out z-10 ${className}`}
      style={{
        backgroundColor: color,
        opacity: effectiveOpacity,
        willChange: "opacity",
      }}
    />
  );
}
