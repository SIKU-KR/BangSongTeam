import { mediaUrlForKey, type BackgroundMedia } from "#shared";
import type { Db } from "../client";
import { backgroundsCol, type BackgroundDoc } from "../collections";

/** 문자열을 코드 포인트 순으로 비교한다 (로캘과 상관없이 늘 같은 순서) */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function toBackgroundMedia(row: BackgroundDoc): BackgroundMedia {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    mediaUrl: mediaUrlForKey(row.mediaKey),
    posterUrl: mediaUrlForKey(row.posterKey),
    durationSec: row.durationSec,
    sizeBytes: row.sizeBytes,
    license: row.license,
    createdAt: row.createdAt.toISOString(),
    description: row.description,
    keywords: [...row.keywords].sort(compareText),
  };
}

/** 배경 갤러리: 모든 사용자에게 같은 목록을 제목순으로 준다 */
export async function listBackgrounds(db: Db): Promise<BackgroundMedia[]> {
  const snapshot = await backgroundsCol(db).get();
  return snapshot.docs
    .map((doc) => doc.data())
    .sort((a, b) => compareText(a.title, b.title) || compareText(a.id, b.id))
    .map(toBackgroundMedia);
}
