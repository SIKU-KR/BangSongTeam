import { Hono } from "hono";
import type { AppEnv } from "../types";

const IMMUTABLE_MEDIA_CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * R2 바인딩 기반 미디어 스트리밍 라우트 (HTTP Range 및 Partial Content 지원).
 * 로컬 개발(Miniflare) 및 커스텀 도메인 미연결 환경에서도 R2 비디오 직접 재생 보장.
 *
 * 배경은 모두 누구에게나 보이는 기본 제공 배경이라 인증 없이 서빙한다. 여기서
 * 세션을 검사하면 송출 중 세션이 만료되는 순간 배경이 꺼진다 — 예배 화면이 검게
 * 되는 쪽이 더 큰 사고다.
 */
export const mediaRoute = new Hono<AppEnv>().get("/*", async (c) => {
  const key = c.req.path.replace(/^\/api\/media\/?/, "");
  if (!key) {
    return c.json({ error: "Media key is required" }, 400);
  }

  const rangeHeader = c.req.header("range");
  const getOptions: R2GetOptions = rangeHeader
    ? { range: c.req.raw.headers }
    : {};

  const object = await c.env.MEDIA_BUCKET.get(key, getOptions);
  if (!object) {
    return c.json({ error: "Media not found" }, 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", IMMUTABLE_MEDIA_CACHE_CONTROL);

  if (rangeHeader && "range" in object && object.range) {
    const range = object.range;
    let start = 0;
    let end = object.size - 1;

    if ("suffix" in range) {
      start = Math.max(0, object.size - range.suffix);
      end = object.size - 1;
    } else {
      start = range.offset ?? 0;
      end =
        range.length !== undefined ? start + range.length - 1 : object.size - 1;
    }

    const contentLength = end - start + 1;
    headers.set("content-range", `bytes ${start}-${end}/${object.size}`);
    headers.set("content-length", String(contentLength));
    return new Response(object.body, {
      status: 206,
      headers,
    });
  }

  headers.set("content-length", String(object.size));
  return new Response(object.body, {
    status: 200,
    headers,
  });
});

export default mediaRoute;
