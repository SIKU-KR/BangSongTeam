import { Hono } from "hono";
import { createD1Client, listBackgrounds } from "#db";
import type { AppEnv } from "../types";

const LIST_CACHE_SECONDS = 60 * 60;

/**
 * 배경 갤러리 API.
 *
 * 목록은 로그인 없이 열리고 모두에게 같다(기본 제공 배경). 목록만 내보낸다.
 * 등록과 정리는 `scripts/importBackgrounds.mjs`로만 한다. 배경 영상은 최대
 * 수백 MB라 Worker 요청 본문 한도를 넘는다.
 *
 * 목록은 등록 스크립트를 돌릴 때만 바뀌어 브라우저가 한 시간 캐시한다. 그동안
 * 지워진 배경이 목록에 남아 골라도 덱 트리거가 모르는 배경 id를 비운다.
 */
export function createBackgroundsRoute() {
  return new Hono<AppEnv>().get("/", async (c) => {
    const backgrounds = await listBackgrounds(createD1Client(c.env.DB));

    c.header("cache-control", `public, max-age=${LIST_CACHE_SECONDS}`);
    return c.json({ backgrounds }, 200);
  });
}
