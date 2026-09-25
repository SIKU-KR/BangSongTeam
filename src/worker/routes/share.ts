import { Hono } from "hono";
import { createD1Client, getSharedDocumentByToken, joinByToken } from "#db";
import type { AppEnv } from "../types";
import { resolveRequireAuth, type AppDeps } from "../deps";

const LINK_UNAVAILABLE = "링크가 만료되었거나 공유가 해제되었습니다";

/**
 * 공유 링크(`/s/:token`) API.
 *
 * 보기는 로그인 없이 된다(`GET`). 토큰은 소유자가 켠 링크에만 있고 추측할 수
 * 없어, 공개 카탈로그처럼 검색·크롤링으로 전문이 퍼지지 않는다. 멤버 기록과
 * 사본 만들기는 내 계정에 남는 일이라 로그인한 사람만 한다(`POST .../join`).
 */
export function createShareRoute(deps: AppDeps = {}) {
  const requireAuth = resolveRequireAuth(deps);

  return new Hono<AppEnv>()
    .get("/:token", async (c) => {
      const document = await getSharedDocumentByToken(
        createD1Client(c.env.DB),
        c.req.param("token"),
      );
      c.header("cache-control", "private, no-store");
      if (!document) return c.json({ error: LINK_UNAVAILABLE }, 404);
      return c.json({ document }, 200);
    })
    .post("/:token/join", requireAuth, async (c) => {
      const result = await joinByToken(
        createD1Client(c.env.DB),
        c.req.param("token"),
        c.get("userId") as string,
      );
      if (!result) return c.json({ error: LINK_UNAVAILABLE }, 404);
      return c.json(result, 200);
    });
}
