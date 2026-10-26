import type { Context, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { API_ERRORS } from "#shared";
import type { AppEnv } from "../types";

/**
 * 인증(`/api/auth/*`) 요청 본문 상한(바이트).
 *
 * Better Auth는 출처 확인보다 본문 해석을 먼저 해서, 로그인하지 않은 사람이 보낸 큰 본문도
 * 끝까지 읽고 해석한다. 로그인·가입 본문은 1 KB 남짓이다.
 */
export const AUTH_BODY_MAX_BYTES = 64 * 1024;

/**
 * 그 밖의 API 요청 본문 상한(바이트).
 *
 * 가장 큰 본문은 곡을 모두 담은 프레젠테이션 저장이다. 곡 하나가 수 KB라 곡이 200개여도
 * 넉넉하고, Cloud Run이 받는 32 MiB 본문을 통째로 해석하다 인스턴스 메모리가 바닥나는 일은
 * 막는다.
 */
export const API_BODY_MAX_BYTES = 2 * 1024 * 1024;

function payloadTooLarge(c: Context<AppEnv>): Response {
  return c.json({ error: API_ERRORS.payloadTooLarge }, 413);
}

/**
 * 본문이 `maxSize` 바이트를 넘으면 해석하기 전에 413으로 끊는다.
 *
 * `content-length`가 있으면 읽지 않고 판단하고, 없으면(chunked) `maxSize`까지만 읽는다.
 * Hono 기본 동작은 예외를 던지므로 응답을 직접 만든다.
 */
export function limitBody(maxSize: number): MiddlewareHandler<AppEnv> {
  return bodyLimit({ maxSize, onError: payloadTooLarge });
}
