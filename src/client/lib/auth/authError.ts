import { AUTH_COPY } from "#copy/auth";

/**
 * 소셜 로그인이 도중에 실패하면 Better Auth가 로그인을 시작한 주소(`errorCallbackURL`)에 이
 * 이름으로 오류 코드를 붙여 돌려보낸다. 시작한 주소를 알 수 없을 만큼 일찍 실패하면 서버의
 * 오류 주소가 `/?error=코드`로 보낸다(`LandingRoute`가 로그인 화면으로 넘긴다).
 */
export const AUTH_ERROR_PARAM = "error";

const AUTH_ERROR_DESCRIPTION_PARAM = "error_description";

/**
 * 소셜 로그인 오류 코드에 맞는 안내 문구. 안내할 것이 없으면 null이다.
 *
 * Google 화면에서 직접 취소한 `access_denied`는 사용자가 한 일이라 알리지 않는다. 코드는 화면에
 * 그대로 보이지 않고 아는 것만 문구로 바꾼다. 나머지는 모두 로그인을 마치지 못했다는 안내다.
 */
export function callbackErrorMessage(code: string | null): string | null {
  switch (code) {
    case null:
    case "":
    case "access_denied":
      return null;
    case "account_not_linked":
      return AUTH_COPY.oauthErrors.accountNotLinked;
    case "state_mismatch":
      return AUTH_COPY.oauthErrors.stateExpired;
    default:
      return AUTH_COPY.signInFailed;
  }
}

/**
 * 주소의 쿼리(`?a=1`)에서 소셜 로그인 오류 코드만 지운 쿼리. 남은 것이 없으면 빈 문자열이다.
 * 안내를 읽은 뒤 주소에서 지워, 새로고침이나 이어지는 로그인에 오류가 따라가지 않게 한다.
 */
export function withoutAuthError(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(AUTH_ERROR_PARAM);
  params.delete(AUTH_ERROR_DESCRIPTION_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}
