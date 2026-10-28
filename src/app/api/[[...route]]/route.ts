import { app } from "../../../server";
import { getServerEnv } from "../../../server/env";
import {
  rejectUnproxied,
  withTrustedClientIp,
} from "../../../server/lib/clientIp";

/**
 * 모든 `/api/*` 요청을 Hono 앱(`src/server`)에 넘긴다. 라우팅·인증·검증은 Hono가 맡고,
 * 이 파일은 Firestore·미디어 저장소·비밀값 바인딩을 붙이고, 앞단 프록시가 넘긴 사용자 IP를
 * 반영한다. `REQUIRE_PROXY`를 켜면 프록시를 거치지 않은 요청은 여기서 막는다.
 * 프록시 비밀값 헤더를 `withTrustedClientIp`가 지우므로 막는 일이 먼저다.
 */
async function handle(request: Request): Promise<Response> {
  const env = getServerEnv();
  const unproxied = rejectUnproxied(request, env);
  if (unproxied) return unproxied;
  return app.fetch(withTrustedClientIp(request, env.PROXY_SECRET), env);
}

export const dynamic = "force-dynamic";

export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
