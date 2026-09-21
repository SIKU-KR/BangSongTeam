import React, { useEffect, useRef } from "react";
import Moveable, {
  type OnDrag,
  type OnDragStart,
  type OnResize,
  type OnResizeStart,
} from "react-moveable";
import type { TextBoxPosition } from "@repo/shared";
import {
  clampRect,
  computeDragRect,
  computeResizeRect,
  rectToPercent,
  rectToPosition,
  snapRect,
  type PercentRect,
  type SnapGuides,
} from "./textBoxDrag";

export interface TextBoxMoveableProps {
  /** TextLayer의 텍스트 박스 DOM (Moveable 타깃) */
  target: HTMLElement | null;
  /** 타깃 위치/크기에 영향을 주는 값이 바뀌면 컨트롤 박스를 다시 맞춘다 */
  refreshKey: string;
  /** 드래그/리사이즈 중 실시간 미리보기 (null이면 미리보기 종료) */
  onPreview: (position: TextBoxPosition | null, guides: SnapGuides) => void;
  /** 제스처가 끝났을 때 1회 호출 — 스토어 히스토리는 이 시점에만 쌓는다 */
  onCommit: (position: TextBoxPosition) => void;
}

interface GestureState {
  /** 제스처 시작 시점의 박스 (스테이지 %) */
  rect: PercentRect;
  startX: number;
  startY: number;
  /** 1: 동쪽 핸들, -1: 서쪽 핸들, 0: 이동 */
  direction: 1 | -1 | 0;
  /** 마지막으로 계산된 박스 */
  last: PercentRect | null;
}

const NO_GUIDES: SnapGuides = { vertical: false, horizontal: false };

/**
 * 편집 캔버스 전용 텍스트 박스 조작 레이어 (react-moveable)
 * - 본문 드래그: 이동 + 중앙선 스냅 + 5% 안전 여백 제한
 * - 좌/우 핸들: 폭 조절 (20~90%)
 *
 * TextLayer가 앵커별 transform을 인라인으로 쓰기 때문에 Moveable이 target의 style을
 * 직접 바꾸지 않게 하고, 포인터 이동량을 스테이지 % 좌표로 환산해 상위 상태로 올린다.
 * 놓는 순간 custom 앵커 위치로 한 번만 커밋한다.
 *
 * `container` prop은 지정하지 않는다. 스케일된 조상 안에서는 지정 시 컨트롤 박스
 * 오프셋이 이중으로 계산되어, 기본값(컨트롤 박스의 offsetParent)을 쓴다.
 */
export function TextBoxMoveable({
  target,
  refreshKey,
  onPreview,
  onCommit,
}: TextBoxMoveableProps): React.JSX.Element | null {
  const moveableRef = useRef<Moveable>(null);
  const gestureRef = useRef<GestureState | null>(null);

  // 위치/스타일이 바뀌면 컨트롤 박스를 타깃에 다시 맞춘다.
  // Moveable은 첫 렌더에서 controlBox ref가 없어 visibility: hidden으로 그리므로,
  // setState(3번째 인자)로 재렌더를 강제해야 컨트롤 박스가 나타난다.
  useEffect(() => {
    moveableRef.current?.updateRect("", true, true);
  }, [refreshKey, target]);

  if (!target) return null;

  // TextLayer 컨테이너(absolute inset-0)가 1920x1080 스테이지 전체를 덮는다
  const getStageRect = (): DOMRect | null =>
    (target.offsetParent as HTMLElement | null)?.getBoundingClientRect() ??
    null;

  const begin = (
    e: OnDragStart | OnResizeStart,
    direction: GestureState["direction"],
  ) => {
    const stage = getStageRect();
    if (!stage || stage.width === 0 || stage.height === 0) return false;
    gestureRef.current = {
      rect: rectToPercent(target.getBoundingClientRect(), stage),
      startX: e.clientX,
      startY: e.clientY,
      direction,
      last: null,
    };
    return true;
  };

  const preview = (rect: PercentRect, guides: SnapGuides) => {
    if (gestureRef.current) gestureRef.current.last = rect;
    onPreview(rectToPosition(rect), guides);
  };

  const handleDrag = (e: OnDrag) => {
    const gesture = gestureRef.current;
    const stage = getStageRect();
    if (!gesture || !stage) return;
    const moved = computeDragRect(
      gesture.rect,
      e.clientX - gesture.startX,
      e.clientY - gesture.startY,
      stage,
    );
    const { rect, guides } = snapRect(moved);
    preview(clampRect(rect), guides);
  };

  const handleResize = (e: OnResize) => {
    const gesture = gestureRef.current;
    const stage = getStageRect();
    if (!gesture || !stage || gesture.direction === 0) return;
    preview(
      computeResizeRect(
        gesture.rect,
        gesture.direction,
        e.clientX - gesture.startX,
        stage,
      ),
      NO_GUIDES,
    );
  };

  const finish = () => {
    const last = gestureRef.current?.last;
    gestureRef.current = null;
    if (last) onCommit(rectToPosition(last));
    onPreview(null, NO_GUIDES);
  };

  return (
    <Moveable
      ref={moveableRef}
      target={target}
      origin={false}
      dragArea
      draggable
      resizable
      keepRatio={false}
      renderDirections={["w", "e"]}
      throttleDrag={0}
      throttleResize={0}
      useResizeObserver
      onDragStart={(e) => {
        begin(e, 0);
      }}
      onDrag={handleDrag}
      onDragEnd={finish}
      onResizeStart={(e) => {
        begin(e, e.direction[0] === -1 ? -1 : 1);
      }}
      onResize={handleResize}
      onResizeEnd={finish}
    />
  );
}
