import { hc } from "hono/client";
import { fetchWithTimeout } from "./fetchWithTimeout";
import type { AppType } from "../../../worker/index";

/**
 * Hono RPC 클라이언트.
 *
 * 서버 통신은 반드시 이 클라이언트를 통한다. 느슨한
 * `fetch('/api/...')`를 쓰면 Worker 라우트가 바뀌어도 타입이 안 깨져,
 * 배포하고 나서야 404를 만난다.
 *
 * 세션은 httpOnly 쿠키라 `credentials: "include"`가 필수다.
 * 모든 요청에는 네트워크 멈춤을 방지하기 위한 데드라인(timeout)이 적용된다.
 */
export const api = hc<AppType>("/", {
  init: { credentials: "include" },
  fetch: fetchWithTimeout,
});
