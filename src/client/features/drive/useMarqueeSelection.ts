import React, { useCallback, useEffect, useRef, useState } from "react";
import { marqueeKeys, mergeKeys, type SelectionBox } from "./selectionModel";

const DRAG_THRESHOLD_PX = 4;

const IGNORED_TARGETS =
  '[data-item-key], [data-testid="drive-trash-folder"], button, a, input, [role="menu"], [role="columnheader"]';

interface MarqueeStart {
  x: number;
  y: number;
  scrollTop: number;
  base: string[];
  active: boolean;
}

export interface MarqueeOptions {
  containerRef: React.RefObject<HTMLElement | null>;
  enabled: boolean;
  selection: ReadonlySet<string>;
  onSelect: (keys: string[]) => void;
}

/**
 * 빈 곳에서 끌어 사각형으로 여러 항목을 고르는 드래그 선택 (구글 드라이브와 같다).
 *
 * 행·버튼 위에서 시작하면 무시하므로 항목 끌어 옮기기(dnd-kit)와 겹치지 않는다.
 * Ctrl/⌘/Shift를 누른 채 시작하면 기존 선택에 더한다. 4px 안에서 떼면 평범한
 * 클릭으로 두고, 실제로 끌었으면 바로 이어지는 클릭(선택 해제)을 `consumeClick`이 삼킨다.
 */
export function useMarqueeSelection({
  containerRef,
  enabled,
  selection,
  onSelect,
}: MarqueeOptions): {
  box: SelectionBox | null;
  onMouseDown: (event: React.MouseEvent) => void;
  consumeClick: () => boolean;
} {
  const [box, setBox] = useState<SelectionBox | null>(null);
  const [tracking, setTracking] = useState(false);
  const startRef = useRef<MarqueeStart | null>(null);
  const suppressClickRef = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const update = useCallback(
    (clientX: number, clientY: number): void => {
      const start = startRef.current;
      const container = containerRef.current;
      if (!start || !container) return;
      const startY = start.y - (container.scrollTop - start.scrollTop);
      if (
        !start.active &&
        Math.hypot(clientX - start.x, clientY - start.y) < DRAG_THRESHOLD_PX
      ) {
        return;
      }
      start.active = true;
      const next: SelectionBox = {
        left: Math.min(start.x, clientX),
        right: Math.max(start.x, clientX),
        top: Math.min(startY, clientY),
        bottom: Math.max(startY, clientY),
      };
      setBox(next);
      const rects = [
        ...container.querySelectorAll<HTMLElement>("[data-item-key]"),
      ].map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          key: node.dataset.itemKey ?? "",
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        };
      });
      onSelectRef.current(mergeKeys(start.base, marqueeKeys(rects, next)));
    },
    [containerRef],
  );

  useEffect(() => {
    if (!tracking) return;
    const handleMove = (event: MouseEvent): void =>
      update(event.clientX, event.clientY);
    const handleUp = (): void => {
      if (startRef.current?.active) {
        suppressClickRef.current = true;
        setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }
      startRef.current = null;
      setBox(null);
      setTracking(false);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [tracking, update]);

  const onMouseDown = useCallback(
    (event: React.MouseEvent): void => {
      if (!enabled || event.button !== 0) return;
      const target = event.target as HTMLElement;
      if (target.closest(IGNORED_TARGETS)) return;
      const additive = event.metaKey || event.ctrlKey || event.shiftKey;
      startRef.current = {
        x: event.clientX,
        y: event.clientY,
        scrollTop: containerRef.current?.scrollTop ?? 0,
        base: additive ? [...selection] : [],
        active: false,
      };
      suppressClickRef.current = false;
      setTracking(true);
      event.preventDefault();
    },
    [enabled, selection, containerRef],
  );

  const consumeClick = useCallback((): boolean => {
    const suppressed = suppressClickRef.current;
    suppressClickRef.current = false;
    return suppressed;
  }, []);

  return { box, onMouseDown, consumeClick };
}
