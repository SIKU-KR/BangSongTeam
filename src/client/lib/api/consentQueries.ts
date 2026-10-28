import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  API_ERRORS,
  type AgreeConsentRequest,
  type ConsentStatusResponse,
} from "#shared";
import { agreeConsent, fetchConsentStatus } from "./consentApi";
import { isRetryableApiError, ServerRejectedError } from "./request";

/** 동의 상태를 확인하지 못했을 때 처음 다시 확인하기까지의 간격. 실패가 이어지면 두 배씩 늘린다 */
export const CONSENT_RECHECK_BASE_MS = 2_000;

/** 다시 확인하는 간격의 상한. 긴 장애가 끝난 뒤에도 늘어난 간격만큼 기다리게 되지 않게 한다 */
export const CONSENT_RECHECK_MAX_MS = 60_000;

const consentKeys = {
  all: ["consent"] as const,
  status: (userId: string) => ["consent", userId] as const,
};

/**
 * 로그인한 사용자의 가입 동의 상태.
 *
 * 확인하지 못해도(오프라인, 서버 오류) 동의 창으로 막지 않는다. 그런데 막지 않기만 하면 갓 가입한
 * 사용자의 첫 확인이 일시 장애로 한 번 실패했을 때 동의 없이 계속 쓰게 된다. 이 질의는 값이 늘
 * 신선하다고 보고(`staleTime: Infinity`) 창을 다시 포커스해도 다시 받지 않아서, 실패하면 연결이
 * 끊겼다 돌아오거나 화면을 다시 열 때까지 아무도 다시 묻지 않는다. 그래서 일시 장애
 * (`isRetryableApiError`)로 실패한 동안만 간격을 늘리며 다시 확인한다. 오프라인에서는 요청을
 * 보내지 않고 멈췄다가 연결이 돌아오면 확인한다.
 *
 * 세션 만료나 거절처럼 다시 물어도 같은 답이면 다시 확인하지 않는다. 재시도(`retry`)가 아니라
 * 주기로 다시 묻는 것은, 이 질의를 함께 읽는 링크 참여(`ShareJoinRoute`)가 재시도 동안 참여를
 * 미루지 않고 첫 실패에서 서버 판단에 맡기기 때문이다.
 */
export function useConsentStatus(
  userId: string,
): UseQueryResult<ConsentStatusResponse> {
  return useQuery({
    queryKey: consentKeys.status(userId),
    queryFn: fetchConsentStatus,
    staleTime: Infinity,
    retry: false,
    refetchInterval: (query) =>
      isRetryableApiError(query.state.error)
        ? Math.min(
            CONSENT_RECHECK_MAX_MS,
            CONSENT_RECHECK_BASE_MS * 2 ** (query.state.errorUpdateCount - 1),
          )
        : false,
  });
}

export function useAgreeConsent(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AgreeConsentRequest) => agreeConsent(input),
    onSuccess: (status: ConsentStatusResponse) => {
      queryClient.setQueryData(consentKeys.status(userId), status);
    },
  });
}

/**
 * 서버가 가입 동의 전이라 거절했는지. 동의 모달은 동의 상태를 확인하지 못하면 막지 않으므로,
 * 서버가 링크 공유·링크 참여를 막으면 이 거절로 알게 된다.
 */
export function isConsentRequiredError(err: unknown): boolean {
  return (
    err instanceof ServerRejectedError &&
    err.status === 403 &&
    err.message === API_ERRORS.consentRequired
  );
}

/** 동의 상태를 다시 받는다. 동의 전이면 동의 모달이 뜬다 */
export function refreshConsentStatus(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: consentKeys.all });
}
