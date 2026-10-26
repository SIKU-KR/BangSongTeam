import type { Query, QueryDocumentSnapshot } from "@google-cloud/firestore";
import { getChoseong } from "es-hangul";
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
      /** 모두 들어 있어야 하는 낱말 (소문자). 초성만으로 된 낱말도 섞여 있다 */
      tokens: string[];
      /**
       * 후보를 고를 두 글자 묶음 후보. 맞는 곡은 이 묶음을 모두 `searchGrams`에 가지므로 어느
       * 것으로 골라도 결과는 같다. 첫째가 가장 긴 낱말의 첫 두 글자다. 한 글자·초성 낱말뿐이면 없다
       */
      grams: string[];
    };

const CHOSEONG_TOKEN = /^[\u3131-\u314E]+$/u;

const TRAILING_JAMO = /[\u3131-\u318E]+$/u;

const MAX_PROBED_GRAMS = 6;

function toToken(word: string): string {
  return CHOSEONG_TOKEN.test(word) ? word : word.replace(TRAILING_JAMO, "");
}

function candidateGrams(tokens: readonly string[]): string[] {
  const perToken = tokens
    .filter((token) => !CHOSEONG_TOKEN.test(token))
    .map((token) => bigramsOf(token))
    .sort((a, b) => b.length - a.length);
  const grams = new Set<string>();
  for (let index = 0; index < (perToken[0]?.length ?? 0); index++) {
    for (const tokenGrams of perToken) {
      const gram = tokenGrams[index];
      if (gram !== undefined) grams.add(gram);
      if (grams.size === MAX_PROBED_GRAMS) return [...grams];
    }
  }
  return [...grams];
}

/**
 * 검색어를 낱말로 나누고 후보를 고를 두 글자 묶음 후보를 정한다.
 *
 * 곡은 모든 낱말이 제목·아티스트·가사 중 한 곳에 부분 문자열로 들어 있을 때 맞는다. 초성만으로
 * 된 낱말(`ㅈㄴ`)은 제목·아티스트의 초성에 들어 있어도 맞아, 곡 선택 창의 내 곡 목록처럼 초성으로
 * 찾을 수 있다. 가사의 초성까지 보면 거의 모든 곡이 맞아 버려 제목·아티스트만 본다.
 *
 * 낱말 끝의 한글 자모는 뗀다. 한글 입력기는 조합 중인 글자를 `주님ㅇ`처럼 보내는데, 그대로 두면
 * 입력하는 동안 결과가 비고 맞을 수 없는 낱말로 후보를 끝까지 훑는다.
 *
 * Firestore는 배열 조건을 하나만 받으므로 두 글자 묶음 하나로 후보를 좁히고 나머지는 서버에서
 * 확인한다. 묶음 후보는 긴 낱말부터 낱말마다 번갈아 6개까지 고른다. 한 낱말의 묶음끼리는
 * 흔하고 드문 정도가 비슷해, 여러 낱말에서 고르는 편이 드문 묶음을 찾기 쉽다. 글자 수는 코드
 * 포인트 기준이다 (한글 1글자 = 1).
 */
export function planSearch(query: string): SearchPlan {
  if (!query.trim()) return { kind: "browse" };

  const tokens = normalizeSearchText(query)
    .split(" ")
    .map(toToken)
    .filter(Boolean);
  if (tokens.length === 0) return { kind: "nothing" };

  return { kind: "search", tokens, grams: candidateGrams(tokens) };
}

function choseongOf(text: string): string {
  return getChoseong(text).replace(/\s+/g, "");
}

function matchesAll(deck: DeckDoc, tokens: readonly string[]): boolean {
  const fields = [deck.title, deck.artist, deck.lyricsRaw].map((field) =>
    field.toLowerCase(),
  );
  let initials: string[] | undefined;
  return tokens.every((token) => {
    if (fields.some((field) => field.includes(token))) return true;
    if (!CHOSEONG_TOKEN.test(token)) return false;
    initials ??= [deck.title, deck.artist].map(choseongOf);
    return initials.some((field) => field.includes(token));
  });
}

const PAGE_SIZE = 100;

/**
 * 두 글자 묶음으로 고른 후보 중 한 번의 검색이 확인하는 수 상한. 검색은 로그인 없이 부를 수
 * 있어, 요청 하나가 읽는 곡 문서 수를 이만큼으로 묶는다
 */
export const MAX_SCANNED_DECKS = 300;

const MAX_UNINDEXED_SCAN = PAGE_SIZE;

function byPopularity(query: Query<DeckDoc>): Query<DeckDoc> {
  return query.orderBy("forkCount", "desc").orderBy("updatedAt", "desc");
}

function containingGram(listed: Query<DeckDoc>, gram: string): Query<DeckDoc> {
  return byPopularity(listed.where("searchGrams", "array-contains", gram));
}

interface GramCount {
  gram: string;
  count: number;
}

interface Candidates {
  query: Query<DeckDoc>;
  budget: number;
}

async function countCandidates(
  listed: Query<DeckDoc>,
  gram: string,
): Promise<GramCount> {
  const snapshot = await containingGram(listed, gram).count().get();
  return { gram, count: snapshot.data().count };
}

async function chooseCandidates(
  listed: Query<DeckDoc>,
  grams: readonly string[],
  onCountError: ((error: unknown) => void) | undefined,
): Promise<Candidates | null> {
  const [first, ...rest] = grams;
  if (first === undefined) {
    return { query: byPopularity(listed), budget: MAX_UNINDEXED_SCAN };
  }
  const byFirstGram = {
    query: containingGram(listed, first),
    budget: MAX_SCANNED_DECKS,
  };
  if (rest.length === 0) return byFirstGram;

  const results = await Promise.allSettled(
    grams.map((gram) => countCandidates(listed, gram)),
  );
  const failed = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failed) onCountError?.(failed.reason);

  const rarest = results.reduce<GramCount | null>(
    (best, result) =>
      result.status === "fulfilled" &&
      (best === null || result.value.count < best.count)
        ? result.value
        : best,
    null,
  );
  if (rarest === null) return byFirstGram;
  if (rarest.count === 0) return null;
  return {
    query: containingGram(listed, rarest.gram),
    budget: Math.min(MAX_SCANNED_DECKS, rarest.count),
  };
}

async function scanMatches(
  candidates: Query<DeckDoc>,
  tokens: readonly string[],
  limit: number,
  budget: number,
): Promise<DeckDoc[]> {
  const matches: DeckDoc[] = [];
  let cursor: QueryDocumentSnapshot<DeckDoc> | undefined;
  let scanned = 0;
  while (matches.length < limit && scanned < budget) {
    const pageSize = Math.min(PAGE_SIZE, budget - scanned);
    const page = await (cursor ? candidates.startAfter(cursor) : candidates)
      .limit(pageSize)
      .get();
    scanned += page.size;
    for (const doc of page.docs) {
      const deck = doc.data();
      if (matchesAll(deck, tokens)) matches.push(deck);
    }
    if (page.size < pageSize) break;
    cursor = page.docs[page.docs.length - 1];
  }
  return matches;
}

export interface SearchOptions {
  /** 후보 수를 세다 실패하면 부른다. 검색은 첫 묶음으로 이어 간다 */
  onCountError?: (error: unknown) => void;
}

/**
 * 공개 덱 검색 — 제목·아티스트·가사 본문.
 *
 * 공개 범위는 `listed`가 정한다(`withDeckIndex`). 결과는 가져간 횟수순, 동률이면 최근
 * 수정순이다. 검색어가 없으면 그 순서대로 `limit`개만 읽는다.
 *
 * 검색어가 있으면 두 글자 묶음 후보마다 그 묶음을 가진 공개 곡 수를 세고, 가장 적은 묶음으로
 * 고른 후보를 같은 순서로 페이지씩 읽으며 `limit`개를 채운다. 첫 묶음으로만 고르면 `주님`처럼
 * 흔한 묶음에서 상한에 걸려, 가져간 적 없는 오래된 곡(시드 곡)부터 결과에서 빠진다. 세기는
 * 곡 1000개당 읽기 1회라 훑기보다 훨씬 싸다. 0곡인 묶음이 있으면 맞는 곡도 없으므로 곡 문서를
 * 읽지 않는다. 세는 쿼리는 훑는 쿼리와 같아 같은 복합 색인을 쓰고, 세다 실패하면 첫 묶음으로
 * 이어 가 검색 자체는 실패하지 않는다.
 *
 * 로그인 없이 부를 수 있어 요청 하나가 읽는 곡 문서 수를 묶는다. 묶음으로 고른 후보는
 * `MAX_SCANNED_DECKS`곡까지, 묶음이 없는 검색(한 글자·초성 낱말뿐)은 색인으로 좁히지 못해
 * 인기순 한 페이지까지만 확인한다.
 */
export async function searchPublicDecks(
  db: Db,
  query: string,
  limit = 20,
  options: SearchOptions = {},
): Promise<PublicDeckSummary[]> {
  const plan = planSearch(query);
  if (plan.kind === "nothing") return [];

  const listed = decksCol(db).where("listed", "==", true);
  let matches: DeckDoc[];
  if (plan.kind === "browse") {
    const snapshot = await byPopularity(listed).limit(limit).get();
    matches = snapshot.docs.map((doc) => doc.data());
  } else {
    const candidates = await chooseCandidates(
      listed,
      plan.grams,
      options.onCountError,
    );
    if (!candidates) return [];
    matches = await scanMatches(
      candidates.query,
      plan.tokens,
      limit,
      candidates.budget,
    );
  }

  const named = await withAuthorNames(db, matches.slice(0, limit));
  return named.map(toPublicDeckSummary);
}
