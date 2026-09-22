import type { Presentation } from "@repo/shared";

export interface MergeResult {
  /** 병합된 최종 문서 목록 */
  documents: Presentation[];
  /** 서버에 올려야 하는 문서 id (로컬이 더 최신이거나 서버에 없음) */
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
      // 서버에 없다 — 아직 안 올라간 문서다. 지우지 않고 올린다.
      byId.set(localDoc.id, localDoc);
      needsPush.push(localDoc.id);
      continue;
    }

    if (localDoc.updatedAt > serverDoc.updatedAt) {
      byId.set(localDoc.id, localDoc);
      needsPush.push(localDoc.id);
    }
    // 서버가 같거나 더 최신이면 서버 것을 쓴다 (이미 map에 들어 있다)
  }

  const documents = [...byId.values()].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );

  return { documents, needsPush };
}
