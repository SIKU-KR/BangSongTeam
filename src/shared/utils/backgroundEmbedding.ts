/**
 * 배경 벡터 검색 설정. Worker(검색어 임베딩)와 관리 스크립트(배경 임베딩)가 같은 모델·문서
 * 형식을 써야 점수가 맞으므로 한 곳에 둔다. 스크립트가 Node 타입 제거로 바로 불러오므로
 * 다른 모듈을 import하지 않는다.
 *
 * EmbeddingGemma는 운영 배경 149개로 비교한 다국어 모델 중 순위가 가장 정확했고, 영어
 * 검색어("purple", "cross")도 찾았다. 관련 없는 검색어와 점수가 크게 벌어져 기준선으로
 * 걸러 내기도 쉽다.
 */
export const BACKGROUND_EMBEDDING_MODEL = "@cf/google/embeddinggemma-300m";

/** 모델 한 번 호출에 넣을 문서 수 (모델 한도는 100개) */
export const BACKGROUND_EMBEDDING_BATCH_SIZE = 50;

/**
 * 대상별 Vectorize 인덱스(768차원, cosine). Vectorize는 로컬 시뮬레이션이 없어 로컬 D1의
 * 배경은 운영과 다른 원격 인덱스에 둔다. `vite.config.ts`가 dev 서버에서 바인딩을 `local`로
 * 바꾼다. 인덱스 차원은 만든 뒤 바꿀 수 없어서 모델을 바꾸면 이름도 새로 짓는다.
 */
export const BACKGROUND_INDEX_NAMES = {
  remote: "bangsongteam-backgrounds-gemma",
  local: "bangsongteam-backgrounds-gemma-local",
} as const;

interface BackgroundEmbeddingSource {
  title: string;
  description?: string;
  searchText?: string;
  keywords: readonly string[];
}

/** EmbeddingGemma가 검색어에 요구하는 접두어를 붙인다 */
export function backgroundEmbeddingQuery(query: string): string {
  return `task: search result | query: ${query}`;
}

/**
 * 배경 하나를 임베딩할 문서. EmbeddingGemma의 문서 형식(`title: … | text: …`)을 따른다.
 * 긴 설명이 아직 없으면 짧은 설명으로 대신한다.
 */
export function backgroundEmbeddingDocument(
  item: BackgroundEmbeddingSource,
): string {
  const text = [
    item.searchText || item.description || "",
    item.keywords.join(", "),
  ]
    .filter(Boolean)
    .join(" ");
  return `title: ${item.title} | text: ${text}`;
}
