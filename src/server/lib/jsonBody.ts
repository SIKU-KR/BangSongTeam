import type { Context, MiddlewareHandler } from "hono";
import { every } from "hono/combine";
import { validator } from "hono/validator";
import type { z } from "zod";
import { API_ERRORS, toWellFormedText } from "#shared";
import type { AppEnv } from "../types";
import { limitBody } from "../middleware/bodyLimit";

type JsonBodyInput<T extends z.ZodType> = {
  in: undefined extends z.input<T>
    ? { json?: z.input<T> }
    : { json: z.input<T> };
  out: { json: z.output<T> };
};

const SURROGATE_CODE_UNIT = /[\uD800-\uDFFF]/;

function wellFormed(text: string): string {
  return SURROGATE_CODE_UNIT.test(text) ? toWellFormedText(text) : text;
}

function toWellFormedJson(body: unknown): unknown {
  if (typeof body === "string") return wellFormed(body);
  const pending: unknown[] = [body];
  const visit = (value: unknown): unknown => {
    if (typeof value === "string") return wellFormed(value);
    if (value !== null && typeof value === "object") pending.push(value);
    return value;
  };
  while (pending.length > 0) {
    const node = pending.pop();
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) node[i] = visit(node[i]);
    } else if (node !== null && typeof node === "object") {
      const record = node as Record<string, unknown>;
      for (const key of Object.keys(record)) record[key] = visit(record[key]);
    }
  }
  return body;
}

/**
 * JSON 본문을 `maxBytes`까지 받아(`limitBody`) `schema`로 검사한다. JSON 본문을 읽는 라우트는
 * 모두 이것을 쓴다.
 *
 * 틀린 본문은 첫 문제에서 검사를 멈추고(`schema.validate`) 400 `idMismatch`로 답한다. Zod 기본
 * 검사(`safeParse`)는 원소마다 문제를 모두 모은다. 2 MiB 본문의 `decks: [{},{},...]` 하나가
 * 문제 600만 개와 힙 1.8 GiB를 만들고, zValidator 기본 응답은 그 목록을 직렬화하다 문자열 한도를
 * 넘는다. 맞는 본문만 `schema.parse`로 기본값을 채운다.
 *
 * 검사하기 전에 본문의 모든 문자열에서 짝을 잃은 서로게이트(이모지 같은 서로게이트 쌍의 반쪽)를
 * U+FFFD로 바꾼다(`toWellFormedText`). Firestore는 그런 문자열을 저장하지 못해, 그 글을 보내는 이전
 * 버전 클라이언트의 저장(프레젠테이션 PUT·PATCH, 곡 PUT, 폴더 이름)은 트랜잭션을 몇 초 다시 시도한
 * 끝에 500이 되고, 클라이언트는 같은 저장을 거듭 다시 보낸다. 바꾼 글자는 화면에서 깨진 반쪽과
 * 똑같이 보인다. 검사 전에 바꿔 한도도 저장할 글로 세고, `onInvalid`도 바꾼 본문을 받는다. 저장본과
 * 응답을 읽는 스키마(`DeckSchema`·`PresentationSchema`·`FolderSchema`)는 그대로 둔다. 본문은 몇십만
 * 겹으로 겹칠 수 있어 재귀 없이 훑는다.
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
    validator("json", (value: unknown, c: Context): unknown => {
      const body = toWellFormedJson(value);
      return schema.validate(body)
        ? schema.parse(body)
        : (onInvalid?.(body, c) ??
            c.json({ error: API_ERRORS.idMismatch }, 400));
    }),
  );
}
