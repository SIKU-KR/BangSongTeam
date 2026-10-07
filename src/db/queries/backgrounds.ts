import { asc } from "drizzle-orm";
import { mediaUrlForKey, type BackgroundMedia } from "#shared";
import {
  backgroundKeywords,
  backgrounds,
  type Background,
  type BackgroundKeyword,
} from "../schema";
import { runQueries } from "./batch";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbInstance = any;

export function toBackgroundMedia(
  row: Background,
  keywords: string[] = [],
): BackgroundMedia {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    mediaUrl: mediaUrlForKey(row.r2Key),
    posterUrl: mediaUrlForKey(row.posterKey),
    durationSec: row.durationSec,
    sizeBytes: row.sizeBytes,
    license: row.license,
    createdAt: row.createdAt.toISOString(),
    description: row.description,
    keywords,
  };
}

/** 배경 갤러리: 모든 사용자에게 같은 목록을 제목순으로 준다 */
export async function listBackgrounds(
  db: DbInstance,
): Promise<BackgroundMedia[]> {
  const [rows, keywordRows] = (await runQueries(db, [
    db.select().from(backgrounds).orderBy(asc(backgrounds.title)),
    db
      .select()
      .from(backgroundKeywords)
      .orderBy(asc(backgroundKeywords.keyword)),
  ])) as [Background[], BackgroundKeyword[]];

  const keywordsById = new Map<string, string[]>();
  for (const { backgroundId, keyword } of keywordRows) {
    const list = keywordsById.get(backgroundId) ?? [];
    list.push(keyword);
    keywordsById.set(backgroundId, list);
  }
  return rows.map((row) => toBackgroundMedia(row, keywordsById.get(row.id)));
}
