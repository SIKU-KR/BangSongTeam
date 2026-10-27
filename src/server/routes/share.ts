import { Hono } from "hono";
import { getSharedDocumentByToken, joinByToken } from "#db";
import type { AppEnv } from "../types";
import { resolveRequireAuth, type AppDeps } from "../deps";
import { API_ERRORS } from "#shared";
import { tokenParam } from "../lib/params";
import { requireConsent } from "../middleware/consent";
import { limitPerClientIp } from "../middleware/rateLimit";

const VIEWS_PER_WINDOW = 60;
const VIEW_WINDOW_MS = 60_000;

/**
 * 공유 링크(`/s/:token`) API.
 *
 * 보기는 로그인 없이 된다(`GET`). 토큰은 소유자가 켠 링크에만 있고 추측할 수
 * 없어, 공개 카탈로그처럼 검색·크롤링으로 전문이 퍼지지 않는다. 멤버 기록과
 * 사본 만들기는 내 계정에 남는 일이라 로그인한 사람만 한다(`POST .../join`).
 *
 * 로그인 없이 보는 요청은 프레젠테이션의 곡을 모두 읽어 보내므로 IP마다 1분에 60번까지만
 * 받는다(429). 링크를 아는 누구나 요청을 몰아 서버 메모리와 전송량을 키우지 못하게 하는
 * 최선 노력 방어이고, 교회 한 곳의 여러 사람이 같은 IP로 링크를 열어도 모자라지 않은 한도다.
 */
export function createShareRoute(deps: AppDeps = {}) {
  const requireAuth = resolveRequireAuth(deps);
  const linkToken = tokenParam(API_ERRORS.share.linkUnavailable);
  const viewRateLimit = limitPerClientIp({
    limit: VIEWS_PER_WINDOW,
    windowMs: VIEW_WINDOW_MS,
  });

  return new Hono<AppEnv>()
    .get("/:token", viewRateLimit, linkToken, async (c) => {
      const document = await getSharedDocumentByToken(
        c.env.DB,
        c.req.param("token"),
      );
      c.header("cache-control", "private, no-store");
      if (!document)
        return c.json({ error: API_ERRORS.share.linkUnavailable }, 404);
      return c.json({ document }, 200);
    })
    .post("/:token/join", requireAuth, linkToken, requireConsent, async (c) => {
      const result = await joinByToken(
        c.env.DB,
        c.req.param("token"),
        c.get("userId") as string,
      );
      if (!result)
        return c.json({ error: API_ERRORS.share.linkUnavailable }, 404);
      return c.json(result, 200);
    });
}
