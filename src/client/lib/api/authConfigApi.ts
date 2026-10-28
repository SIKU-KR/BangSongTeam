import { AuthConfigResponseSchema, type AuthConfigResponse } from "#shared";
import { api } from "./client";
import { callApi } from "./request";

/**
 * 이 서버에서 로그인을 시작할 수 있는 소셜 로그인을 받는다. 세션 없이 부르는 공개 API라
 * 로그인하지 않은 사람의 로그인 화면이 쓴다.
 */
export async function fetchAuthConfig(): Promise<AuthConfigResponse> {
  const body = await callApi(() => api.api["auth-config"].$get());
  return AuthConfigResponseSchema.parse(body);
}
