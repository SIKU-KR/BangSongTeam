import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { API_ERRORS, SearchCatalogQuerySchema } from "#shared";
import { getPublicDeckDetail, searchPublicDecks } from "#db";
import type { AppEnv } from "../types";
import { resolveRequireAuth, type AppDeps } from "../deps";
import { CLOUD_TRACE_LOG_FIELD } from "../lib/cloudTrace";
import { idParam } from "../lib/params";
import { describeError, writeLog } from "../lib/requestLog";
import { limitPerClientIp } from "../middleware/rateLimit";

const SEARCH_CACHE_SECONDS = 30;
const SEARCHES_PER_WINDOW = 120;
const SEARCH_WINDOW_MS = 60_000;

/**
 * 공유 라이브러리(공개 덱) API.
 *
 * 같은 곡이 여러 번 공개돼도 그대로 보여 주는 게시판이다. 가져간 횟수순으로 정렬한다.
 * 검색만 로그인 없이 열린다. 그래서 검색 응답은 로그인 여부와 무관하게 첫 슬라이드
 * 미리보기만 담는다. 전문은 로그인 후 상세 조회로만 준다.
 *
 * 검색 한 번은 곡 문서를 수백 개까지 읽으므로(`searchPublicDecks`) IP마다 1분에 120번까지만
 * 받는다. 곡 선택 창은 입력을 멈출 때마다 검색하는데, 교회 한 곳의 여러 사람이 같은 IP로
 * 검색해도 모자라지 않은 한도다.
 */
export function createCatalogRoute(deps: AppDeps = {}) {
  const requireAuth = resolveRequireAuth(deps);
  const publicDeckId = idParam(API_ERRORS.deck.notPublished, 404);
  const searchRateLimit = limitPerClientIp({
    limit: SEARCHES_PER_WINDOW,
    windowMs: SEARCH_WINDOW_MS,
  });

  return new Hono<AppEnv>()
    .get(
      "/search",
      searchRateLimit,
      zValidator("query", SearchCatalogQuerySchema),
      async (c) => {
        const { q, limit } = c.req.valid("query");
        const db = c.env.DB;

        const decks = await searchPublicDecks(db, q, limit, {
          onCountError: (error) =>
            writeLog("WARNING", {
              event: "catalog_search_count_failed",
              requestId: c.get("requestId"),
              [CLOUD_TRACE_LOG_FIELD]: c.get("logTrace"),
              error: describeError(error),
            }),
        });

        c.header("cache-control", `public, max-age=${SEARCH_CACHE_SECONDS}`);
        return c.json({ decks }, 200);
      },
    )
    .get("/decks/:id", requireAuth, publicDeckId, async (c) => {
      const db = c.env.DB;
      const detail = await getPublicDeckDetail(db, c.req.param("id"));
      if (!detail) {
        return c.json({ error: API_ERRORS.deck.notPublished }, 404);
      }
      return c.json({ deck: detail }, 200);
    });
}
