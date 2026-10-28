import { getChoseong } from "es-hangul";
import type { DeckDoc } from "./collections";

type DeckScopeFields = Pick<
  DeckDoc,
  "presentationId" | "visibility" | "takedownAt"
>;

type DeckIndexSource = DeckScopeFields &
  Pick<DeckDoc, "title" | "artist" | "lyricsRaw">;

/**
 * 공유 라이브러리에 보이는 곡: 공개한 보관함 곡 중 게시 중단되지 않은 것.
 *
 * 공개 범위는 이 함수 한 곳에서만 판정한다. 결과는 `listed`로 저장되고, 공개 곡을 읽는
 * 쿼리(검색·상세·가져오기·신고)는 모두 `listed == true`로 거른다.
 */
export function isListedDeck(deck: DeckScopeFields): boolean {
  return (
    deck.presentationId === null &&
    deck.visibility === "public" &&
    deck.takedownAt === null
  );
}

/** 검색이 비교하는 형태: 소문자, 글자·숫자 밖의 문자는 공백 */
export function normalizeSearchText(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ");
}

/** 낱말 안에서 이웃한 두 글자(코드 포인트) 묶음. 한 글자 낱말에는 없다 */
export function bigramsOf(text: string): string[] {
  const grams: string[] = [];
  for (const word of normalizeSearchText(text).split(" ")) {
    const chars = [...word];
    for (let i = 0; i + 1 < chars.length; i++) {
      grams.push(`${chars[i]}${chars[i + 1]}`);
    }
  }
  return grams;
}

/**
 * 초성 검색이 비교하는 형태: 한글 음절은 초성만 남기고 공백과 한글 밖의 글자는 뺀다
 * (`주님의 사랑` → `ㅈㄴㅇㅅㄹ`). 띄어 쓰지 않고 이어 친 초성도 맞게 공백을 뺀다.
 */
export function initialsOf(text: string): string {
  return getChoseong(text).replace(/\s+/g, "");
}

/**
 * 저장할 곡 문서에 공개 범위(`listed`)와 검색 색인(`searchGrams`)을 붙인다. 곡을 쓰는
 * 모든 경로는 최종 문서를 이 함수에 통과시킨다.
 *
 * Firestore에는 전문 검색이 없어 제목·아티스트·가사의 두 글자 묶음을 배열로 두고
 * `array-contains`로 후보를 고른 뒤 서버에서 부분 문자열로 다시 확인한다
 * (`queries/search.ts`). 초성 검색(`ㅈㄴ`)도 같은 배열과 복합 색인으로 후보를 고르게 제목·
 * 아티스트 초성(`initialsOf`)의 두 글자 묶음도 담는다. 가사에 자모로 적힌 글자(`ㅋㅋ`)의
 * 묶음과 값이 겹치지만, 검색은 초성 낱말을 글자 그대로도 찾으므로 둘을 나누지 않는다.
 * 공개 곡만 색인해 비공개 가사가 색인에 남지 않게 한다.
 *
 * 규칙이 바뀌어도 저장된 곡은 옛 색인으로 남는다. 배포가 끝나면 `scripts/reindexDecks.mjs`로
 * 다시 만든다.
 */
export function withDeckIndex<T extends DeckIndexSource>(
  deck: T,
): T & Pick<DeckDoc, "listed" | "searchGrams"> {
  const listed = isListedDeck(deck);
  const searchGrams = listed
    ? [
        ...new Set([
          ...[deck.title, deck.artist, deck.lyricsRaw].flatMap(bigramsOf),
          ...[deck.title, deck.artist].map(initialsOf).flatMap(bigramsOf),
        ]),
      ]
    : [];
  return { ...deck, listed, searchGrams };
}
