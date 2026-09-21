import type { TextBoxPosition } from "@repo/shared";

/** 화면(px) 기준 사각형 (getBoundingClientRect 호환) */
export interface PixelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 스테이지(1920x1080) 기준 % 사각형 */
export type PercentRect = PixelRect;

export const SAFE_MARGIN_PERCENT = 5;
export const MIN_WIDTH_PERCENT = 20;
export const MAX_WIDTH_PERCENT = 90;
/** 중앙선 스냅 임계값 (스테이지 %) */
export const SNAP_THRESHOLD_PERCENT = 1;

const CENTER_PERCENT = 50;
const MIN_COORD_PERCENT = 5;
const MAX_COORD_PERCENT = 95;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * 화면 px 사각형을 스테이지 기준 %로 환산한다.
 * 스테이지 자체가 CSS scale/줌으로 축소되어 있어도 두 rect가 같은 좌표계라 비율은 유지된다.
 */
export function rectToPercent(box: PixelRect, stage: PixelRect): PercentRect {
  return {
    left: ((box.left - stage.left) / stage.width) * 100,
    top: ((box.top - stage.top) / stage.height) * 100,
    width: (box.width / stage.width) * 100,
    height: (box.height / stage.height) * 100,
  };
}

/**
 * 폭을 20~90%로 제한하고, 박스 전체를 상하좌우 5% 안전 여백 안으로 밀어 넣는다.
 * 높이가 안전 영역보다 크면 top을 5%에 고정한다.
 */
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

/**
 * 드래그 시작 시점의 % 사각형에 포인터 이동량(px)을 더해 새 위치를 계산한다.
 */
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

/**
 * 좌/우 핸들 리사이즈. 반대쪽 가장자리를 고정하고 폭만 바꾼다.
 * @param direction 1: 동쪽(오른쪽) 핸들, -1: 서쪽(왼쪽) 핸들
 */
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

/**
 * 박스 중심이 스테이지 중앙선(50%)에 임계값 이내로 가까우면 축별로 스냅한다.
 */
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

/**
 * % 사각형을 저장용 TextBoxPosition으로 변환한다.
 * TextLayer의 custom 앵커는 translate(-50%, -50%)이므로 좌표는 박스 중심이다.
 * 스키마 범위(좌표 5~95, 폭 20~90)로 clamp 하고 소수 둘째 자리로 반올림한다.
 */
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
