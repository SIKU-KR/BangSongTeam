import { hc } from "hono/client";
import type { AppType } from "../../../worker/index";

/**
 * Hono RPC 클라이언트.
 *
 * 서버 통신은 반드시 이 클라이언트를 통한다 (CLAUDE.md §6.1). 느슨한
 * `fetch('/api/...')`를 쓰면 Worker 라우트가 바뀌어도 타입이 안 깨져,
 * 배포하고 나서야 404를 만난다.
 *
 * 세션은 httpOnly 쿠키라 `credentials: "include"`가 필수다.
 */
export const api = hc<AppType>("/", {
  init: { credentials: "include" },
});

/** 네트워크 자체에 닿지 못했을 때 (오프라인·DNS 실패 등) */
export class NetworkUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("서버에 연결할 수 없습니다");
    this.name = "NetworkUnavailableError";
    this.cause = cause;
  }
}

/**
 * 요청을 보내되 '서버가 거절함'과 '서버에 닿지 못함'을 구분한다.
 *
 * 이 구분이 중요한 이유: 401은 로그아웃시켜야 하지만, 오프라인은 캐시된
 * 세션을 유지해야 한다. 둘을 묶으면 예배 당일 네트워크가 끊기는 순간
 * 로그인 화면으로 튕긴다.
 */
export async function requestOrThrowOffline<T>(
  send: () => Promise<T>,
): Promise<T> {
  try {
    return await send();
  } catch (err) {
    throw new NetworkUnavailableError(err);
  }
}
