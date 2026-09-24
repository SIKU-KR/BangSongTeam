import { Hono } from "hono";
import type { AppEnv } from "./types";
import { createAuth, AUTH_BASE_PATH } from "./lib/auth";
import { backgroundsRoute } from "./routes/backgrounds";
import { mediaRoute } from "./routes/media";
import { createPresentationsRoute } from "./routes/presentations";
import { createFoldersRoute } from "./routes/folders";
import { createDecksRoute } from "./routes/decks";
import { createCatalogRoute } from "./routes/catalog";
import { createReportsRoute } from "./routes/reports";
import { devLoginRoute } from "./routes/devLogin";
import type { AppDeps } from "./deps";

/**
 * Worker 앱을 조립한다.
 *
 * 테스트는 `createApp({ readSession })`으로 세션만 바꿔 실제 라우트를 그대로
 * 검증한다. 프로덕션은 기본 의존성으로 만든 `app`을 쓴다.
 */
export function createApp(deps: AppDeps = {}) {
  return (
    new Hono<AppEnv>()
      // Global error handler
      .onError((err, c) => {
        console.error("Worker Error:", err);
        return c.json(
          {
            error: err.message || "Internal Server Error",
          },
          500,
        );
      })
      // 404 handler
      .notFound((c) => {
        return c.json(
          {
            error: "Not Found",
          },
          404,
        );
      })
      // Health check endpoint
      .get("/api/health", (c) => {
        return c.json({ status: "ok" as const }, 200);
      })
      // Better Auth (카카오·네이버 소셜 로그인, 세션 발급)
      //
      // 반드시 이 체인 안에 둔다. 체인에서 떨어진 app.on(...) 문장은 AppType
      // 추론에서 누락되어 프론트엔드 RPC 클라이언트가 경로를 못 본다.
      // wrangler.jsonc의 assets.run_worker_first: ["/api/*"]가 이 경로를 덮는다.
      .on(["GET", "POST"], `${AUTH_BASE_PATH}/*`, (c) => {
        return createAuth(c.env).handler(c.req.raw);
      })
      // 개발자 로그인 및 로그인 화면 설정 (localhost 전용)
      .route("/api", devLoginRoute)
      // 계정 데이터 동기화 (로그인 필수)
      .route("/api/presentations", createPresentationsRoute(deps))
      .route("/api/folders", createFoldersRoute(deps))
      .route("/api/decks", createDecksRoute(deps))
      // 공유 라이브러리 (M5). 검색만 로그인 없이 열린다.
      .route("/api/catalog", createCatalogRoute(deps))
      .route("/api/reports", createReportsRoute(deps))
      // Background media routes
      .route("/api/backgrounds", backgroundsRoute)
      // R2 media streaming routes (HTTP Range partial content)
      .route("/api/media", mediaRoute)
  );
}

export type AppType = ReturnType<typeof createApp>;

const app = createApp();
export { app };
export default app;
