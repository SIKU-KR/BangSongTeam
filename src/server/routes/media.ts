import { Hono, type Context } from "hono";
import { basePath } from "hono/route";
import { API_ERRORS } from "#shared";
import { parseRangeHeader, resolveByteRange } from "../lib/byteRange";
import type { ByteRange, MediaObject } from "../lib/mediaStore";
import type { AppEnv } from "../types";

const IMMUTABLE_MEDIA_CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * Cloud Run은 `content-length`를 단 HTTP/1 응답을 32 MiB까지만 보낸다. 그보다 긴 본문은
 * 길이를 빼고 chunked로 흘려보낸다. https://cloud.google.com/run/quotas
 */
const MAX_SIZED_RESPONSE_BYTES = 32 * 1024 * 1024 - 1;

function objectHeaders(object: MediaObject, length: number): Headers {
  const headers = new Headers({
    "content-type": object.contentType,
    etag: object.etag,
    "accept-ranges": "bytes",
    "cache-control": IMMUTABLE_MEDIA_CACHE_CONTROL,
  });
  if (length <= MAX_SIZED_RESPONSE_BYTES) {
    headers.set("content-length", String(length));
  }
  return headers;
}

function mediaNotFound(c: Context<AppEnv>): Response {
  return c.json({ error: API_ERRORS.media.notFound }, 404);
}

function mediaBody(
  c: Context<AppEnv>,
  key: string,
  object: MediaObject,
  range?: ByteRange,
): ReadableStream<Uint8Array> | null {
  return c.req.method === "HEAD" ? null : c.env.MEDIA.read(key, object, range);
}

/**
 * 미디어 저장소(GCS) 스트리밍 라우트 (HTTP Range 및 Partial Content 지원). 배경 영상을
 * 앱과 같은 출처로 내보내야 서비스 워커가 Range 요청과 함께 캐시해 오프라인 송출을 한다.
 *
 * 배경은 모두 누구에게나 보이는 기본 제공 배경이라 인증 없이 서빙한다. 여기서
 * 세션을 검사하면 송출 중 세션이 만료되는 순간 배경이 꺼진다 — 예배 화면이 검게
 * 되는 쪽이 더 큰 사고다.
 *
 * 크기와 판을 먼저 확인하고 Range를 직접 검증한다. 만족할 수 없는 범위는 416, 깨진
 * 헤더는 무시하고 200으로 답한다. 읽기는 확인한 판으로 고정해 그사이 객체가 바뀌어도
 * 검증한 범위와 다른 바이트를 섞어 보내지 않는다.
 *
 * HEAD는 같은 헤더로 답하되 저장소 본문을 열지 않는다. Hono는 HEAD를 이 GET 핸들러로
 * 처리한 뒤 본문을 취소하지 않고 버리므로, 열어 둔 내려받기가 끝나지 않고 남는다.
 */
export function createMediaRoute() {
  return new Hono<AppEnv>().get("/*", async (c) => {
    const key = c.req.path.slice(`${basePath(c)}/`.length);
    if (!key) {
      return c.json({ error: API_ERRORS.media.keyRequired }, 400);
    }

    const object = await c.env.MEDIA.stat(key);
    if (!object) {
      return mediaNotFound(c);
    }

    const rangeHeader = c.req.header("range");
    const requested = rangeHeader ? parseRangeHeader(rangeHeader) : null;

    if (!requested) {
      return new Response(mediaBody(c, key, object), {
        status: 200,
        headers: objectHeaders(object, object.size),
      });
    }

    const resolved = resolveByteRange(requested, object.size);
    if (!resolved) {
      return new Response(null, {
        status: 416,
        headers: {
          "content-range": `bytes */${object.size}`,
          "accept-ranges": "bytes",
        },
      });
    }

    const headers = objectHeaders(object, resolved.end - resolved.start + 1);
    headers.set(
      "content-range",
      `bytes ${resolved.start}-${resolved.end}/${object.size}`,
    );
    return new Response(mediaBody(c, key, object, resolved), {
      status: 206,
      headers,
    });
  });
}
