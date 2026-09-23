import { Hono } from "hono";
import type { AppEnv } from "../types";

/**
 * R2 바인딩 기반 미디어 스트리밍 라우트 (HTTP Range 및 Partial Content 지원)
 * 로컬 개발(Miniflare) 및 커스텀 도메인 미연결 환경에서도 R2 비디오 직접 재생 보장
 */
/** 1년 만료 + immutable. 배경 영상 키는 내용이 바뀌면 키 자체가 바뀐다. */
const IMMUTABLE_MEDIA_CACHE_CONTROL = "public, max-age=31536000, immutable";

export const mediaRoute = new Hono<AppEnv>().get("/*", async (c) => {
  const key = c.req.path.replace(/^\/api\/media\/?/, "");
  if (!key) {
    return c.json({ error: "Media key is required" }, 400);
  }

  // Range 헤더 추출
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
  // R2 키는 불변 자산이다. Service Worker(CacheFirst)와 브라우저 HTTP 캐시가
  // 재검증 없이 재사용할 수 있어야 예배 중 네트워크 요청이 0건이 된다
  // (TECH_SPEC 5.4-1).
  headers.set("cache-control", IMMUTABLE_MEDIA_CACHE_CONTROL);

  // Partial Content (206) 처리 (클라이언트가 Range 헤더를 전송한 경우)
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
