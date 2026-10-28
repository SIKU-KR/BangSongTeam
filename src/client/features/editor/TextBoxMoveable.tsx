import React, { useEffect, useRef } from "react";
import Moveable, {
  type OnDrag,
  type OnDragStart,
  type OnResize,
  type OnResizeStart,
} from "react-moveable";
import type { TextBoxPosition } from "#shared";
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

interface TextBoxMoveableProps {
  target: HTMLElement | null;
  refreshKey: string;
  onPreview: (position: TextBoxPosition | null, guides: SnapGuides) => void;
  onCommit: (position: TextBoxPosition) => void;
  onDoubleClick?: () => void;
}

interface GestureState {
  rect: PercentRect;
  startX: number;
  startY: number;
  direction: 1 | -1 | 0;
  last: PercentRect | null;
}

const NO_GUIDES: SnapGuides = { vertical: false, horizontal: false };

/**
 * 편집 캔버스 전용 텍스트 박스 조작 컴포넌트.
 *
 * react-moveable은 대상 자신의 크기·스타일 변화만 따라가고 조상의 변화는 따라가지 않는다. 스테이지
 * scale(창 폭, 태블릿·폰 회전)과 확대 배율은 조상의 인라인 `style`로 바뀌므로, 돌린 뒤에도 컨트롤 박스가
 * 옛 자리에 남아 핸들이 화면 밖으로 나가고 조작 영역이 이전·다음 버튼을 덮어 버튼이 눌리지 않았다.
 * 조상의 `style`이 바뀔 때 다시 맞춘다. 창 resize 이벤트에 걸면 React가 scale을 반영하기 전에 재서
 * 같은 문제가 남는다.
 * react-moveable@0.56.0 dist/moveable.esm.js (`MoveableManager.updateRect`는 창 크기가 바뀔 때 직접
 * 부르라고 안내한다)
 */
export function TextBoxMoveable({
  target,
  refreshKey,
  onPreview,
  onCommit,
  onDoubleClick,
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

  useEffect(() => {
    if (!target || typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => {
      moveableRef.current?.updateRect("", true, true);
    });
    for (let el = target.parentElement; el; el = el.parentElement) {
      observer.observe(el, { attributes: true, attributeFilter: ["style"] });
    }
    return () => observer.disconnect();
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
      onClick={(e) => {
        if (e.isDouble) onDoubleClick?.();
      }}
    />
  );
}
