import type { Deck } from "@repo/shared";

export interface LibraryMergeResult {
  /** 병합된 보관함 곡 목록 */
  decks: Deck[];
  /** 서버에 올려야 하는 곡 id (로컬이 더 최신이거나 서버에 없음) */
  needsPush: string[];
}

/**
 * 서버가 소유하는 공유 필드 (M5-1).
 *
 * 동기화 PUT은 이 값을 바꾸지 못한다. 공개 전환·가져오기·게시 중단은 서버에서만
 * 일어나므로, 로컬 사본이 더 최신이어도 이 값만큼은 서버 것이 진실이다.
 */
export const SERVER_OWNED_DECK_KEYS = [
  "visibility",
  "forkCount",
  "origin",
  "forkedFrom",
  "forkedFromAuthorName",
  "publishedAt",
  "takedownAt",
] as const satisfies ReadonlyArray<keyof Deck>;

/** 로컬 덱에 서버가 확정한 공유 필드를 입힌다 (내용은 로컬 그대로) */
export function withServerFields(local: Deck, server: Deck): Deck {
  const next: Deck = { ...local };
  for (const key of SERVER_OWNED_DECK_KEYS) {
    // 키마다 타입이 달라 제네릭 대입이 좁혀지지 않는다
    (next as Record<string, unknown>)[key] = server[key];
  }
  return next;
}

/**
 * 보관함 곡 병합.
 *
 * 가사·슬라이드·스타일 같은 내용은 곡 단위 Last-Write-Wins로 고른다
 * (`mergeDocuments`와 같은 이유로 필드 단위로 섞지 않는다). 공유 필드는
 * `updatedAt`과 무관하게 항상 서버 값이다.
 */
export function mergeLibraryDecks(
  local: Deck[],
  server: Deck[],
): LibraryMergeResult {
  const byId = new Map<string, Deck>();
  const needsPush: string[] = [];

  for (const deck of server) byId.set(deck.id, deck);

  for (const localDeck of local) {
    const serverDeck = byId.get(localDeck.id);

    if (!serverDeck) {
      // 아직 안 올라간 곡이다. 지우지 않고 올린다.
      byId.set(localDeck.id, localDeck);
      needsPush.push(localDeck.id);
      continue;
    }

    if (localDeck.updatedAt > serverDeck.updatedAt) {
      byId.set(localDeck.id, withServerFields(localDeck, serverDeck));
      needsPush.push(localDeck.id);
    }
    // 서버가 같거나 더 최신이면 서버 것을 쓴다 (이미 map에 들어 있다)
  }

  // 보관함 화면은 최근 수정순으로 보여 준다
  const decks = [...byId.values()].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );

  return { decks, needsPush };
}
