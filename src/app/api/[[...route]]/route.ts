import { getCloudflareContext } from "@opennextjs/cloudflare";
import { app } from "../../../server";
import type { Bindings } from "../../../server/types";

/**
 * 모든 `/api/*` 요청을 Hono 앱(`src/server`)에 넘긴다. 라우팅·인증·검증은 Hono가 맡고,
 * 이 파일은 배포 환경의 바인딩(D1·R2·AI·Vectorize·비밀값)만 꺼내 준다.
 */
async function handle(request: Request): Promise<Response> {
  const { env, ctx } = await getCloudflareContext({ async: true });
  return app.fetch(request, env as unknown as Bindings, ctx);
}

export const dynamic = "force-dynamic";

export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
