import {
  hangulIncludes,
  type BackgroundKind,
  type BackgroundMedia,
} from "#shared";

export type BackgroundKindFilterValue = "all" | BackgroundKind;

/**
 * 배경 검색. 띄어쓰기로 나눈 단어가 모두 맞아야 통과한다 ("파란 구름").
 *
 * 제목과 키워드는 초성·자모·영타 검색까지 받는다. 키워드는 한 문자열로 이으면 초성이
 * 여러 키워드에 걸쳐 우연히 맞으므로 하나씩 본다. 설명 문장은 길어서 초성 일치가 거의
 * 모든 검색어에 걸리므로 글자 그대로 포함될 때만 맞는다.
 */
export function matchesBackgroundQuery(
  background: BackgroundMedia,
  query: string,
): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const description = background.description.toLowerCase();
  return terms.every(
    (term) =>
      hangulIncludes(background.title, term) ||
      background.keywords.some((keyword) => hangulIncludes(keyword, term)) ||
      description.includes(term),
  );
}

/**
 * 배경 종류(영상·이미지)로 거른다. `all`이면 원래 배열을 그대로 돌려준다.
 */
export function filterBackgroundsByKind(
  backgrounds: BackgroundMedia[],
  kind: BackgroundKindFilterValue,
): BackgroundMedia[] {
  return kind === "all"
    ? backgrounds
    : backgrounds.filter((bg) => bg.kind === kind);
}

/**
 * 배경 갤러리와 배경 선택 창이 같은 기준으로 거르도록 종류와 검색어를 한 번에 적용한다.
 */
export function filterBackgrounds(
  backgrounds: BackgroundMedia[],
  { kind, query }: { kind: BackgroundKindFilterValue; query: string },
): BackgroundMedia[] {
  return filterBackgroundsByKind(backgrounds, kind).filter((bg) =>
    matchesBackgroundQuery(bg, query),
  );
}
