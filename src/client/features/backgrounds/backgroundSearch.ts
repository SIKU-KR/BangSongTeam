import type { BackgroundKind, BackgroundMedia } from "#shared";

export type BackgroundKindFilterValue = "all" | BackgroundKind;

function searchTokens(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

function matchesQuery(background: BackgroundMedia, tokens: string[]): boolean {
  const haystack = [
    background.title,
    background.description,
    ...background.keywords,
  ]
    .join("\n")
    .toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

/**
 * 배경 갤러리와 배경 선택 창이 같은 기준으로 거르도록 종류 필터와 검색어를 한 번에
 * 적용한다.
 *
 * 검색은 기기에 받아 둔 카탈로그로 한다. 검색어의 낱말이 모두 제목·설명·키워드 중 어딘가에
 * 들어 있는 배경만 남기고 카탈로그 순서를 지킨다. 오프라인에서도 같은 결과가 나온다.
 */
export function filterBackgrounds(
  backgrounds: BackgroundMedia[],
  { kind, query = "" }: { kind: BackgroundKindFilterValue; query?: string },
): BackgroundMedia[] {
  const tokens = searchTokens(query);
  return backgrounds.filter(
    (bg) =>
      (kind === "all" || bg.kind === kind) &&
      (tokens.length === 0 || matchesQuery(bg, tokens)),
  );
}
