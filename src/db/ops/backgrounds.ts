import type { Db } from "../client";
import { backgroundsCol, decksCol, type BackgroundDoc } from "../collections";

/**
 * 기본 제공 배경 운영 작업. `scripts/importBackgrounds.mjs`가 쓴다.
 *
 * 등록 전에 GCS 객체(영상·포스터)를 반드시 먼저 올린다. 파일 없는 문서는 편집기·송출에서
 * 깨진 배경이 된다. 삭제는 거꾸로 문서를 먼저 지우고 GCS 객체를 나중에 지운다.
 */

export type NewBackground = Omit<
  BackgroundDoc,
  "createdAt" | "kind" | "license"
> &
  Partial<Pick<BackgroundDoc, "kind" | "license">>;

/** Firestore `ALREADY_EXISTS` 상태 번호 */
const ALREADY_EXISTS = 6;

/** 배경을 등록한다. 같은 id가 이미 있으면 덮어쓰지 않고 false를 돌린다 */
export async function registerBackground(
  db: Db,
  background: NewBackground,
  now: Date = new Date(),
): Promise<boolean> {
  try {
    await backgroundsCol(db)
      .doc(background.id)
      .create({
        kind: "video",
        license: "",
        ...background,
        keywords: [...new Set(background.keywords)],
        createdAt: now,
      });
    return true;
  } catch (error) {
    if ((error as { code?: number }).code === ALREADY_EXISTS) return false;
    throw error;
  }
}

/** 제목·설명·키워드만 고친다. 파일 키와 크기는 그대로 둔다 */
export async function updateBackgroundMetadata(
  db: Db,
  id: string,
  metadata: Pick<BackgroundDoc, "title" | "description" | "keywords">,
): Promise<void> {
  await backgroundsCol(db)
    .doc(id)
    .update({
      title: metadata.title,
      description: metadata.description,
      keywords: [...new Set(metadata.keywords)],
    });
}

/** 등록된 배경과 파일 키 (제목순) */
export async function listBackgroundFiles(
  db: Db,
): Promise<Pick<BackgroundDoc, "id" | "title" | "mediaKey" | "posterKey">[]> {
  const snapshot = await backgroundsCol(db).get();
  return snapshot.docs
    .map((doc) => {
      const { id, title, mediaKey, posterKey } = doc.data();
      return { id, title, mediaKey, posterKey };
    })
    .sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
}

/** 배경마다 쓰는 곡 수 (보관함 곡과 프레젠테이션 사본 모두). 쓰는 배경만 담는다 */
export async function countDecksByBackground(
  db: Db,
  ids: readonly string[],
): Promise<Map<string, number>> {
  const counts = await Promise.all(
    ids.map(async (id) => {
      const snapshot = await decksCol(db)
        .where("backgroundId", "==", id)
        .count()
        .get();
      return [id, snapshot.data().count] as const;
    }),
  );
  return new Map(counts.filter(([, count]) => count > 0));
}

/**
 * 배경을 지운다. 쓰던 곡은 같은 트랜잭션에서 '배경 없음'이 되고, 그렇게 바꾼 곡 id를 돌려준다.
 *
 * 같은 id로 다시 등록해도 곡은 배경을 되찾지 않는다. 실수로 지웠을 때 어느 곡을 되돌려야 하는지
 * 알 수 있게 부르는 쪽이 돌려받은 id를 남긴다(`scripts/importBackgrounds.mjs`).
 */
export async function deleteBackground(db: Db, id: string): Promise<string[]> {
  return db.runTransaction(async (tx) => {
    const users = await tx.get(decksCol(db).where("backgroundId", "==", id));
    for (const deck of users.docs) tx.update(deck.ref, { backgroundId: null });
    tx.delete(backgroundsCol(db).doc(id));
    return users.docs.map((deck) => deck.id);
  });
}
