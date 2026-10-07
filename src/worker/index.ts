import { Hono } from "hono";
import type { AppEnv } from "./types";
import { getAuth, AUTH_BASE_PATH } from "./lib/auth";
import { createBackgroundsRoute } from "./routes/backgrounds";
import { mediaRoute } from "./routes/media";
import { createPresentationsRoute } from "./routes/presentations";
import { createFoldersRoute } from "./routes/folders";
import { createDecksRoute } from "./routes/decks";
import { createCatalogRoute } from "./routes/catalog";
import { createReportsRoute } from "./routes/reports";
import { createShareRoute } from "./routes/share";
import { authConfigRoute } from "./routes/authConfig";
import { createConsentRoute } from "./routes/consent";
import { createClientReportsRoute } from "./routes/clientReports";
import type { AppDeps } from "./deps";
import { isTransientStorageError } from "./lib/storageErrors";
import { requestLog } from "./middleware/requestLog";
import { CLIENT_REPORTS_PATH } from "#shared";

/**
 * Worker 앱을 조립한다.
 *
 * 테스트는 `createApp({ readSession })`으로 세션만 바꿔 실제 라우트를 그대로
 * 검증한다. 프로덕션은 기본 의존성으로 만든 `app`을 쓴다.
 *
 * 모든 요청은 `requestLog`가 상관 ID와 함께 구조화 로그 한 줄로 남긴다. 처리되지 않은
 * 예외도 그 줄에 원인과 함께 실리므로 `onError`는 따로 로그를 남기지 않는다.
 */
export function createApp(deps: AppDeps = {}) {
  return new Hono<AppEnv>()
    .onError((err, c) => {
      if (isTransientStorageError(err)) {
        c.header("Retry-After", "2");
        return c.json(
          {
            error: "Service Unavailable",
          },
          503,
        );
      }
      return c.json(
        {
          error: "Internal Server Error",
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
    .use("*", requestLog())
    .get("/api/health", (c) => {
      c.header("Cache-Control", "no-store");
      return c.json({ status: "ok" as const }, 200);
    })
    .on(["GET", "POST"], `${AUTH_BASE_PATH}/*`, (c) => {
      return getAuth(c.env).handler(c.req.raw);
    })
    .route("/api", authConfigRoute)
    .route("/api/consent", createConsentRoute(deps))
    .route("/api/presentations", createPresentationsRoute(deps))
    .route("/api/folders", createFoldersRoute(deps))
    .route("/api/decks", createDecksRoute(deps))
    .route("/api/catalog", createCatalogRoute(deps))
    .route("/api/reports", createReportsRoute(deps))
    .route("/api/share", createShareRoute(deps))
    .route("/api/backgrounds", createBackgroundsRoute())
    .route("/api/media", mediaRoute)
    .route(CLIENT_REPORTS_PATH, createClientReportsRoute());
}

export type AppType = ReturnType<typeof createApp>;

const app = createApp();
export { app };
export default app;
