import { Hono } from "hono";
import type { AppEnv } from "./types";
import { backgroundsRoute } from "./routes/backgrounds";

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
  // Background media routes
  .route("/api/backgrounds", backgroundsRoute);

export type AppType = typeof app;
export { app };
export default app;
