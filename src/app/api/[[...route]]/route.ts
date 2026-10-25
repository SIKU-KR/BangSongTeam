import { app } from "../../../server";
import { getServerEnv } from "../../../server/env";

/**
 * 모든 `/api/*` 요청을 Hono 앱(`src/server`)에 넘긴다. 라우팅·인증·검증은 Hono가 맡고,
 * 이 파일은 Firestore·미디어 저장소·비밀값 바인딩만 붙인다.
 */
async function handle(request: Request): Promise<Response> {
  return app.fetch(request, getServerEnv());
}

export const dynamic = "force-dynamic";

export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
