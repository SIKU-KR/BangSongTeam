import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgreeConsentRequest, ConsentStatusResponse } from "#shared";
import { agreeConsent, fetchConsentStatus } from "./consentApi";

const consentKeys = {
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
