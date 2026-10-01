import type { Deck } from "../schemas/deck";
import { hangulIncludes } from "./hangulSearch";

/**
 * 곡 검색. 제목·아티스트·가사 중 하나라도 한글 검색 기준에 맞으면 통과한다.
 * 곡 선택 창의 내 곡과 공유 라이브러리 곡이 같은 기준으로 걸러지도록 한 곳에 둔다.
 */
export function deckMatchesQuery(
  deck: Pick<Deck, "title" | "artist" | "lyricsRaw">,
  query: string,
): boolean {
  return (
    hangulIncludes(deck.title, query) ||
    hangulIncludes(deck.artist, query) ||
    hangulIncludes(deck.lyricsRaw, query)
  );
}
