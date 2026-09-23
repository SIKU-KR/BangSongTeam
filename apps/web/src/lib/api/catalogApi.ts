import {
  CreateReportResponseSchema,
  DeckMutationResponseSchema,
  ForkDeckResponseSchema,
  PublicDeckDetailSchema,
  SearchCatalogResponseSchema,
  type CreateReportRequest,
  type Deck,
  type ForkDeckResponse,
  type PublicDeckDetail,
  type SearchCatalogResponse,
  type VisibilityUpdateRequest,
} from "@repo/shared";
import { api } from "./client";
import { callApi } from "./request";

// ============================================================================
// 공유 라이브러리 API (M5, PRD 4.7)
//
// 응답은 공유 스키마로 다시 검증한다. 서버와 클라이언트 배포가 어긋난 순간
// 모양이 틀린 데이터가 스토어·IndexedDB로 흘러 들어가지 않게 한다.
// ============================================================================

/** 공개 덱 검색. 빈 검색어는 가져간 횟수순 둘러보기 */
export async function searchCatalog(
  q: string,
  limit = 20,
): Promise<SearchCatalogResponse> {
  const body = await callApi(() =>
    api.api.catalog.search.$get({ query: { q, limit: String(limit) } }),
  );
  return SearchCatalogResponseSchema.parse(body);
}

/** 공개 덱 전문 (로그인 필요) */
export async function fetchPublicDeck(id: string): Promise<PublicDeckDetail> {
  const body = await callApi<{ deck: unknown }>(() =>
    api.api.catalog.decks[":id"].$get({ param: { id } }),
  );
  return PublicDeckDetailSchema.parse(body.deck);
}

/** 공개 덱을 내 보관함으로 가져온다 (fork) */
export async function forkPublicDeck(id: string): Promise<ForkDeckResponse> {
  const body = await callApi(() =>
    api.api.decks[":id"].fork.$post({ param: { id } }),
  );
  return ForkDeckResponseSchema.parse(body);
}

/** 내 보관함 곡의 공개 여부를 바꾼다 */
export async function updateDeckVisibility(
  id: string,
  request: VisibilityUpdateRequest,
): Promise<Deck> {
  const body = await callApi(() =>
    api.api.decks[":id"].visibility.$patch({ param: { id }, json: request }),
  );
  return DeckMutationResponseSchema.parse(body).deck;
}

/** 신고·교정 제안 접수 */
export async function submitReport(
  request: CreateReportRequest,
): Promise<{ id: string }> {
  const body = await callApi(() => api.api.reports.$post({ json: request }));
  return CreateReportResponseSchema.parse(body);
}
