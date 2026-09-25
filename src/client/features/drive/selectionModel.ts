/**
 * 드라이브 목록의 선택 규칙 (순수 함수). 구글 드라이브의 클릭·키보드·드래그 선택과 같다.
 *
 * `keys`는 화면에 보이는 순서의 항목 키 목록이다.
 */

export interface KeyRect {
  key: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface SelectionBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Ctrl/⌘ + 클릭: 이 항목만 넣거나 뺀다 */
export function toggleKey(
  selection: ReadonlySet<string>,
  key: string,
): string[] {
  const next = new Set(selection);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return [...next];
}

/** Shift 범위 선택. 기준점이 목록에 없으면 대상 하나만 고른다 */
export function rangeKeys(
  keys: readonly string[],
  anchor: string | null,
  target: string,
): string[] {
  const to = keys.indexOf(target);
  if (to === -1) return [];
  const from = anchor === null ? -1 : keys.indexOf(anchor);
  if (from === -1) return [target];
  const [start, end] = from < to ? [from, to] : [to, from];
  return keys.slice(start, end + 1);
}

/** 두 선택을 순서를 지키며 합친다 (Ctrl+Shift 범위 추가, Ctrl 드래그 선택) */
export function mergeKeys(
  base: readonly string[],
  extra: readonly string[],
): string[] {
  return [...new Set([...base, ...extra])];
}

/**
 * 방향키·Home·End로 옮길 다음 포커스. `delta`는 ±1 또는 ±Infinity(처음·끝)다.
 * 포커스가 목록에 없으면 아래쪽 이동은 첫 항목, 위쪽 이동은 마지막 항목에서 시작한다.
 */
export function stepFocus(
  keys: readonly string[],
  focus: string | null,
  delta: number,
): string | null {
  if (keys.length === 0) return null;
  const current = focus === null ? -1 : keys.indexOf(focus);
  if (current === -1) return delta > 0 ? keys[0] : keys[keys.length - 1];
  const next = Math.min(keys.length - 1, Math.max(0, current + delta));
  return keys[next];
}

/** 드래그 선택 사각형과 겹치는 항목 (화면 좌표) */
export function marqueeKeys(
  rects: readonly KeyRect[],
  box: SelectionBox,
): string[] {
  return rects
    .filter(
      (rect) =>
        rect.left < box.right &&
        rect.right > box.left &&
        rect.top < box.bottom &&
        rect.bottom > box.top,
    )
    .map((rect) => rect.key);
}
