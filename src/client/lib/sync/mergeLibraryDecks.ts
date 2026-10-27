import { isFarFuture, type Deck } from "#shared";
import type { MergeMode } from "./mergeDocuments";

interface LibraryMergeResult {
  decks: Deck[];
  needsPush: string[];
  removedIds: string[];
}

interface LibraryMergeOptions {
  deletedIds?: Iterable<string>;
  mode?: MergeMode;
  knownBeforePull?: ReadonlySet<string>;
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

const NON_CONTENT_DECK_KEYS: ReadonlySet<string> = new Set([
  ...SERVER_OWNED_DECK_KEYS,
  "createdAt",
  "updatedAt",
]);

/**
 * 곡 내용이 모두 같은지. 서버가 정하는 공유 필드와 시각을 뺀 모든 필드를 견주고, 값이 없는 필드는
 * null로 본다.
 *
 * 서버는 기기가 보낸 시각을 줄이고 만든 시각은 처음 값을 지켜, 받은 내용 그대로인 곡을 다른 시각으로
 * 돌려준다. 빼지 않은 필드는 모두 견주므로, 나중에 곡에 고칠 수 있는 필드가 생겨도 그 수정을 같은
 * 내용으로 보고 덮지 않는다. 슬라이드·서식은 스키마로 읽은 값이라 JSON으로 견준다.
 */
export function hasSameDeckContent(a: Deck, b: Deck): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every(
    (key) =>
      NON_CONTENT_DECK_KEYS.has(key) ||
      JSON.stringify(a[key as keyof Deck] ?? null) ===
        JSON.stringify(b[key as keyof Deck] ?? null),
  );
}

/**
 * 보관함 곡 병합.
 *
 * 가사·슬라이드·스타일 같은 내용은 곡 단위 Last-Write-Wins로 고른다
 * (`mergeDocuments`와 같은 이유로 필드 단위로 섞지 않는다). 공유 필드는
 * `updatedAt`과 무관하게 항상 서버 값이다.
 *
 * 로컬 시각이 기기 시계보다 한참 앞서면(`isFarFuture`) 로컬 사본이 더 늦어도 서버 사본을 고른다.
 * 빠른 시계가 남긴 값이라, 이기게 두면 부팅마다 다시 올라가고 서버가 줄인 시각이 그동안 다른 기기의
 * 수정을 옛 수정으로 막는다.
 *
 * 지운 곡(`deletedIds`: 서버의 삭제 기록과 이 페이지에서 지운 곡)은 양쪽에서 뺀다. 지우기가
 * 로컬에만 있는 사본이나 더 새로운 로컬 사본보다 우선한다. 오래된 기기·탭이 다시 올린 서버
 * 사본은 받지 않고, 로컬 사본은 올리지 않고 로컬에서 지우도록 `removedIds`로 돌려준다.
 *
 * 받기 전부터 알던 곡(`knownBeforePull`)이 그사이 보관함에서 사라졌으면 서버 목록에 있어도 넣지
 * 않는다. 받는 동안 지웠거나 다른 탭이 지운 곡이라, 목록이 그 삭제보다 먼저 받은 것일 수 있다.
 *
 * 다시 받기(`refresh`)는 받기만 한다. 이기는 로컬 곡과 로컬에만 있는 곡도 그대로 두고 올릴
 * 목록(`needsPush`)은 비운다. 그 곡은 큐와 다음 부팅이 올린다.
 */
export function mergeLibraryDecks(
  local: Deck[],
  server: Deck[],
  options: LibraryMergeOptions = {},
): LibraryMergeResult {
  const deleted = new Set(options.deletedIds ?? []);
  const known = options.knownBeforePull ?? new Set<string>();
  const localIds = new Set(local.map((deck) => deck.id));
  const refresh = options.mode === "refresh";
  const byId = new Map<string, Deck>();
  const needsPush: string[] = [];
  const removedIds: string[] = [];

  for (const deck of server) {
    if (deleted.has(deck.id)) continue;
    if (known.has(deck.id) && !localIds.has(deck.id)) continue;
    byId.set(deck.id, deck);
  }

  for (const localDeck of local) {
    if (deleted.has(localDeck.id)) {
      removedIds.push(localDeck.id);
      continue;
    }

    const serverDeck = byId.get(localDeck.id);

    if (!serverDeck) {
      byId.set(localDeck.id, localDeck);
      if (!refresh) needsPush.push(localDeck.id);
      continue;
    }

    if (
      localDeck.updatedAt > serverDeck.updatedAt &&
      !isFarFuture(localDeck.updatedAt)
    ) {
      byId.set(localDeck.id, withServerFields(localDeck, serverDeck));
      if (!refresh) needsPush.push(localDeck.id);
    }
  }

  const decks = [...byId.values()].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );

  return { decks, needsPush, removedIds };
}
