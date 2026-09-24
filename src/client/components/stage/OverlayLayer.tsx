import React from "react";

export interface OverlayLayerProps {
  opacity?: number;
  color?: string;
  isBlackout?: boolean;
  className?: string;
}

/** 배경 밝기를 조절하거나 암전하는 오버레이 레이어 */
export function OverlayLayer({
  opacity = 40,
  color = "#000000",
  isBlackout = false,
  className = "",
}: OverlayLayerProps): React.JSX.Element {
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
