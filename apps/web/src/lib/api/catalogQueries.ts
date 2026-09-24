import { useEffect, useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  CreateReportRequest,
  Deck,
  VisibilityUpdateRequest,
} from "@repo/shared";
import {
  fetchPublicDeck,
  forkPublicDeck,
  searchCatalog,
  submitReport,
  updateDeckVisibility,
} from "./catalogApi";
import {
  applyServerDeckFields,
  upsertLibraryDeck,
} from "../../features/editor/songLibraryStore";

export const CATALOG_SEARCH_DEBOUNCE_MS = 250;

export const catalogKeys = {
  all: ["catalog"] as const,
  search: (q: string) => ["catalog", "search", q] as const,
  deck: (id: string) => ["catalog", "deck", id] as const,
};

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** 타이핑 중에는 이전 결과를 유지해 목록이 깜박이지 않게 한다 */
export function useCatalogSearch(query: string, options: { enabled: boolean }) {
  const q = useDebouncedValue(query.trim(), CATALOG_SEARCH_DEBOUNCE_MS);
  return useQuery({
    queryKey: catalogKeys.search(q),
    queryFn: () => searchCatalog(q),
    enabled: options.enabled,
    placeholderData: keepPreviousData,
  });
}

/** 공개 덱 전문 (곡 추가 모달의 가사 전문 미리보기) */
export function usePublicDeck(id: string | null) {
  return useQuery({
    queryKey: catalogKeys.deck(id ?? ""),
    queryFn: () => fetchPublicDeck(id as string),
    enabled: !!id,
  });
}

/**
 * 공개 덱 가져오기. 성공하면 받은 포크를 내 보관함에 넣는다.
 * 서버에 이미 있는 덱이므로 다시 올리지 않는다 (`push: false`).
 */
export function useForkDeck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: forkPublicDeck,
    onSuccess: ({ deck }) => {
      upsertLibraryDeck(deck, { push: false });
      void queryClient.invalidateQueries({ queryKey: catalogKeys.all });
    },
  });
}

/** 서버가 확정한 공유 필드를 보관함에 반영한다 */
export function useSetDeckVisibility() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      deckId,
      request,
    }: {
      deckId: string;
      request: VisibilityUpdateRequest;
    }): Promise<Deck> => updateDeckVisibility(deckId, request),
    onSuccess: (deck) => {
      applyServerDeckFields(deck);
      void queryClient.invalidateQueries({ queryKey: catalogKeys.all });
    },
  });
}

export function useSubmitReport() {
  return useMutation({
    mutationFn: (request: CreateReportRequest) => submitReport(request),
  });
}
