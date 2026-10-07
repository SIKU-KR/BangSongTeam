/**
 * 배경 벡터 검색 설정. Worker(검색어 임베딩)와 관리 스크립트(배경 임베딩)가 같은 모델·문서
 * 형식을 써야 점수가 맞으므로 한 곳에 둔다. 스크립트가 Node 타입 제거로 바로 불러오므로
 * 다른 모듈을 import하지 않는다.
 */
export const BACKGROUND_EMBEDDING_MODEL = "@cf/qwen/qwen3-embedding-0.6b";

/** 모델 한 번 호출에 넣을 수 있는 문서 수 */
export const BACKGROUND_EMBEDDING_BATCH_SIZE = 32;

/** Qwen3 임베딩은 검색어에만 지시문을 붙이고, 지시문은 영어일 때 가장 잘 맞는다 */
export const BACKGROUND_QUERY_INSTRUCTION =
  "Given a search query for a church worship slide background, retrieve descriptions of background videos and images that match it";

/**
 * 대상별 Vectorize 인덱스. Vectorize는 로컬 시뮬레이션이 없어 로컬 D1의 배경은 운영과
 * 다른 원격 인덱스에 둔다. `vite.config.ts`가 dev 서버에서 바인딩을 `local`로 바꾼다.
 */
export const BACKGROUND_INDEX_NAMES = {
  remote: "bangsongteam-backgrounds",
  local: "bangsongteam-backgrounds-local",
} as const;

interface BackgroundEmbeddingSource {
  title: string;
  description?: string;
  searchText?: string;
  keywords: readonly string[];
}

/** 배경 하나를 임베딩할 문서. 긴 설명이 아직 없으면 짧은 설명으로 대신한다 */
export function backgroundEmbeddingDocument(
  item: BackgroundEmbeddingSource,
): string {
  return [
    item.title,
    item.searchText || item.description || "",
    item.keywords.join(", "),
  ]
    .filter(Boolean)
    .join("\n");
}
