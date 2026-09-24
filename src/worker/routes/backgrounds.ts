import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { createD1Client, getBackgrounds } from "#db";
import {
  BackgroundsQuerySchema,
  hangulIncludes,
  type BackgroundMedia,
  type BackgroundsQuery,
} from "#shared";
import type { AppEnv } from "../types";

/**
 * R2 커스텀 도메인 기반 직통 CDN URL 및 포스터 이미지 URL 조합 유틸리티
 */
export function buildMediaUrls(
  r2Key: string,
  posterKey: string,
  rawDomain?: string,
): { cdnUrl: string; posterUrl: string } {
  const domain = (rawDomain || "media.worship-slide.com")
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  return {
    cdnUrl: `https://${domain}/${r2Key.replace(/^\/+/, "")}`,
    posterUrl: `https://${domain}/${posterKey.replace(/^\/+/, "")}`,
  };
}

/**
 * 제목(초성/자모 검색 지원)·태그·개수 필터를 순서대로 적용한다.
 */
export function filterBackgrounds(
  list: BackgroundMedia[],
  { q, tag, limit }: BackgroundsQuery,
): BackgroundMedia[] {
  let result = list;
  if (q) result = result.filter((bg) => hangulIncludes(bg.title, q));
  if (tag) result = result.filter((bg) => bg.tags.includes(tag));
  return limit ? result.slice(0, limit) : result;
}

const backgroundsRoute = new Hono<AppEnv>().get(
  "/",
  zValidator("query", BackgroundsQuerySchema),
  async (c) => {
    const query = c.req.valid("query");
    const db = createD1Client(c.env.DB);
    const rows = await getBackgrounds(db);

    const mediaList: BackgroundMedia[] = rows.map((row) => {
      const { cdnUrl, posterUrl } = buildMediaUrls(
        row.r2Key,
        row.posterKey,
        c.env.R2_PUBLIC_DOMAIN,
      );

      let parsedTags: string[] = [];
      try {
        parsedTags = JSON.parse(row.tags);
      } catch {
        parsedTags = [];
      }

      return {
        id: row.id,
        title: row.title,
        r2Key: row.r2Key,
        posterKey: row.posterKey,
        durationSec: row.durationSec,
        license: row.license,
        tags: parsedTags,
        cdnUrl,
        posterUrl,
      };
    });

    return c.json(filterBackgrounds(mediaList, query), 200);
  },
);

export { backgroundsRoute };
export default backgroundsRoute;
