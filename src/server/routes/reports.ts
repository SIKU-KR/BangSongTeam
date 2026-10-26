import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { API_ERRORS, CreateReportRequestSchema } from "#shared";
import { createReport } from "#db";
import type { AppEnv } from "../types";
import { resolveRequireAuth, type AppDeps } from "../deps";
import { requireConsent } from "../middleware/consent";

/**
 * 신고 접수. 처리는 `scripts/moderation.mjs`로 한다 — 관리자 화면은 두지 않는다.
 */
export function createReportsRoute(deps: AppDeps = {}) {
  return new Hono<AppEnv>()
    .use("*", resolveRequireAuth(deps))
    .use("*", requireConsent)
    .post("/", zValidator("json", CreateReportRequestSchema), async (c) => {
      const db = c.env.DB;
      const result = await createReport(
        db,
        c.get("userId") as string,
        c.req.valid("json"),
      );

      switch (result.status) {
        case "ok":
          return c.json({ id: result.id }, 201);
        case "not_found":
          return c.json({ error: API_ERRORS.report.targetNotFound }, 404);
        case "duplicate":
          return c.json({ error: API_ERRORS.report.alreadyPending }, 409);
      }
    });
}
