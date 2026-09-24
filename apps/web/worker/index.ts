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
      .onError((err, c) => {
        console.error("Worker Error:", err);
        return c.json(
          {
            error: err.message || "Internal Server Error",
          },
          500,
        );
      })
      .notFound((c) => {
        return c.json(
          {
            error: "Not Found",
          },
          404,
        );
      })
      .get("/api/health", (c) => {
        return c.json({ status: "ok" as const }, 200);
      })
      .on(["GET", "POST"], `${AUTH_BASE_PATH}/*`, (c) => {
        return createAuth(c.env).handler(c.req.raw);
      })
      .route("/api", devLoginRoute)
      .route("/api/presentations", createPresentationsRoute(deps))
      .route("/api/folders", createFoldersRoute(deps))
      .route("/api/decks", createDecksRoute(deps))
      .route("/api/catalog", createCatalogRoute(deps))
      .route("/api/reports", createReportsRoute(deps))
      .route("/api/backgrounds", backgroundsRoute)
      .route("/api/media", mediaRoute)
  );
}

export type AppType = ReturnType<typeof createApp>;

const app = createApp();
export { app };
export default app;
