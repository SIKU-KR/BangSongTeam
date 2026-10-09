import type { BackgroundKind, BackgroundMedia } from "#shared";

export type BackgroundKindFilterValue = "all" | BackgroundKind;

/**
 * 배경 갤러리와 배경 선택 창이 같은 기준으로 거르도록 종류 필터와 검색 결과를 한 번에
 * 적용한다.
 *
 * 검색 결과(`resultIds`)가 있으면 그 순서(검색어와 가까운 순)를 따른다. 카탈로그에 없는
 * id는 버린다. 지운 배경의 벡터가 인덱스에 잠시 남을 수 있기 때문이다.
 */
export function filterBackgrounds(
  backgrounds: BackgroundMedia[],
  {
    kind,
    resultIds,
  }: { kind: BackgroundKindFilterValue; resultIds?: readonly string[] },
): BackgroundMedia[] {
  const byId = new Map(backgrounds.map((bg) => [bg.id, bg]));
  const ordered = resultIds
    ? resultIds.flatMap((id) => byId.get(id) ?? [])
    : backgrounds;
  return kind === "all" ? ordered : ordered.filter((bg) => bg.kind === kind);
}
