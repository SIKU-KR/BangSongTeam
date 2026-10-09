import {
  BACKGROUND_EMBEDDING_MODEL,
  backgroundEmbeddingQuery,
  type BackgroundSearchResult,
} from "#shared";
import type { Bindings } from "../types";

const TOP_K = 50;
const MIN_SCORE = 0.28;
const MAX_GAP_FROM_TOP = 0.1;

export type BackgroundSearcher = (
  env: Bindings,
  query: string,
) => Promise<BackgroundSearchResult[]>;

/**
 * 검색어를 임베딩해 배경 Vectorize 인덱스에서 가까운 배경을 찾는다.
 *
 * 벡터 검색은 무엇을 넣어도 가장 가까운 배경을 돌려주므로 두 기준으로 거른다.
 * - `MIN_SCORE` 미만은 버린다. 운영 배경 149개로 재 보니 관련 없는 검색어("고양이",
 *   "pizza", 초성 "ㅂㄹ")는 최고점이 0.20을 넘지 않았고, 관련 검색어의 1등은 0.31 이상이었다.
 * - 1등보다 `MAX_GAP_FROM_TOP` 넘게 낮은 배경도 버린다. "빛이 퍼지는 추상 배경"처럼 넓은
 *   검색어는 0.3을 넘는 배경이 140개가 넘어, 고정 기준만으로는 사실상 전부가 나온다.
 *
 * 인덱스에만 남은 지운 배경의 id는 클라이언트가 카탈로그와 맞춰 보며 버린다.
 */
export const searchBackgroundsWithVectorize: BackgroundSearcher = async (
  env,
  query,
) => {
  const { data } = await env.AI.run(BACKGROUND_EMBEDDING_MODEL, {
    text: backgroundEmbeddingQuery(query),
  });
  const vector = data[0];
  if (!vector) throw new Error("Query embedding is empty");
  const { matches } = await env.BACKGROUND_INDEX.query(vector, {
    topK: TOP_K,
  });
  const cutoff = Math.max(
    MIN_SCORE,
    (matches[0]?.score ?? 0) - MAX_GAP_FROM_TOP,
  );
  return matches
    .filter((match) => match.score >= cutoff)
    .map(({ id, score }) => ({ id, score }));
};
