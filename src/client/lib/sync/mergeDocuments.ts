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

export interface BootMergePlan {
  documents: Presentation[];
  needsPush: string[];
  /** 로컬 저장소에서 지울 프레젠테이션 (로컬에 있던 것만) */
  removedIds: string[];
}

/**
 * 부팅 동기화에서 로컬 프레젠테이션과 서버 프레젠테이션을 맞춘 결과를 계산한다.
 *
 * - 서버 삭제 기록(`deletedIds`)에 있는 프레젠테이션은 다른 기기에서 영구 삭제된
 *   것이라 병합에서 빼고 지운다.
 * - 서버 목록에서 빠진 공유받은 프레젠테이션은 서버를 받기 전부터 알던 것
 *   (`knownBeforePull`)만 지운다. 받는 사이에 새로 들어온 공유받은 프레젠테이션은
 *   그보다 앞선 서버 목록에 없을 뿐이라 그대로 둔다.
 */
export function planBootMerge(
  local: Presentation[],
  server: Presentation[],
  deletedIds: readonly string[],
  knownBeforePull: ReadonlySet<string>,
): BootMergePlan {
  const deleted = new Set(deletedIds);
  const merged = mergeDocuments(
    local.filter((doc) => !deleted.has(doc.id)),
    server,
  );
  const joinedDuringPull = local.filter(
    (doc) => merged.removed.includes(doc.id) && !knownBeforePull.has(doc.id),
  );
  const removed = merged.removed.filter((id) => knownBeforePull.has(id));

  return {
    documents: [...merged.documents, ...joinedDuringPull],
    needsPush: merged.needsPush,
    removedIds: [...deleted, ...removed].filter((id) =>
      local.some((doc) => doc.id === id),
    ),
  };
}
