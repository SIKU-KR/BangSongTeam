import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
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
 *
 * 기다리는 동안 화면이 사라지면 읽으러 가지 않는다. 송출 화면은 서버 요청이 0건이어야 해서, 느린
 * push가 송출로 넘어간 뒤에야 끝나도 읽기 요청을 보내지 않는다.
 */
export function useShareSettings(
  id: string,
  options: { enabled: boolean; beforeFetch?: () => Promise<void> },
): UseQueryResult<ShareSettings> {
  return useQuery({
    queryKey: shareKeys.settings(id),
    queryFn: async ({ signal }) => {
      await options.beforeFetch?.();
      signal.throwIfAborted();
      return fetchShareSettings(id);
    },
    enabled: options.enabled,
  });
}

/**
 * 링크 공개 범위를 바꾼다. 오프라인이라고 멈춰 두지 않고 곧바로 보내(`networkMode: 'always'`)
 * 닿지 못하면 `OfflineError`로 바로 실패한다. 멈춰 두면 대화 상자를 닫은 뒤, 송출 중에라도
 * 연결이 돌아오는 순간 링크가 켜지거나 꺼진다.
 */
export function useUpdateShareSettings(
  id: string,
): UseMutationResult<ShareSettings, Error, LinkAccess> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (access: LinkAccess) => updateShareSettings(id, access),
    networkMode: "always",
    onSuccess: (settings: ShareSettings) => {
      queryClient.setQueryData(shareKeys.settings(id), settings);
    },
  });
}

/**
 * 링크를 새로 만들어 지금 링크로 들어온 사람을 모두 내보낸다. `useUpdateShareSettings`와 같은
 * 까닭으로 멈춰 두지 않는다(`networkMode: 'always'`). 멈춰 둔 재설정이 나중에 나가면 소유자가
 * 모르는 때에 멤버가 쫓겨난다.
 */
export function useResetShareLink(
  id: string,
): UseMutationResult<ShareSettings, Error, void> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => resetShareLink(id),
    networkMode: "always",
    onSuccess: (settings: ShareSettings) => {
      queryClient.setQueryData(shareKeys.settings(id), settings);
    },
  });
}
