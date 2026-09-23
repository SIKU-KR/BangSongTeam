import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  CatalogCandidatesQuerySchema,
  SearchCatalogQuerySchema,
} from "@repo/shared";
import {
  createD1Client,
  getCatalogCandidates,
  getPublicDeckDetail,
  importCatalogLyrics,
  searchCatalog,
  searchPublicDecks,
  toCatalogLyricSummary,
  toPublicDeckSummary,
} from "@repo/db";
import type { AppEnv } from "../types";
import { resolveRequireAuth, type AppDeps } from "../deps";

/** 공개 검색 응답 캐시 수명. 새로 공개한 곡이 이만큼 늦게 보일 수 있다 */
const SEARCH_CACHE_SECONDS = 30;

/**
 * 공유 라이브러리(공개 덱)·가사 라이브러리 API (PRD 4.7·4.8).
 *
 * 검색만 로그인 없이 열린다. 그래서 검색 응답은 로그인 여부와 무관하게 미리보기
 * (첫 슬라이드 / 첫 2줄)만 담는다. 전문은 로그인 후 상세 조회로만 준다.
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

          const [deckRows, catalogRows] = await Promise.all([
            searchPublicDecks(db, q, limit),
            searchCatalog(db, q, limit),
          ]);

          c.header("cache-control", `public, max-age=${SEARCH_CACHE_SECONDS}`);
          return c.json(
            {
              decks: deckRows.map((row) =>
                toPublicDeckSummary(row.deck, row.authorName),
              ),
              catalogLyrics: catalogRows.map(toCatalogLyricSummary),
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
      // '이 곡이 맞나요?' 후보 (PRD 4.8 곡 식별)
      .get(
        "/candidates",
        requireAuth,
        zValidator("query", CatalogCandidatesQuerySchema),
        async (c) => {
          const { title, artist } = c.req.valid("query");
          const db = createD1Client(c.env.DB);
          return c.json(
            { candidates: await getCatalogCandidates(db, title, artist) },
            200,
          );
        },
      )
      // 대표 가사로 내 보관함에 곡 만들기
      .post("/lyrics/:id/import", requireAuth, async (c) => {
        const db = createD1Client(c.env.DB);
        const result = await importCatalogLyrics(
          db,
          c.get("userId") as string,
          c.req.param("id"),
        );
        if (result.status === "not_found") {
          return c.json(
            { error: "가사 라이브러리에서 곡을 찾을 수 없습니다" },
            404,
          );
        }
        return c.json(
          { deck: result.deck, alreadyOwned: result.alreadyOwned },
          200,
        );
      })
  );
}
