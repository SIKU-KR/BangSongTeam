import {
  keepPreviousData,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  BACKGROUND_SEARCH_MAX_LENGTH,
  type SearchBackgroundsResponse,
} from "#shared";
import { searchBackgrounds } from "./backgroundApi";

const backgroundKeys = {
  search: (q: string) => ["backgrounds", "search", q] as const,
};

/**
 * 배경 벡터 검색. 검색어마다 서버에서 임베딩하므로 사용자가 제출한 검색어만 받는다.
 * 다음 결과가 올 때까지 이전 결과를 유지해 갤러리가 깜박이지 않게 한다. 서버가 받는
 * 길이를 넘는 검색어는 잘라 보낸다. 그대로 보내면 400이 와서 검색 실패로 보인다.
 */
export function useBackgroundSearch(
  query: string,
): UseQueryResult<SearchBackgroundsResponse> {
  const q = query.trim().slice(0, BACKGROUND_SEARCH_MAX_LENGTH).trim();
  return useQuery({
    queryKey: backgroundKeys.search(q),
    queryFn: () => searchBackgrounds(q),
    enabled: q.length > 0,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
  });
}
