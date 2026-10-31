import { Hono, type Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  API_ERRORS,
  LyricsSearchQuerySchema,
  LyricsSongQuerySchema,
  type LyricsSongResponse,
} from "#shared";
import type { AppEnv } from "../types";
import { resolveRequireAuth, type AppDeps } from "../deps";
import { CLOUD_TRACE_LOG_FIELD } from "../lib/cloudTrace";
import {
  GasazipUnavailableError,
  fetchGasazipSong,
  searchGasazip,
} from "../lib/gasazip";
import { rankLyricsCandidates } from "../lib/lyricsCandidates";
import { createFixedWindowLimiter } from "../lib/rateLimit";
import { describeError, writeLog } from "../lib/requestLog";
import { limitPerClientIp } from "../middleware/rateLimit";

const SEARCHES_PER_WINDOW = 30;
const SONGS_PER_WINDOW = 60;
const OUTBOUND_PER_WINDOW = 120;
const WINDOW_MS = 60_000;
const CACHE_SECONDS = 3600;
const OUTBOUND_KEY = "gasazip";

/**
 * gasazip.com에서 가사를 불러오는 API.
 *
 * 사용자가 누르는 순간에만 부르고 결과를 저장하지 않는다. 가져온 가사는 클라이언트가 새 곡 입력
 * 폼에 채울 뿐이라, 사용자가 확인하고 저장해야 보관함에 들어간다.
 *
 * 외부 사이트에 부담을 주지 않도록 IP마다의 한도와 별개로, 이 인스턴스가 gasazip으로 내보내는
 * 요청 전체도 1분에 120건으로 묶는다. 한도를 넘으면 429로 끊는다. 인스턴스마다 따로 세는 최선
 * 노력 방어다.
 */
export function createLyricsRoute(deps: AppDeps = {}) {
  const requireAuth = resolveRequireAuth(deps);
  const takeOutbound = createFixedWindowLimiter({
    limit: OUTBOUND_PER_WINDOW,
    windowMs: WINDOW_MS,
  });
  const searchRateLimit = limitPerClientIp({
    limit: SEARCHES_PER_WINDOW,
    windowMs: WINDOW_MS,
  });
  const songRateLimit = limitPerClientIp({
    limit: SONGS_PER_WINDOW,
    windowMs: WINDOW_MS,
  });

  const outboundBlocked = (): Response | null => {
    const decision = takeOutbound(OUTBOUND_KEY);
    if (decision.allowed) return null;
    return Response.json(
      { error: API_ERRORS.tooManyRequests },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(decision.retryAfterMs / 1000)),
        },
      },
    );
  };

  const logUnavailable = (
    c: Context<AppEnv>,
    event: string,
    error: unknown,
  ): void =>
    writeLog("WARNING", {
      event,
      requestId: c.get("requestId"),
      [CLOUD_TRACE_LOG_FIELD]: c.get("logTrace"),
      error: describeError(error),
    });

  return new Hono<AppEnv>()
    .get(
      "/search",
      requireAuth,
      searchRateLimit,
      zValidator("query", LyricsSearchQuerySchema),
      async (c) => {
        const { title, artist } = c.req.valid("query");
        const blocked = outboundBlocked();
        if (blocked) return blocked;

        try {
          const rows = await searchGasazip(title);
          const candidates = rankLyricsCandidates(rows, { title, artist });
          c.header("cache-control", `private, max-age=${CACHE_SECONDS}`);
          return c.json({ candidates }, 200);
        } catch (error) {
          if (!(error instanceof GasazipUnavailableError)) throw error;
          logUnavailable(c, "lyrics_search_unavailable", error);
          return c.json({ error: API_ERRORS.lyrics.unavailable }, 502);
        }
      },
    )
    .get(
      "/song",
      requireAuth,
      songRateLimit,
      zValidator("query", LyricsSongQuerySchema),
      async (c) => {
        const { ids } = c.req.valid("query");

        try {
          for (const id of ids) {
            const blocked = outboundBlocked();
            if (blocked) return blocked;
            const song = await fetchGasazipSong(id);
            if (!song?.lyrics) continue;
            const body: LyricsSongResponse = {
              title: song.title,
              artist: song.artist,
              lyrics: song.lyrics,
            };
            c.header("cache-control", `private, max-age=${CACHE_SECONDS}`);
            return c.json(body, 200);
          }
        } catch (error) {
          if (!(error instanceof GasazipUnavailableError)) throw error;
          logUnavailable(c, "lyrics_song_unavailable", error);
          return c.json({ error: API_ERRORS.lyrics.unavailable }, 502);
        }
        return c.json({ error: API_ERRORS.lyrics.empty }, 404);
      },
    );
}
