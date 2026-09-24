import { QueryClient } from "@tanstack/react-query";

/**
 * 서버 캐시(공유 라이브러리 검색·상세) 전용 QueryClient.
 *
 * - `networkMode: 'online'` — 오프라인이면 요청을 보내지 않고 멈춘다. 예배당에서
 *   네트워크가 끊겨도 헛된 재시도 루프가 돌지 않는다
 * - 포커스 복귀 재조회 끔 — 편집 중 창을 오가며 검색 결과가 흔들리지 않게
 * - 재시도 1회 — 검색은 사용자가 다시 칠 수 있다
 *
 * 프레젠테이션·보관함 곡은 여기서 다루지 않는다. 그 원천은 IndexedDB이고
 * 동기화 계층(`lib/sync`)이 서버와 맞춘다.
 */
export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: "online",
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 30_000,
      },
      mutations: {
        networkMode: "online",
        retry: 0,
      },
    },
  });
}
