/**
 * 썸네일 창의 클릭·우클릭 대상을 DOM data 속성으로 주고받는다. 썸네일은 `memo`로
 * 감싸 원시값 props만 받으므로, 창이 이벤트를 위임받아 이 속성으로 대상을 읽는다.
 */
export type PaneTarget =
  | { kind: "slide"; songIndex: number; slideIndex: number }
  | { kind: "gap"; songIndex: number; index: number }
  | { kind: "header"; songIndex: number };

/** 슬라이드 썸네일 창. 창 자체가 listbox라 단축키는 위젯 판별보다 먼저 본다 */
export const SLIDE_PANE_SELECTOR = "[data-slide-pane]";

const THUMB_SELECTOR = "[data-slide-thumb]";
const GAP_SELECTOR = "[data-slide-gap]";
const HEADER_SELECTOR = "[data-song-header]";

/** 대상 요소에 펼쳐 넣을 data 속성. `readPaneTarget`이 같은 속성을 읽는다 */
export function paneTargetAttrs(
  target: PaneTarget,
): Record<`data-${string}`, string | number> {
  switch (target.kind) {
    case "slide":
      return {
        "data-slide-thumb": "",
        "data-song-index": target.songIndex,
        "data-slide-index": target.slideIndex,
      };
    case "gap":
      return {
        "data-slide-gap": "",
        "data-song-index": target.songIndex,
        "data-gap-index": target.index,
      };
    case "header":
      return {
        "data-song-header": "",
        "data-song-index": target.songIndex,
      };
  }
}

const indexOf = (element: Element, name: string): number =>
  Number(element.getAttribute(name));

/** 이벤트가 난 요소에서 가장 가까운 대상을 썸네일 → 틈 → 곡 머리글 순으로 찾는다 */
export function readPaneTarget(element: Element): PaneTarget | null {
  const thumb = element.closest(THUMB_SELECTOR);
  if (thumb) {
    return {
      kind: "slide",
      songIndex: indexOf(thumb, "data-song-index"),
      slideIndex: indexOf(thumb, "data-slide-index"),
    };
  }
  const gap = element.closest(GAP_SELECTOR);
  if (gap) {
    return {
      kind: "gap",
      songIndex: indexOf(gap, "data-song-index"),
      index: indexOf(gap, "data-gap-index"),
    };
  }
  const header = element.closest(HEADER_SELECTOR);
  if (header) {
    return { kind: "header", songIndex: indexOf(header, "data-song-index") };
  }
  return null;
}
