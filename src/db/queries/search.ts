import type { Query, QueryDocumentSnapshot } from "@google-cloud/firestore";
import type { PublicDeckSummary } from "#shared";
import type { Db } from "../client";
import { decksCol, type DeckDoc } from "../collections";
import { bigramsOf, normalizeSearchText } from "../deckIndex";
import { toPublicDeckSummary, withAuthorNames } from "./sharing";

export type SearchPlan =
  | { kind: "browse" }
  | { kind: "nothing" }
  | {
      kind: "search";
      /** 모두 들어 있어야 하는 낱말 (소문자) */
      tokens: string[];
      /** 후보를 고를 두 글자 묶음. 한 글자 낱말뿐이면 없다 */
      gram: string | null;
    };

/**
 * 검색어를 낱말로 나누고 후보를 고를 두 글자 묶음 하나를 정한다.
 *
 * 곡은 모든 낱말이 제목·아티스트·가사 중 한 곳에 부분 문자열로 들어 있을 때 맞는다.
 * Firestore는 배열 조건을 하나만 받으므로 가장 긴 낱말의 첫 두 글자로 후보를 좁히고
 * 나머지는 서버에서 확인한다. 글자 수는 코드 포인트 기준이다 (한글 1글자 = 1).
 */
export function planSearch(query: string): SearchPlan {
  if (!query.trim()) return { kind: "browse" };

  const tokens = normalizeSearchText(query).trim().split(" ").filter(Boolean);
  if (tokens.length === 0) return { kind: "nothing" };

  const longest = tokens.reduce((a, b) =>
    [...b].length > [...a].length ? b : a,
  );
  return {
    kind: "search",
    tokens,
    gram: bigramsOf(longest)[0] ?? null,
  };
}

function matchesAll(deck: DeckDoc, tokens: readonly string[]): boolean {
  const fields = [deck.title, deck.artist, deck.lyricsRaw].map((field) =>
    field.toLowerCase(),
  );
  return tokens.every((token) => fields.some((field) => field.includes(token)));
}

const PAGE_SIZE = 100;

/** 한 번의 검색이 확인하는 후보 수 상한. 흔한 낱말 하나로 공개 곡 전체를 읽지 않게 한다 */
export const MAX_SCANNED_DECKS = 1000;

/**
 * 공개 덱 검색 — 제목·아티스트·가사 본문.
 *
 * 공개 범위는 `listed`가 정한다(`withDeckIndex`). 결과는 가져간 횟수순, 동률이면 최근
 * 수정순이다. 검색어가 없으면 그 순서대로 `limit`개만 읽는다. 검색어가 있으면 두 글자
 * 묶음 색인으로 고른 후보를 같은 순서로 페이지씩 읽으며 `limit`개를 채운다.
 */
export async function searchPublicDecks(
  db: Db,
  query: string,
  limit = 20,
): Promise<PublicDeckSummary[]> {
  const plan = planSearch(query);
  if (plan.kind === "nothing") return [];

  let base: Query<DeckDoc> = decksCol(db).where("listed", "==", true);
  if (plan.kind === "search" && plan.gram) {
    base = base.where("searchGrams", "array-contains", plan.gram);
  }
  const ordered = base
    .orderBy("forkCount", "desc")
    .orderBy("updatedAt", "desc");

  const matches: DeckDoc[] = [];
  if (plan.kind === "browse") {
    const snapshot = await ordered.limit(limit).get();
    matches.push(...snapshot.docs.map((doc) => doc.data()));
  } else {
    let cursor: QueryDocumentSnapshot<DeckDoc> | undefined;
    let scanned = 0;
    while (matches.length < limit && scanned < MAX_SCANNED_DECKS) {
      const page = await (cursor ? ordered.startAfter(cursor) : ordered)
        .limit(PAGE_SIZE)
        .get();
      scanned += page.size;
      for (const doc of page.docs) {
        const deck = doc.data();
        if (matchesAll(deck, plan.tokens)) matches.push(deck);
      }
      if (page.size < PAGE_SIZE) break;
      cursor = page.docs[page.docs.length - 1];
    }
  }

  const named = await withAuthorNames(db, matches.slice(0, limit));
  return named.map(toPublicDeckSummary);
}
