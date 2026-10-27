import type { Deck } from "../schemas/deck";
import {
  hangulIncludesPrepared,
  prepareHangulTarget,
  type HangulTarget,
} from "./hangulSearch";

type SearchableDeck = Pick<Deck, "title" | "artist" | "lyricsRaw">;

interface DeckTargets {
  title: HangulTarget;
  artist: HangulTarget;
  lyrics: HangulTarget;
}

const targetsByDeck = new WeakMap<SearchableDeck, DeckTargets>();

function targetsOf(deck: SearchableDeck): DeckTargets {
  const cached = targetsByDeck.get(deck);
  if (
    cached &&
    cached.title.source === deck.title &&
    cached.artist.source === deck.artist &&
    cached.lyrics.source === deck.lyricsRaw
  ) {
    return cached;
  }
  const targets = {
    title: prepareHangulTarget(deck.title),
    artist: prepareHangulTarget(deck.artist),
    lyrics: prepareHangulTarget(deck.lyricsRaw),
  };
  targetsByDeck.set(deck, targets);
  return targets;
}

/**
 * 곡 검색. 제목·아티스트·가사 중 하나라도 한글 검색 기준에 맞으면 통과한다.
 * 곡 선택 창의 내 곡 목록과 드라이브 검색(프레젠테이션에 담긴 곡)이 같은 기준으로
 * 걸러지도록 한 곳에 둔다.
 *
 * 검색어 글자마다 모든 곡의 가사를 다시 풀면 곡이 많은 드라이브에서 입력이 밀린다. 곡 객체별로
 * 풀어 낸 결과를 두고 다시 쓴다. 곡을 고치면 새 객체가 되므로 낡을 일이 없고, 같은 객체를
 * 제자리에서 고쳐도 글이 바뀐 것을 알아보고 다시 푼다.
 */
export function deckMatchesQuery(deck: SearchableDeck, query: string): boolean {
  const { title, artist, lyrics } = targetsOf(deck);
  return (
    hangulIncludesPrepared(title, query) ||
    hangulIncludesPrepared(artist, query) ||
    hangulIncludesPrepared(lyrics, query)
  );
}
