import { Hono, type Context } from "hono";
import { basePath } from "hono/route";
import { API_ERRORS } from "#shared";
import { parseRangeHeader, resolveByteRange } from "../lib/byteRange";
import type { AppEnv } from "../types";

const IMMUTABLE_MEDIA_CACHE_CONTROL = "public, max-age=31536000, immutable";

function objectHeaders(object: R2Object): Headers {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", IMMUTABLE_MEDIA_CACHE_CONTROL);
  return headers;
}

function mediaNotFound(c: Context<AppEnv>): Response {
  return c.json({ error: API_ERRORS.media.notFound }, 404);
}

async function serveWholeObject(
  c: Context<AppEnv>,
  key: string,
): Promise<Response> {
  const object = await c.env.MEDIA_BUCKET.get(key);
  if (!object) {
    return mediaNotFound(c);
  }
  const headers = objectHeaders(object);
  headers.set("content-length", String(object.size));
  return new Response(object.body, { status: 200, headers });
}

/**
 * R2 바인딩 기반 미디어 스트리밍 라우트 (HTTP Range 및 Partial Content 지원).
 * 로컬 개발(Miniflare) 및 커스텀 도메인 미연결 환경에서도 R2 비디오 직접 재생 보장.
 *
 * 배경은 모두 누구에게나 보이는 기본 제공 배경이라 인증 없이 서빙한다. 여기서
 * 세션을 검사하면 송출 중 세션이 만료되는 순간 배경이 꺼진다 — 예배 화면이 검게
 * 되는 쪽이 더 큰 사고다.
 *
 * Range는 R2에 그대로 넘기지 않고 직접 검증한다. 만족할 수 없는 범위는 R2가
 * InvalidRange로 던져 500이 되므로 416으로 답하고, 깨진 헤더는 무시하고 200으로 답한다.
 * 그래서 Range 요청마다 크기를 알기 위한 HEAD가 한 번 더 나간다. R2 오류 코드에 기대
 * 범위를 추측하는 대신 왕복 한 번을 감수한 의도된 비용이다. 두 호출 사이에 객체가
 * 바뀌면 HEAD로 검증한 범위가 새 객체에 맞지 않으므로, GET에 etag 조건을 걸어
 * 어긋나면 Range를 무시하고 새 객체 전체를 200으로 보낸다.
 */
export function createMediaRoute() {
  return new Hono<AppEnv>().get("/*", async (c) => {
    const key = c.req.path.slice(`${basePath(c)}/`.length);
    if (!key) {
      return c.json({ error: API_ERRORS.media.keyRequired }, 400);
    }

    const rangeHeader = c.req.header("range");
    const requested = rangeHeader ? parseRangeHeader(rangeHeader) : null;

    if (!requested) {
      return serveWholeObject(c, key);
    }

    const head = await c.env.MEDIA_BUCKET.head(key);
    if (!head) {
      return mediaNotFound(c);
    }

    const resolved = resolveByteRange(requested, head.size);
    if (!resolved) {
      return new Response(null, {
        status: 416,
        headers: {
          "content-range": `bytes */${head.size}`,
          "accept-ranges": "bytes",
        },
      });
    }

    const length = resolved.end - resolved.start + 1;
    const object = await c.env.MEDIA_BUCKET.get(key, {
      range: { offset: resolved.start, length },
      onlyIf: { etagMatches: head.etag },
    });
    if (!object) {
      return mediaNotFound(c);
    }
    if (!("body" in object)) {
      return serveWholeObject(c, key);
    }

    const headers = objectHeaders(object);
    headers.set(
      "content-range",
      `bytes ${resolved.start}-${resolved.end}/${head.size}`,
    );
    headers.set("content-length", String(length));
    return new Response(object.body, { status: 206, headers });
  });
}
