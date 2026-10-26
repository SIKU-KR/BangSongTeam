import type { MiddlewareHandler } from "hono";
import { csrf } from "hono/csrf";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types";

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * 다른 출처의 페이지가 로그인한 사용자의 쿠키로 보낸 쓰기 요청을 막는다(CSRF).
 *
 * 세션 쿠키는 SameSite=Lax라 다른 사이트의 폼에는 실리지 않지만, 같은 사이트의 다른 하위
 * 도메인(*.siku-labs.com)이 보낸 폼에는 실린다. JSON 본문은 폼으로 흉내 낼 수 없어 안전하지만
 * 본문 없는 POST(가져오기·링크 참여·링크 재설정)는 막을 것이 없다. 그래서 폼으로 보낼 수 있는
 * 쓰기(본문 형식이 폼·텍스트이거나 없는 것)는 브라우저가 붙이는 `Sec-Fetch-Site: same-origin`이나
 * 앱 주소(`BETTER_AUTH_URL`)와 같은 `Origin`이 있을 때만 받는다. 앱이 보내는 요청은 모두
 * 같은 출처의 `fetch`라 둘 중 하나가 늘 붙는다.
 *
 * 요청 URL은 앞단 Worker가 run.app으로 바꿔 넘기므로 출처 비교에 쓰지 않는다. `/api/auth/*`는
 * Better Auth가 스스로 출처를 확인한다.
 */
export function sameOriginWrites(): MiddlewareHandler<AppEnv> {
  const guard = csrf({
    origin: (origin, c) => {
      const appOrigin = originOf((c.env as AppEnv["Bindings"]).BETTER_AUTH_URL);
      return appOrigin !== null && origin === appOrigin;
    },
  });
  return createMiddleware<AppEnv>(async (c, next) => {
    if (c.req.path.startsWith("/api/auth/")) return next();
    return guard(c, next);
  });
}
