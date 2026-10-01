import { deckMatchesQuery, type Deck, type PublicDeckSummary } from "#shared";
import { EDITOR_COPY } from "#copy/editor";

export type PickerFilter = "all" | "mine" | "shared";

/**
 * 곡 선택 창 목록의 한 줄. `key`는 `mine:`·`shared:` 접두어로 내 곡과 공유 곡의 같은
 * id가 겹치지 않게 한다. 공유 곡은 이미 사본을 가져왔으면 `ownedCopy`에 그 곡을 담아
 * 다시 가져오지 않고 바로 쓴다.
 */
export type PickerEntry =
  | { kind: "mine"; key: string; deck: Deck }
  | {
      kind: "shared";
      key: string;
      summary: PublicDeckSummary;
      ownedCopy?: Deck;
    };

/**
 * 내 보관함 곡과 공유 라이브러리 검색 결과를 한 목록으로 합친다. 내 곡이 먼저 오고,
 * 내가 공개한 곡은 공유 결과에서 빼서 두 번 보이지 않게 한다. 공유 결과는 서버가 이미
 * 검색어로 거른 것이라 내 곡만 검색어로 거른다.
 */
export function buildPickerEntries({
  mySongs,
  sharedDecks,
  query,
  filter,
}: {
  mySongs: Deck[];
  sharedDecks: PublicDeckSummary[];
  query: string;
  filter: PickerFilter;
}): PickerEntry[] {
  const q = query.trim();
  const mine: PickerEntry[] = mySongs
    .filter((deck) => !q || deckMatchesQuery(deck, q))
    .map((deck) => ({ kind: "mine", key: `mine:${deck.id}`, deck }));

  const myIds = new Set(mySongs.map((deck) => deck.id));
  const shared: PickerEntry[] = sharedDecks
    .filter((summary) => !myIds.has(summary.id))
    .map((summary) => ({
      kind: "shared",
      key: `shared:${summary.id}`,
      summary,
      ownedCopy: mySongs.find(
        (deck) => deck.origin === "fork" && deck.forkedFrom === summary.id,
      ),
    }));

  if (filter === "mine") return mine;
  if (filter === "shared") return shared;
  return [...mine, ...shared];
}

/**
 * 목록이 비었을 때의 안내. 검색 중이면 결과를 기다리라고, 검색어가 있으면 일치하는 곡이
 * 없다고 먼저 알린다.
 */
export function getPickerEmptyMessage({
  isFetching,
  query,
  filter,
}: {
  isFetching: boolean;
  query: string;
  filter: PickerFilter;
}): string {
  if (isFetching) return EDITOR_COPY.picker.searching;
  if (query.trim()) return EDITOR_COPY.picker.noMatch;
  if (filter === "shared") return EDITOR_COPY.picker.noShared;
  if (filter === "mine") return EDITOR_COPY.picker.noMine;
  return EDITOR_COPY.picker.noSongs;
}
