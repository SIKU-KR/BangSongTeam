/**
 * 가사 카탈로그 정규화 키.
 *
 * `lyrics_catalog.title_norm` / `artist_norm`을 만드는 규칙이다. 서버와
 * 클라이언트가 같은 규칙을 써야 같은 곡이 같은 카탈로그로 모인다. 규칙이
 * 갈라지면 '은혜로다'가 카탈로그 두 개로 쪼개져 정규화 대상이 되지 않는다.
 */
export function normalizeCatalogKey(value: string): string {
  return (
    value
      .normalize("NFKC")
      .toLowerCase()
      // 글자와 숫자만 남긴다 (공백·괄호·느낌표·중점 등 제거)
      .replace(/[^\p{L}\p{N}]/gu, "")
  );
}

/** 제목·아티스트를 한 쌍으로 정규화한다 */
export function buildCatalogKey(
  title: string,
  artist: string,
): { titleNorm: string; artistNorm: string } {
  return {
    titleNorm: normalizeCatalogKey(title),
    artistNorm: normalizeCatalogKey(artist),
  };
}
