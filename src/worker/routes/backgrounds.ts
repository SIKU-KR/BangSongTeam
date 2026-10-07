import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { API_ERRORS, SearchBackgroundsQuerySchema } from "#shared";
import { createD1Client, listBackgrounds } from "#db";
import type { AppEnv } from "../types";
import type { AppDeps } from "../deps";
import { searchBackgroundsWithVectorize } from "../lib/backgroundSearch";
import { logServerError } from "../lib/requestLog";

const SEARCH_CACHE_SECONDS = 300;

/**
 * 배경 갤러리 API.
 *
 * 목록과 검색은 로그인 없이 열리고 모두에게 같다(기본 제공 배경). 등록과 정리는
 * `scripts/importBackgrounds.mjs`로만 한다. 배경 영상은 최대 수백 MB라 Worker 요청
 * 본문 한도를 넘는다.
 *
 * 검색은 Workers AI·Vectorize로 하는 벡터 검색이라 같은 검색어의 결과를 공유 캐시에
 * 둔다. 둘 중 하나라도 실패하면(로컬에서 원격 바인딩을 끈 경우 포함) 503을 준다.
 */
export function createBackgroundsRoute(deps: AppDeps = {}) {
  const searchBackgrounds =
    deps.searchBackgrounds ?? searchBackgroundsWithVectorize;

  return new Hono<AppEnv>()
    .get("/", async (c) => {
      const backgrounds = await listBackgrounds(createD1Client(c.env.DB));

      c.header("cache-control", "private, no-cache");
      return c.json({ backgrounds }, 200);
    })
    .get(
      "/search",
      zValidator("query", SearchBackgroundsQuerySchema),
      async (c) => {
        const { q } = c.req.valid("query");
        try {
          const results = await searchBackgrounds(c.env, q);
          c.header("cache-control", `public, max-age=${SEARCH_CACHE_SECONDS}`);
          return c.json({ results }, 200);
        } catch (error) {
          logServerError(c, "background_search_failed", error, {
            queryLength: q.length,
          });
          return c.json({ error: API_ERRORS.media.searchUnavailable }, 503);
        }
      },
    );
}
