import {
  BACKGROUND_EMBEDDING_MODEL,
  BACKGROUND_QUERY_INSTRUCTION,
  type BackgroundSearchResult,
} from "#shared";
import type { Bindings } from "../types";

const TOP_K = 50;
const MIN_SCORE = 0.5;

export type BackgroundSearcher = (
  env: Bindings,
  query: string,
) => Promise<BackgroundSearchResult[]>;

/**
 * 검색어를 임베딩해 배경 Vectorize 인덱스에서 가까운 배경을 찾는다.
 *
 * 벡터 검색은 무엇을 넣어도 가장 가까운 배경을 돌려주므로, 관련 없는 결과를 빼려고
 * `MIN_SCORE` 미만은 버린다. 기준은 대표 검색어로 잰 점수 분포에서 정했다. 인덱스에만
 * 남은 지운 배경의 id는 클라이언트가 카탈로그와 맞춰 보며 버린다.
 */
export const searchBackgroundsWithVectorize: BackgroundSearcher = async (
  env,
  query,
) => {
  const { data } = await env.AI.run(BACKGROUND_EMBEDDING_MODEL, {
    queries: query,
    instruction: BACKGROUND_QUERY_INSTRUCTION,
  });
  const vector = data?.[0];
  if (!vector) throw new Error("Query embedding is empty");
  const { matches } = await env.BACKGROUND_INDEX.query(vector, {
    topK: TOP_K,
  });
  return matches
    .filter((match) => match.score >= MIN_SCORE)
    .map(({ id, score }) => ({ id, score }));
};
