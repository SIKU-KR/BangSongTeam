import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * 테스트용 QueryClient. 재시도를 끄고 캐시를 테스트마다 새로 만든다.
 * 앱 설정(`createAppQueryClient`)의 `networkMode: 'online'`은 jsdom의
 * `navigator.onLine`을 따르므로 그대로 둔다.
 */
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
