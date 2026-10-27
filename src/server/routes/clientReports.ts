import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import {
  API_ERRORS,
  CLIENT_REPORT_MAX_BYTES,
  ClientReportBatchSchema,
} from "#shared";
import type { AppEnv } from "../types";
import { createFixedWindowLimiter } from "../lib/rateLimit";
import { clientIp } from "../lib/clientIp";
import { writeLog } from "../lib/requestLog";
import { jsonBody } from "../lib/jsonBody";

const REPORTS_PER_WINDOW = 30;
const REPORT_WINDOW_MS = 60_000;

/**
 * 브라우저가 `sendBeacon`으로 모아 보낸 요청 실패를 서버 로그로 옮긴다.
 *
 * 저장하지 않고 보고 1건마다 `client_report` 로그 한 줄만 남긴다. 보고의
 * `requestId`가 API 요청 로그의 `requestId`와 같으므로, 응답을 받지 못한 요청(타임아웃)도
 * 같은 값으로 찾을 수 있다. 세션은 읽지 않는다. 로그인하지 않은 화면(공유 링크 보기)에서도
 * 보내고, 세션 저장소(Firestore) 장애 중에도 보고는 받아야 하기 때문이다.
 *
 * 누구나 부를 수 있는 엔드포인트라 IP별 빈도(429), 본문 크기(413), 엄격한 스키마(400)를
 * 이 순서로 먼저 확인한다. 응답은 아무도 읽지 않으므로 204로 끝낸다.
 */
export function createClientReportsRoute() {
  const allow = createFixedWindowLimiter({
    limit: REPORTS_PER_WINDOW,
    windowMs: REPORT_WINDOW_MS,
  });
  const rateLimit = createMiddleware<AppEnv>(async (c, next) => {
    if (!allow(clientIp(c.req.raw.headers))) {
      return c.json({ error: API_ERRORS.tooManyRequests }, 429);
    }
    await next();
  });

  return new Hono<AppEnv>().post(
    "/",
    rateLimit,
    jsonBody(ClientReportBatchSchema, CLIENT_REPORT_MAX_BYTES),
    (c) => {
      const { appVersion, reports } = c.req.valid("json");
      for (const report of reports) {
        writeLog("INFO", {
          event: "client_report",
          requestId: report.requestId ?? null,
          reportRequestId: c.get("requestId"),
          kind: report.kind,
          route: report.route,
          online: report.online,
          swControlled: report.swControlled,
          appVersion,
        });
      }
      return c.body(null, 204);
    },
  );
}
