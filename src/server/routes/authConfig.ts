import { Hono } from "hono";
import type { AuthConfigResponse } from "#shared";
import type { AppEnv } from "../types";
import { configuredSocialProviders } from "../lib/auth";

/**
 * 로그인 화면이 보여 줄 소셜 로그인(`AuthConfigResponseSchema`). `/api/auth/*`는 모두 Better
 * Auth가 받으므로 그 바깥에 둔다.
 *
 * 배포 설정만 읽어 세션도 Firestore도 쓰지 않는다. 비밀값을 바꿔 새 리비전이 뜨면 바로 맞는
 * 목록이 나가도록 캐시하지 않는다.
 */
export function createAuthConfigRoute() {
  return new Hono<AppEnv>().get("/", (c) => {
    c.header("Cache-Control", "no-store");
    const body: AuthConfigResponse = {
      providers: configuredSocialProviders(c.env),
    };
    return c.json(body, 200);
  });
}
