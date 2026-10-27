import type { Context, MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { API_ERRORS } from "#shared";
import type { AppEnv } from "../types";

/**
 * 인증(`/api/auth/*`) 요청 본문 상한(바이트).
 *
 * Better Auth는 출처 확인보다 본문 해석을 먼저 해서, 로그인하지 않은 사람이 보낸 큰 본문도
 * 끝까지 읽고 해석한다. 로그인·가입 본문은 1 KB 남짓이다.
 */
export const AUTH_BODY_MAX_BYTES = 64 * 1024;

/** 폴더·공개 범위·공유 설정·동의·신고 본문 상한(바이트). 실제 본문은 1 KB 남짓이다 */
export const SMALL_BODY_MAX_BYTES = 64 * 1024;

/**
 * 폴더 영구 삭제 본문 상한(바이트). 그 기기가 본 하위 폴더·프레젠테이션 id(`expected`)를 모두
 * 담는다. id 하나가 25바이트 남짓이라 4만 개가 넘게 들어간다. 이 상한에 걸리는 폴더는 그 기기에서
 * 영구 삭제할 수 없으므로 폴더 저장 본문보다 넉넉히 둔다.
 */
export const FOLDER_DELETE_BODY_MAX_BYTES = 1024 * 1024;

/**
 * 보관함 곡 저장 본문 상한(바이트). 곡 하나가 Firestore 문서 하나라 1 MiB를 넘는 곡은 어차피
 * 저장하지 못한다.
 */
export const DECK_BODY_MAX_BYTES = 1024 * 1024;

/**
 * 프레젠테이션 저장 본문 상한(바이트). 곡을 모두 담아 보내는 가장 큰 본문이다. 곡 하나가 수 KB라
 * 곡이 200개여도 넉넉하다.
 */
export const PRESENTATION_BODY_MAX_BYTES = 2 * 1024 * 1024;

const BODY_BUDGET_BYTES = 16 * 1024 * 1024;

export interface BodyBudget {
  /** `bytes`만큼 자리를 잡는다. 다른 본문이 처리 중이고 자리가 모자라면 잡지 않고 `false`다 */
  tryAcquire(bytes: number): boolean;
  release(bytes: number): void;
}

/**
 * 처리 중인 요청 본문 바이트의 합을 `maxBytes`로 묶는다.
 *
 * 처리 중인 본문이 없으면 크기와 상관없이 자리를 내준다. 그래야 예산보다 큰 본문도 언젠가 처리된다.
 */
export function createBodyBudget(maxBytes: number): BodyBudget {
  let inFlightBytes = 0;
  let inFlightCount = 0;
  return {
    tryAcquire(bytes) {
      if (inFlightCount > 0 && inFlightBytes + bytes > maxBytes) return false;
      inFlightBytes += bytes;
      inFlightCount += 1;
      return true;
    },
    release(bytes) {
      inFlightBytes -= bytes;
      inFlightCount -= 1;
    },
  };
}

const instanceBodyBudget = createBodyBudget(BODY_BUDGET_BYTES);

function payloadTooLarge(c: Context<AppEnv>): Response {
  return c.json({ error: API_ERRORS.payloadTooLarge }, 413);
}

async function readUpTo(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) return null;
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * 본문을 `maxBytes`까지만 받아 두고, 인스턴스의 본문 예산에 자리가 있을 때만 다음으로 넘긴다.
 *
 * - `content-length`가 상한을 넘으면 읽지 않고 413이다. 길이를 밝히지 않은 본문(chunked)은
 *   상한을 넘는 순간 그만 읽고 413이다. Hono 기본 동작은 예외를 던지므로 응답을 직접 만든다.
 * - 본문 하나의 상한만으로는 메모리를 지키지 못한다. `JSON.parse`는 `[{},{},...]` 같은 본문을
 *   바이트의 20배 넘게 키우고, 동시에 처리 중인 본문의 해석 결과는 모두 함께 메모리에 있다.
 *   가입하면 누구나 보낼 수 있는 2 MiB 본문 30여 개가 한꺼번에 오면 2 GiB 인스턴스의 힙이
 *   바닥난다(Cloud Run 동시 요청 기본값 80). 그래서 인스턴스마다 처리 중인 본문 바이트의 합을
 *   16 MiB로 묶고, 넘치면 해석하지 않고 503 `serverBusy`로 돌려보낸다. `retryAfterOnUnavailable`이
 *   `Retry-After`를 달아 클라이언트가 나중에 다시 보낸다.
 * - 본문을 다 받은 뒤에 자리를 잡고 응답을 만들 때까지 쥔다. 천천히 보내는 요청이 예산을 붙잡지
 *   못한다.
 * - 로그인이 필요한 라우트는 세션 확인 뒤에 둔다. 로그인하지 않은 요청의 본문은 읽지 않는다.
 */
export function limitBody(
  maxBytes: number,
  budget: BodyBudget = instanceBodyBudget,
): MiddlewareHandler<AppEnv> {
  return createMiddleware<AppEnv>(async (c, next) => {
    const raw = c.req.raw;
    if (!raw.body) return next();
    const declaredLength = raw.headers.get("content-length");
    if (
      declaredLength !== null &&
      !raw.headers.has("transfer-encoding") &&
      Number(declaredLength) > maxBytes
    ) {
      return payloadTooLarge(c);
    }
    const bytes = await readUpTo(raw.body, maxBytes);
    if (bytes === null) return payloadTooLarge(c);
    c.req.raw = new Request(raw, { body: bytes });
    if (bytes.byteLength === 0) return next();
    if (!budget.tryAcquire(bytes.byteLength)) {
      return c.json({ error: API_ERRORS.serverBusy }, 503);
    }
    try {
      await next();
    } finally {
      budget.release(bytes.byteLength);
    }
  });
}
