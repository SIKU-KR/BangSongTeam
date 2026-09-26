import type {
  Deck,
  PresentationChanges,
  PresentationDocument,
} from "../schemas";

/**
 * 문서를 변경분 저장 본문으로 바꾼다. `includeDeck`을 생략하면 모든 덱을 담는다.
 *
 * 항목은 `order` 순으로 정렬하고, 항목의 `deckId`는 임베드된 덱의 id를 따른다
 * (서버가 조인하는 기준이 덱 id이기 때문이다).
 */
export function toPresentationChanges(
  doc: PresentationDocument,
  includeDeck: (deck: Deck) => boolean = () => true,
): PresentationChanges {
  const { items, ...header } = doc;
  const ordered = [...items].sort((a, b) => a.order - b.order);
  return {
    ...header,
    items: ordered.map((item) => ({
      id: item.id,
      deckId: item.deck.id,
      order: item.order,
    })),
    decks: ordered.map((item) => item.deck).filter(includeDeck),
  };
}
