import type { Deck } from "#shared";

interface LibraryMergeResult {
  decks: Deck[];
  needsPush: string[];
  removedIds: string[];
}

interface LibraryMergeOptions {
  deletedIds?: Iterable<string>;
}

/**
 * 동기화 PUT은 이 값을 바꾸지 못한다. 공개 전환·가져오기·게시 중단은 서버에서만
 * 일어나므로, 로컬 사본이 더 최신이어도 이 값만큼은 서버 것이 진실이다.
 */
const SERVER_OWNED_DECK_KEYS = [
  "visibility",
  "forkCount",
  "origin",
  "forkedFrom",
  "forkedFromAuthorName",
  "publishedAt",
  "takedownAt",
] as const satisfies ReadonlyArray<keyof Deck>;

/** 서버가 확정한 공유 필드를 입히되 내용은 로컬 그대로 둔다 */
export function withServerFields(local: Deck, server: Deck): Deck {
  const next: Deck = { ...local };
  for (const key of SERVER_OWNED_DECK_KEYS) {
    (next as Record<string, unknown>)[key] = server[key];
  }
  return next;
}

/**
 * 서버가 정하는 공유 필드가 모두 같은지 (값이 없는 필드는 null로 본다).
 *
 * 이 필드는 서버에서 `updatedAt`을 바꾸지 않고 바뀐다(공개 전환·가져가기·게시 중단). 그래서
 * 부팅 병합은 `updatedAt`이 같아도 이 필드가 다르면 저장본을 새로 써야 한다.
 */
export function hasSameServerFields(a: Deck, b: Deck): boolean {
  return SERVER_OWNED_DECK_KEYS.every(
    (key) => (a[key] ?? null) === (b[key] ?? null),
  );
}

/**
 * 보관함 곡 병합.
 *
 * 가사·슬라이드·스타일 같은 내용은 곡 단위 Last-Write-Wins로 고른다
 * (`mergeDocuments`와 같은 이유로 필드 단위로 섞지 않는다). 공유 필드는
 * `updatedAt`과 무관하게 항상 서버 값이다.
 *
 * 지운 곡(`deletedIds`: 서버의 삭제 기록과 이 페이지에서 지운 곡)은 양쪽에서 뺀다. 지우기가
 * 로컬에만 있는 사본이나 더 새로운 로컬 사본보다 우선한다. 오래된 기기·탭이 다시 올린 서버
 * 사본은 받지 않고, 로컬 사본은 올리지 않고 로컬에서 지우도록 `removedIds`로 돌려준다.
 */
export function mergeLibraryDecks(
  local: Deck[],
  server: Deck[],
  options: LibraryMergeOptions = {},
): LibraryMergeResult {
  const deleted = new Set(options.deletedIds ?? []);
  const byId = new Map<string, Deck>();
  const needsPush: string[] = [];
  const removedIds: string[] = [];

  for (const deck of server) {
    if (!deleted.has(deck.id)) byId.set(deck.id, deck);
  }

  for (const localDeck of local) {
    if (deleted.has(localDeck.id)) {
      removedIds.push(localDeck.id);
      continue;
    }

    const serverDeck = byId.get(localDeck.id);

    if (!serverDeck) {
      byId.set(localDeck.id, localDeck);
      needsPush.push(localDeck.id);
      continue;
    }

    if (localDeck.updatedAt > serverDeck.updatedAt) {
      byId.set(localDeck.id, withServerFields(localDeck, serverDeck));
      needsPush.push(localDeck.id);
    }
  }

  const decks = [...byId.values()].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );

  return { decks, needsPush, removedIds };
}
