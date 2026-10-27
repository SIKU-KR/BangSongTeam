import { Hono } from "hono";
import type { BackgroundMedia } from "#shared";
import { listBackgrounds, type Db } from "#db";
import type { AppEnv } from "../types";

const LIST_CACHE_MS = 30_000;

interface CachedList {
  at: number;
  list: Promise<BackgroundMedia[]>;
}

/**
 * 배경 갤러리 API.
 *
 * 목록은 로그인 없이 열리고 모두에게 같다(기본 제공 배경). 검색은 클라이언트가 이 목록의
 * 제목·설명·키워드로 한다. 등록과 정리는 `scripts/importBackgrounds.mjs`로만 한다. 배경
 * 영상은 최대 수백 MB라 API 요청 본문으로 받지 않는다.
 *
 * 목록은 인스턴스 메모리에 30초 동안 두고 같이 쓴다. 로그인 없이 부를 수 있는 경로가 요청마다
 * 배경 문서를 모두 읽으면 요청 수만큼 읽기 비용이 늘고, IP별 빈도 제한은 run.app에 직접 보낸
 * 요청이 IP를 바꿔 피할 수 있다. 배경은 스크립트로만 바뀌므로 바꾼 뒤 30초까지 이전 목록이
 * 보여도 된다. 읽지 못한 목록은 두지 않아 다음 요청이 다시 읽는다.
 */
export function createBackgroundsRoute(options: { now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  let cached: CachedList | null = null;

  const listCached = (db: Db): Promise<BackgroundMedia[]> => {
    const at = now();
    if (cached && at - cached.at < LIST_CACHE_MS) return cached.list;
    const entry: CachedList = { at, list: listBackgrounds(db) };
    cached = entry;
    entry.list.catch(() => {
      if (cached === entry) cached = null;
    });
    return entry.list;
  };

  return new Hono<AppEnv>().get("/", async (c) => {
    const backgrounds = await listCached(c.env.DB);

    c.header("cache-control", "private, no-cache");
    return c.json({ backgrounds }, 200);
  });
}
