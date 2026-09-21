import { Hono } from "hono";
import type { AppEnv } from "./types";
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
  // Root blank page endpoint (M0 deployment verification)
  .get("/", (c) => {
    return c.html(
      `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Worship Slide</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: #09090b;
      color: #f4f4f5;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
      text-align: center;
    }
    .card {
      max-width: 480px;
      padding: 2rem;
      border-radius: 12px;
      border: 1px solid #27272a;
      background: #18181b;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      border-radius: 9999px;
      background: #052e16;
      border: 1px solid #166534;
      font-size: 0.75rem;
      font-weight: 500;
      color: #4ade80;
      margin-bottom: 1.25rem;
    }
    .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #22c55e;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 700;
      letter-spacing: -0.025em;
      margin-bottom: 0.75rem;
    }
    p {
      font-size: 0.875rem;
      color: #a1a1aa;
      line-height: 1.6;
      margin-bottom: 1.5rem;
    }
    .status {
      font-family: monospace;
      font-size: 0.75rem;
      color: #71717a;
      border-top: 1px solid #27272a;
      padding-top: 1rem;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge"><span class="dot"></span>Cloudflare Worker Online</div>
    <h1>Worship Slide</h1>
    <p>교회 예배팀을 위한 웹 슬라이드 송출 시스템<br />M0 기반 인프라가 준비되었습니다.</p>
    <div class="status">Milestone M0 • API Health: /api/health</div>
  </div>
</body>
</html>`,
      200,
    );
  })
  // Background media routes
  .route("/api/backgrounds", backgroundsRoute)
  // R2 media streaming routes (HTTP Range partial content)
  .route("/api/media", mediaRoute);

export type AppType = typeof app;
export { app };
export default app;
