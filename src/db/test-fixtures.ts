import type { NewDeck } from "./schema";

const EPOCH = new Date(0);

/**
 * 테스트에 직접 넣는 덱 행. 필수 컬럼에 빈 곡 내용과 시각 0을 채운다.
 * 프레젠테이션 사본은 `presentationId`·`itemId`·`position`을 함께 넘긴다.
 */
export function deckRow(
  row: Pick<NewDeck, "id" | "userId"> & Partial<NewDeck>,
): NewDeck {
  return {
    title: "song",
    lyricsRaw: "lyrics",
    slides: "[]",
    style: "{}",
    createdAt: EPOCH,
    updatedAt: EPOCH,
    ...row,
  };
}
