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
  target: HTMLElement | null;
  refreshKey: string;
  onPreview: (position: TextBoxPosition | null, guides: SnapGuides) => void;
  onCommit: (position: TextBoxPosition) => void;
}

interface GestureState {
  rect: PercentRect;
  startX: number;
  startY: number;
  direction: 1 | -1 | 0;
  last: PercentRect | null;
}

const NO_GUIDES: SnapGuides = { vertical: false, horizontal: false };

/** 편집 캔버스 전용 텍스트 박스 조작 컴포넌트. */
export function TextBoxMoveable({
  target,
  refreshKey,
  onPreview,
  onCommit,
}: TextBoxMoveableProps): React.JSX.Element | null {
  const moveableRef = useRef<Moveable>(null);
  const gestureRef = useRef<GestureState | null>(null);

  useEffect(() => {
    moveableRef.current?.updateRect("", true, true);
  }, [refreshKey, target]);

  useEffect(() => {
    if (!target) return;
    let frame = 0;
    const follow = () => {
      moveableRef.current?.updateRect("", true, true);
      frame =
        target.getAnimations().length > 0 ? requestAnimationFrame(follow) : 0;
    };
    const sync = () => {
      if (!frame) frame = requestAnimationFrame(follow);
    };
    const events = ["transitionrun", "transitionend", "transitioncancel"];
    events.forEach((type) => target.addEventListener(type, sync));
    return () => {
      events.forEach((type) => target.removeEventListener(type, sync));
      cancelAnimationFrame(frame);
    };
  }, [target]);

  if (!target) return null;

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
