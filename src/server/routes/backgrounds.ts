import { Hono } from "hono";
import { listBackgrounds } from "#db";
import type { AppEnv } from "../types";

/**
 * 배경 갤러리 API.
 *
 * 목록은 로그인 없이 열리고 모두에게 같다(기본 제공 배경). 검색은 클라이언트가 이 목록의
 * 제목·설명·키워드로 한다. 등록과 정리는 `scripts/importBackgrounds.mjs`로만 한다. 배경
 * 영상은 최대 수백 MB라 API 요청 본문으로 받지 않는다.
 */
export function createBackgroundsRoute() {
  return new Hono<AppEnv>().get("/", async (c) => {
    const backgrounds = await listBackgrounds(c.env.DB);

    c.header("cache-control", "private, no-cache");
    return c.json({ backgrounds }, 200);
  });
}
