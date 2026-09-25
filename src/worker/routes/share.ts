import { Hono } from "hono";
import { createD1Client, joinByToken } from "#db";
import type { AppEnv } from "../types";
import { resolveRequireAuth, type AppDeps } from "../deps";

/**
 * 공유 링크(`/s/:token`)로 세트에 들어온다.
 *
 * 가사 전문이 담긴 세트라 로그인한 사용자만 받는다. 미인증 노출은 첫 슬라이드로
 * 제한한다는 저작권 정책(TECH_SPEC 공개 카탈로그 절)을 따른다.
 */
export function createShareRoute(deps: AppDeps = {}) {
  return new Hono<AppEnv>()
    .use("*", resolveRequireAuth(deps))
    .post("/:token/join", async (c) => {
      const result = await joinByToken(
        createD1Client(c.env.DB),
        c.req.param("token"),
        c.get("userId") as string,
      );
      if (!result) {
        return c.json(
          { error: "링크가 만료되었거나 공유가 해제되었습니다" },
          404,
        );
      }
      return c.json(result, 200);
    });
}
