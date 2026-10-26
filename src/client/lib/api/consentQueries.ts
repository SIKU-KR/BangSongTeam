import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  API_ERRORS,
  type AgreeConsentRequest,
  type ConsentStatusResponse,
} from "#shared";
import { agreeConsent, fetchConsentStatus } from "./consentApi";
import { ServerRejectedError } from "./request";

const consentKeys = {
  all: ["consent"] as const,
  status: (userId: string) => ["consent", userId] as const,
};

export function useConsentStatus(userId: string) {
  return useQuery({
    queryKey: consentKeys.status(userId),
    queryFn: fetchConsentStatus,
    staleTime: Infinity,
    retry: false,
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
 * 서버가 공개·링크 공유·가져오기·신고·링크 참여를 막으면 이 거절로 알게 된다.
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
