import type { TextBoxPosition } from "@repo/shared";

/** 화면(px) 기준 사각형. */
export interface PixelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 스테이지(1920x1080) 기준 % 사각형. */
export type PercentRect = PixelRect;

export const SAFE_MARGIN_PERCENT = 5;
export const MIN_WIDTH_PERCENT = 20;
export const MAX_WIDTH_PERCENT = 90;
export const SNAP_THRESHOLD_PERCENT = 1;

const CENTER_PERCENT = 50;
const MIN_COORD_PERCENT = 5;
const MAX_COORD_PERCENT = 95;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** 화면 px 사각형을 스테이지 기준 %로 환산한다. */
export function rectToPercent(box: PixelRect, stage: PixelRect): PercentRect {
  return {
    left: ((box.left - stage.left) / stage.width) * 100,
    top: ((box.top - stage.top) / stage.height) * 100,
    width: (box.width / stage.width) * 100,
    height: (box.height / stage.height) * 100,
  };
}

/** 폭을 20~90%로 제한하고 안전 여백 안으로 맞춘다. */
export function clampRect(rect: PercentRect): PercentRect {
  const width = clamp(rect.width, MIN_WIDTH_PERCENT, MAX_WIDTH_PERCENT);
  const maxLeft = MAX_COORD_PERCENT - width;
  const maxTop = MAX_COORD_PERCENT - rect.height;
  return {
    left: Math.max(SAFE_MARGIN_PERCENT, Math.min(rect.left, maxLeft)),
    top: Math.max(SAFE_MARGIN_PERCENT, Math.min(rect.top, maxTop)),
    width,
    height: rect.height,
  };
}

/** 포인터 이동량을 더해 새 사각형 위치를 계산한다. */
export function computeDragRect(
  start: PercentRect,
  dxPx: number,
  dyPx: number,
  stage: PixelRect,
): PercentRect {
  return clampRect({
    ...start,
    left: start.left + (dxPx / stage.width) * 100,
    top: start.top + (dyPx / stage.height) * 100,
  });
}

/** 좌/우 핸들 리사이즈를 계산한다. */
export function computeResizeRect(
  start: PercentRect,
  direction: 1 | -1,
  dxPx: number,
  stage: PixelRect,
): PercentRect {
  const dx = (dxPx / stage.width) * 100;
  const width = clamp(
    start.width + direction * dx,
    MIN_WIDTH_PERCENT,
    MAX_WIDTH_PERCENT,
  );
  const left = direction === 1 ? start.left : start.left + start.width - width;
  return clampRect({ ...start, left, width });
}

export interface SnapGuides {
  vertical: boolean;
  horizontal: boolean;
}

/** 박스 중심이 스테이지 중앙선에 가까우면 축별로 스냅한다. */
export function snapRect(
  rect: PercentRect,
  threshold: number = SNAP_THRESHOLD_PERCENT,
): { rect: PercentRect; guides: SnapGuides } {
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const snapX = Math.abs(centerX - CENTER_PERCENT) <= threshold;
  const snapY = Math.abs(centerY - CENTER_PERCENT) <= threshold;

  return {
    rect: {
      ...rect,
      left: snapX ? CENTER_PERCENT - rect.width / 2 : rect.left,
      top: snapY ? CENTER_PERCENT - rect.height / 2 : rect.top,
    },
    guides: { vertical: snapX, horizontal: snapY },
  };
}

/** % 사각형을 저장용 TextBoxPosition으로 변환한다. */
export function rectToPosition(rect: PercentRect): TextBoxPosition {
  return {
    anchor: "custom",
    xPercent: round2(
      clamp(rect.left + rect.width / 2, MIN_COORD_PERCENT, MAX_COORD_PERCENT),
    ),
    yPercent: round2(
      clamp(rect.top + rect.height / 2, MIN_COORD_PERCENT, MAX_COORD_PERCENT),
    ),
    widthPercent: round2(
      clamp(rect.width, MIN_WIDTH_PERCENT, MAX_WIDTH_PERCENT),
    ),
  };
}
