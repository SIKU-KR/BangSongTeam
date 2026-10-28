import { useLayoutEffect, useState } from "react";
import { VIRTUAL_STAGE_HEIGHT, VIRTUAL_STAGE_WIDTH } from "./useStageScale";

/**
 * 높이가 `areaHeight`인 영역에 16:9 스테이지가 통째로 들어가는 가장 넓은 폭. 폭만 보고 스테이지를
 * 맞추면 가로로 돌린 폰처럼 낮은 영역에서는 스테이지가 영역보다 커져 위아래가 잘린다.
 */
export function stageWidthLimit(areaHeight: number): number {
  return (areaHeight * VIRTUAL_STAGE_WIDTH) / VIRTUAL_STAGE_HEIGHT;
}

function contentHeight(area: HTMLElement): number {
  const style = getComputedStyle(area);
  return (
    area.clientHeight -
    (Number.parseFloat(style.paddingTop) || 0) -
    (Number.parseFloat(style.paddingBottom) || 0)
  );
}

/**
 * `area` 안쪽 높이에 16:9 스테이지가 통째로 들어가는 가장 넓은 폭(px). 폭은 CSS가 영역 폭에 맞추므로 이
 * 값은 CSS가 알 수 없는 높이에서 오는 한계만 알려 준다. 폭과 높이 중 더 모자란 쪽에 맞추려면 스테이지
 * 폭을 `min(100%, 이 값)`으로 둔다. 높이는 `aspect-ratio`가 폭을 따라 정한다.
 *
 * 첫 그림 전에 재므로 한 번 그린 뒤 바로잡는 번쩍임이 없고, 영역 크기가 바뀔 때(기기 회전, 창)마다 다시
 * 잰다. 높이가 그대로이면 상태를 건드리지 않아 폭만 바뀌는 창 크기 조절에는 다시 그리지 않는다. 영역이
 * 없거나 높이가 아직 잡히지 않았으면 `null`이라 한계를 두지 않는다. `ResizeObserver`가 없는 환경에서는
 * 처음 잰 값만 쓴다.
 */
export function useStageWidthLimit(area: HTMLElement | null): number | null {
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!area) return;
    let measured: number | null = null;
    const measure = (): void => {
      const next = contentHeight(area);
      if (next === measured) return;
      measured = next;
      setHeight(next);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    return () => observer.disconnect();
  }, [area]);

  return area && height !== null && height > 0 ? stageWidthLimit(height) : null;
}
