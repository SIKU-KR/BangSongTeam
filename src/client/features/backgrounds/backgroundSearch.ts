import { hangulIncludes, type BackgroundMedia } from "#shared";

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
