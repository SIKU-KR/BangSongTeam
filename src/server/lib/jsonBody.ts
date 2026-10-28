import type { Context, MiddlewareHandler } from "hono";
import { every } from "hono/combine";
import { validator } from "hono/validator";
import type { z } from "zod";
import { API_ERRORS } from "#shared";
import type { AppEnv } from "../types";
import { limitBody } from "../middleware/bodyLimit";

type JsonBodyInput<T extends z.ZodType> = {
  in: undefined extends z.input<T>
    ? { json?: z.input<T> }
    : { json: z.input<T> };
  out: { json: z.output<T> };
};

/**
 * JSON 본문을 `maxBytes`까지 받아(`limitBody`) `schema`로 검사한다. JSON 본문을 읽는 라우트는
 * 모두 이것을 쓴다.
 *
 * 틀린 본문은 첫 문제에서 검사를 멈추고(`schema.validate`) 400 `idMismatch`로 답한다. Zod 기본
 * 검사(`safeParse`)는 원소마다 문제를 모두 모은다. 2 MiB 본문의 `decks: [{},{},...]` 하나가
 * 문제 600만 개와 힙 1.8 GiB를 만들고, zValidator 기본 응답은 그 목록을 직렬화하다 문자열 한도를
 * 넘는다. 맞는 본문만 `schema.parse`로 기본값을 채운다.
 *
 * `onInvalid`는 틀린 본문을 400 대신 다른 응답으로 답할 때 쓴다(쓰기 한도를 넘은 저장 본문의
 * 413, `rejectOverLimit`). `undefined`를 돌려주면 400이다.
 */
export function jsonBody<T extends z.ZodType>(
  schema: T,
  maxBytes: number,
  onInvalid?: (body: unknown, c: Context) => Response | undefined,
): MiddlewareHandler<AppEnv, string, JsonBodyInput<T>> {
  return every(
    limitBody(maxBytes),
    validator("json", (value: unknown, c: Context): unknown =>
      schema.validate(value)
        ? schema.parse(value)
        : (onInvalid?.(value, c) ??
          c.json({ error: API_ERRORS.idMismatch }, 400)),
    ),
  );
}
