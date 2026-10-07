import { BackgroundMediaSchema, type BackgroundMedia } from "#shared";
import { getOfflineDB } from "./db";

/**
 * 배경 카탈로그의 로컬 사본.
 *
 * 송출 화면은 서버에 묻지 않고 이 사본만으로 배경 id를 영상 URL로 바꾼다.
 * 형식이 맞지 않는 행은 조용히 버린다 — 다음 동기화가 다시 채운다.
 */
export async function loadAllBackgrounds(): Promise<BackgroundMedia[]> {
  const db = await getOfflineDB();
  const rows = await db.getAll("backgrounds");
  return rows.flatMap((row) => {
    const parsed = BackgroundMediaSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

/** 서버 목록으로 통째로 바꾼다. 지워진 배경이 로컬에 남지 않게 한다 */
export async function replaceAllBackgrounds(
  backgrounds: readonly BackgroundMedia[],
): Promise<void> {
  const db = await getOfflineDB();
  const tx = db.transaction("backgrounds", "readwrite");
  await tx.store.clear();
  for (const background of backgrounds) {
    await tx.store.put(background);
  }
  await tx.done;
}
