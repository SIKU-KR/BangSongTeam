import type { MiddlewareHandler, TypedResponse } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { IdSchema } from "#shared";
import type { AppEnv } from "../types";

const FIRESTORE_RESERVED_ID = /^__.*__$/;

const IdParamSchema = z.object({
  id: IdSchema.refine((id) => !FIRESTORE_RESERVED_ID.test(id)),
});

const TokenParamSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
});

type ParamInput<K extends string> = {
  in: { param: Record<K, string> };
  out: { param: Record<K, string> };
};

type ParamRejection<S extends 400 | 404> = Response &
  TypedResponse<{ error: string }, S, "json">;

/**
 * 경로의 `:id`를 검사한다. 이 값은 그대로 Firestore 문서 경로가 되므로 형식이 틀리거나
 * (`a%2Fb`는 `a/b`로 풀린다) Firestore가 예약한 `__…__` 꼴이면 저장소 오류 500 대신 그
 * 라우트가 없는 대상에 주는 `{ error }`와 `status`로 답한다.
 *
 * 지우기는 404여야 한다. 클라이언트는 404만 이미 지워진 것으로 보고 다시 보내지 않는다.
 */
export function idParam<S extends 400 | 404>(
  error: string,
  status: S,
): MiddlewareHandler<AppEnv, string, ParamInput<"id">, ParamRejection<S>> {
  return zValidator("param", IdParamSchema, (result, c) => {
    if (!result.success) return c.json({ error }, status);
  });
}

/**
 * 경로의 공유 링크 `:token`을 검사한다. 토큰은 모두 `createId()`로 만들지만 형식을 그만큼
 * 좁히지 않고, Firestore 색인 값 한도(1500바이트)를 넘는 길이와 URL에 안전하지 않은 문자만
 * 거른다. 맞지 않으면 만료된 링크와 같은 404다.
 */
export function tokenParam(
  error: string,
): MiddlewareHandler<AppEnv, string, ParamInput<"token">, ParamRejection<404>> {
  return zValidator("param", TokenParamSchema, (result, c) => {
    if (!result.success) return c.json({ error }, 404);
  });
}
