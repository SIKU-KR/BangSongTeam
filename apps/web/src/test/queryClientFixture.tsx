import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/** 테스트용 QueryClient */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

/** 서버 캐시 훅을 쓰는 화면을 감싼다 */
export function withQueryClient(
  ui: React.ReactElement,
  client: QueryClient = createTestQueryClient(),
): React.ReactElement {
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}
