import { Hono } from "hono";
import type { AppEnv } from "./types";
import { createAuth, AUTH_BASE_PATH } from "./lib/auth";
import { backgroundsRoute } from "./routes/backgrounds";
import { mediaRoute } from "./routes/media";

const app = new Hono<AppEnv>()
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
  // Background media routes
  .route("/api/backgrounds", backgroundsRoute)
  // R2 media streaming routes (HTTP Range partial content)
  .route("/api/media", mediaRoute);

export type AppType = typeof app;
export { app };
export default app;
