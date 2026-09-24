import type { Presentation } from "@repo/shared";

export interface MergeResult {
  documents: Presentation[];
  needsPush: string[];
}

/**
 * 문서 단위 Last-Write-Wins 병합.
 *
 * 필드 단위로 섞지 않는 이유: 곡 순서는 서버 것, 스타일은 로컬 것이 되면
 * 사용자가 만든 적 없는 세트가 나온다. 문서 하나를 통째로 고른다.
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

  for (const localDoc of local) {
    const serverDoc = byId.get(localDoc.id);

    if (!serverDoc) {
      byId.set(localDoc.id, localDoc);
      needsPush.push(localDoc.id);
      continue;
    }

    if (localDoc.updatedAt > serverDoc.updatedAt) {
      byId.set(localDoc.id, localDoc);
      needsPush.push(localDoc.id);
    }
  }

  const documents = [...byId.values()].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );

  return { documents, needsPush };
}
