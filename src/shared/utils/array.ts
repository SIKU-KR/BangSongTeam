/**
 * 원소가 정확히 하나일 때만 그 원소를 돌려준다.
 *
 * `items.length === 1`로 확인해도 TS는 `items[0]`을 좁히지 못한다. 하나일 때만 이름을
 * 쓰는 문구나 단축키(열기, 이름 바꾸기)가 길이 확인과 원소 꺼내기를 한 번에 하게 한다.
 */
export function onlyItem<T>(items: readonly T[]): T | undefined {
  return items.length === 1 ? items[0] : undefined;
}

/** `index`번째 원소를 처음부터 돌아가며 고른다. 비어 있으면 `undefined` */
export function cycleItem<T>(
  items: readonly T[],
  index: number,
): T | undefined {
  return items.length > 0 ? items[index % items.length] : undefined;
}
