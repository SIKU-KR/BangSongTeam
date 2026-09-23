import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { CreateReportRequestSchema } from "@repo/shared";
import { createD1Client, createReport } from "@repo/db";
import type { AppEnv } from "../types";
import { resolveRequireAuth, type AppDeps } from "../deps";

/**
 * 신고 접수 (PRD 4.7 신고). 처리는 운영 런북이 한다 — 관리자 화면은 두지 않는다.
 */
export function createReportsRoute(deps: AppDeps = {}) {
  return new Hono<AppEnv>()
    .use("*", resolveRequireAuth(deps))
    .post("/", zValidator("json", CreateReportRequestSchema), async (c) => {
      const db = createD1Client(c.env.DB);
      const result = await createReport(
        db,
        c.get("userId") as string,
        c.req.valid("json"),
      );

      switch (result.status) {
        case "ok":
          return c.json({ id: result.id }, 201);
        case "not_found":
          return c.json({ error: "신고할 대상을 찾을 수 없습니다" }, 404);
        case "duplicate":
          return c.json({ error: "이미 접수된 신고가 처리 중입니다" }, 409);
      }
    });
}
