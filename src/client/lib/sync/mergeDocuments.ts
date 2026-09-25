import type { Presentation } from "#shared";

export interface MergeResult {
  documents: Presentation[];
  needsPush: string[];
  /** 서버 목록에서 빠진 공유 세트 (공유 해제·링크 재설정·원본 삭제) */
  removed: string[];
}

/**
 * 문서 단위 Last-Write-Wins 병합.
 *
 * 필드 단위로 섞지 않는 이유: 곡 순서는 서버 것, 스타일은 로컬 것이 되면
 * 사용자가 만든 적 없는 세트가 나온다. 문서 하나를 통째로 고른다.
 *
 * 공유받은 세트(`access`)는 보기 전용이라 언제나 서버본을 쓰고 올리지 않는다.
 * 서버 목록에 없으면 공유가 끝난 것이므로 지운다.
 */
export function mergeDocuments(
  local: Presentation[],
  server: Presentation[],
): MergeResult {
  const byId = new Map<string, Presentation>();
  const needsPush: string[] = [];

  for (const doc of server) {
    byId.set(doc.id, doc);
  }

  const removed: string[] = [];

  for (const localDoc of local) {
    const serverDoc = byId.get(localDoc.id);

    if (!serverDoc) {
      if (localDoc.access) {
        removed.push(localDoc.id);
        continue;
      }
      byId.set(localDoc.id, localDoc);
      needsPush.push(localDoc.id);
      continue;
    }

    if (!serverDoc.access && localDoc.updatedAt > serverDoc.updatedAt) {
      byId.set(localDoc.id, localDoc);
      needsPush.push(localDoc.id);
    }
  }

  const documents = [...byId.values()].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );

  return { documents, needsPush, removed };
}
