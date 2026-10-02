import React from "react";

interface OverlayLayerProps {
  opacity?: number;
  color?: string;
  isBlackout?: boolean;
}

/**
 * 배경 밝기를 조절하거나 암전하는 오버레이 레이어.
 * 암전은 덱의 오버레이 색과 상관없이 항상 검정이다. 색은 API나 공유 데이터로도 바뀔 수 있어
 * 그대로 쓰면 암전 화면이 흰색이나 다른 색으로 송출될 수 있다.
 * 색도 투명도와 함께 서서히 바꾼다. 색만 바로 바뀌면 암전을 풀 때 밝은 오버레이 색이 번쩍인다.
 */
export function OverlayLayer({
  opacity = 40,
  color = "#000000",
  isBlackout = false,
}: OverlayLayerProps): React.JSX.Element {
  const effectiveOpacity = isBlackout
    ? 1
    : Math.max(0, Math.min(100, opacity)) / 100;

  return (
    <div
      data-testid="overlay-layer"
      className="pointer-events-none absolute inset-0 z-10 transition duration-150 ease-out"
      style={{
        backgroundColor: isBlackout ? "#000000" : color,
        opacity: effectiveOpacity,
        willChange: "opacity",
      }}
    />
  );
}
