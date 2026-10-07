import { Hono } from "hono";
import type { AppEnv } from "../types";

/**
 * 클라이언트가 서버에 닿는지 확인하는 엔드포인트. 캐시된 응답은 끊긴 연결을 회복으로
 * 오인하게 하므로 저장하지 못하게 한다.
 */
export function createHealthRoute() {
  return new Hono<AppEnv>().get("/", (c) => {
    c.header("Cache-Control", "no-store");
    return c.json({ status: "ok" as const }, 200);
  });
}
