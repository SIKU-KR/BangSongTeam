import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { SearchCatalogQuerySchema } from "@repo/shared";
import {
  createD1Client,
  getPublicDeckDetail,
  searchPublicDecks,
  toPublicDeckSummary,
} from "@repo/db";
import type { AppEnv } from "../types";
import { resolveRequireAuth, type AppDeps } from "../deps";

/** 공개 검색 응답 캐시 수명. 새로 공개한 곡이 이만큼 늦게 보일 수 있다 */
const SEARCH_CACHE_SECONDS = 30;

/**
 * 공유 라이브러리(공개 덱) API (PRD 4.7).
 *
 * 같은 곡이 여러 번 공개돼도 그대로 보여 주는 게시판이다. 가져간 횟수순으로 정렬한다.
 * 검색만 로그인 없이 열린다. 그래서 검색 응답은 로그인 여부와 무관하게 첫 슬라이드
 * 미리보기만 담는다. 전문은 로그인 후 상세 조회로만 준다.
 */
export function createCatalogRoute(deps: AppDeps = {}) {
  const requireAuth = resolveRequireAuth(deps);

  return (
    new Hono<AppEnv>()
      .get(
        "/search",
        zValidator("query", SearchCatalogQuerySchema),
        async (c) => {
          const { q, limit } = c.req.valid("query");
          const db = createD1Client(c.env.DB);

          const deckRows = await searchPublicDecks(db, q, limit);

          c.header("cache-control", `public, max-age=${SEARCH_CACHE_SECONDS}`);
          return c.json(
            {
              decks: deckRows.map((row) =>
                toPublicDeckSummary(row.deck, row.authorName),
              ),
            },
            200,
          );
        },
      )
      // 공개 덱 전문 (편집기 곡 추가 모달의 가사 전문 미리보기, PRD 4.7)
      .get("/decks/:id", requireAuth, async (c) => {
        const db = createD1Client(c.env.DB);
        const detail = await getPublicDeckDetail(db, c.req.param("id"));
        if (!detail) {
          return c.json({ error: "공개된 곡을 찾을 수 없습니다" }, 404);
        }
        return c.json({ deck: detail }, 200);
      })
  );
}
