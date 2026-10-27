import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { LinkAccess, ShareSettings } from "#shared";
import {
  fetchSharePreview,
  fetchShareSettings,
  resetShareLink,
  updateShareSettings,
} from "./shareApi";

const shareKeys = {
  settings: (id: string) => ["presentation-share", id] as const,
  preview: (token: string) => ["share-preview", token] as const,
};

export function useSharePreview(token: string) {
  return useQuery({
    queryKey: shareKeys.preview(token),
    queryFn: () => fetchSharePreview(token),
    retry: false,
  });
}

/**
 * 세트의 링크 공유 설정. 서버가 아직 모르는 세트의 설정은 읽을 수 없어(404), 호출한 화면이 넘긴
 * `beforeFetch`(올리던 변경 보내기)를 읽기 전에 기다린다. 다시 시도할 때마다 다시 돈다. 이 모듈이
 * `lib/sync`를 직접 가져오면 api와 sync가 서로를 가져오는 순환이 생겨 화면이 넘기게 했다.
 */
export function useShareSettings(
  id: string,
  options: { enabled: boolean; beforeFetch?: () => Promise<void> },
): UseQueryResult<ShareSettings> {
  return useQuery({
    queryKey: shareKeys.settings(id),
    queryFn: async () => {
      await options.beforeFetch?.();
      return fetchShareSettings(id);
    },
    enabled: options.enabled,
  });
}

export function useUpdateShareSettings(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (access: LinkAccess) => updateShareSettings(id, access),
    onSuccess: (settings: ShareSettings) => {
      queryClient.setQueryData(shareKeys.settings(id), settings);
    },
  });
}

export function useResetShareLink(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => resetShareLink(id),
    onSuccess: (settings: ShareSettings) => {
      queryClient.setQueryData(shareKeys.settings(id), settings);
    },
  });
}
