import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { SocialProvider } from "#shared";
import { fetchAuthConfig } from "./authConfigApi";

/**
 * 서버가 켜 둔 소셜 로그인. 받기 전이거나 받지 못하면(오프라인·서버 오류) `data`가 없고,
 * 로그인 화면은 그동안 막히지 않도록 Google만 보여 준다(`visibleSocialProviders`).
 */
export function useConfiguredSocialProviders(): UseQueryResult<
  SocialProvider[]
> {
  return useQuery({
    queryKey: ["auth-config"],
    queryFn: fetchAuthConfig,
    select: (config) => config.providers,
  });
}
