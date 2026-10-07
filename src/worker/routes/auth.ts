import { Hono } from "hono";
import type { AppEnv } from "../types";
import { getAuth } from "../lib/auth";

/**
 * better-auth 엔드포인트. 원본 요청을 그대로 넘기므로 마운트 경로는 better-auth의
 * `basePath`(`AUTH_BASE_PATH`)와 같아야 한다.
 */
export function createAuthRoute() {
  return new Hono<AppEnv>().on(["GET", "POST"], "/*", (c) =>
    getAuth(c.env).handler(c.req.raw),
  );
}
