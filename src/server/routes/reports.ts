import { Hono } from "hono";
import { API_ERRORS, CreateReportRequestSchema } from "#shared";
import { createReport } from "#db";
import type { AppEnv } from "../types";
import { resolveRequireAuth, type AppDeps } from "../deps";
import { CLOUD_TRACE_LOG_FIELD } from "../lib/cloudTrace";
import { writeLog } from "../lib/requestLog";
import { requireConsent } from "../middleware/consent";
import { jsonBody } from "../lib/jsonBody";
import { SMALL_BODY_MAX_BYTES } from "../middleware/bodyLimit";

/**
 * 신고 접수. 처리는 `scripts/moderation.mjs`로 한다 — 관리자 화면은 두지 않는다.
 *
 * 받은 신고마다 `report_created` WARNING 로그를 한 줄 남긴다. 저작권 게시 중단 요청은 '지체 없이'
 * 처리해야 하는데(이용약관 제5조) 운영자가 명령을 돌려 보기 전에는 알 길이 없어서, 이 줄에 건
 * 로그 기반 알림이 운영자에게 알린다. 줄에는 신고 id와 사유만 싣는다. 신고 내용(`details`)에는
 * 가사가 들어 있을 수 있다.
 *
 * 운영자가 제한한 계정의 신고는 403, 그날 한도를 넘은 신고는 429다.
 */
export function createReportsRoute(deps: AppDeps = {}) {
  const reportBody = jsonBody(CreateReportRequestSchema, SMALL_BODY_MAX_BYTES);

  return new Hono<AppEnv>()
    .use("*", resolveRequireAuth(deps))
    .use("*", requireConsent)
    .post("/", reportBody, async (c) => {
      const db = c.env.DB;
      const input = c.req.valid("json");
      const result = await createReport(db, c.get("userId") as string, input);

      switch (result.status) {
        case "ok":
          writeLog("WARNING", {
            event: "report_created",
            requestId: c.get("requestId"),
            [CLOUD_TRACE_LOG_FIELD]: c.get("logTrace"),
            reportId: result.id,
            reason: input.reason,
          });
          return c.json({ id: result.id }, 201);
        case "not_found":
          return c.json({ error: API_ERRORS.report.targetNotFound }, 404);
        case "duplicate":
          return c.json({ error: API_ERRORS.report.alreadyPending }, 409);
        case "banned":
          return c.json({ error: API_ERRORS.accountRestricted }, 403);
        case "rate_limited":
          return c.json({ error: API_ERRORS.report.dailyLimit }, 429);
      }
    });
}
