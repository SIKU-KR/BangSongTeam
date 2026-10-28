import type { Presentation } from "#shared";
import {
  hasUnsyncedEdits,
  isSyncedWithServer,
} from "../../features/presentation/presentationDocument";
import { contentFingerprint } from "./presentationLineage";

/**
 * 병합을 부른 쪽. `boot`는 부팅 동기화라 이 기기의 변경을 올릴 목록(`needsPush`)도 돌려준다.
 * `refresh`는 열려 있는 탭이 내 데이터를 다시 받는 것(`refreshOwnDataIfStale`)이라 서버 판을 받기만
 * 하고, 올릴 목록은 늘 비어 있다.
 */
export type MergeMode = "boot" | "refresh";

interface MergeOptions {
  mode?: MergeMode;
  /**
   * 이 탭이 그 세트를 아직 올리지 못했거나(큐에 있음) 저장본과 다를 수 있는지. `refresh`만 본다.
   */
  isQueued?: (id: string) => boolean;
}

interface MergeResult {
  documents: Presentation[];
  needsPush: string[];
  /** 서버 목록에서 빠진 공유 세트 (공유 해제·링크 재설정·원본 삭제) */
  removed: string[];
}

/**
 * 412가 돌려준 서버 판과 이 탭의 지금 판의 관계.
 *
 * - `skip`: 견주지 않는다. 지금 판이 기준 판을 모르는 이전 저장본이거나, 지금 판의 기준 판이
 *   서버 판보다 늦거나 같다(이 탭이 그사이 더 새 판을 받았다).
 * - `same`: 내용이 같다.
 * - `ahead`: 서버 판이 이 탭이 만든 판이다(계보). 그 위에서 고친 지금 판을 다시 보내도 된다.
 * - `behind`: 지금 판은 고친 것이 없고 서버 판이 앞섰다.
 * - `diverged`: 양쪽 다 고쳤다.
 */
export type VersionRelation = "skip" | "same" | "ahead" | "behind" | "diverged";

function timeOf(iso: string): number {
  return Date.parse(iso);
}

/**
 * 412가 돌려준 서버 판과 지금 판의 관계를 정한다(`VersionRelation`). 판은 시각이 아니라 내용
 * 지문으로 견준다.
 *
 * 두 기기가 같은 기준 판 위에서 같은 시각을 찍을 수 있어, 시각이 같다고 같은 판으로 보면 다른
 * 기기의 수정을 이 기기의 저장으로 보고 덮는다. 지문이 같으면 누가 썼든 맞춘 판으로 봐도 잃는
 * 것이 없다. `isAncestor`는 그 지문의 판을 이 탭이 만들었는지(계보에 있는지) 답한다.
 */
export function relateVersions(
  current: Presentation,
  server: Presentation,
  isAncestor: (fingerprint: string) => boolean,
): VersionRelation {
  const base = current.baseUpdatedAt;
  if (base === undefined) return "skip";
  if (base !== null && timeOf(base) >= timeOf(server.updatedAt)) return "skip";
  const serverFingerprint = contentFingerprint(server);
  if (contentFingerprint(current) === serverFingerprint) return "same";
  if (isAncestor(serverFingerprint)) return "ahead";
  if (isSyncedWithServer(current)) return "behind";
  return "diverged";
}

function asSynced(server: Presentation): Presentation {
  return { ...server, baseUpdatedAt: server.updatedAt };
}

function isNewer(a: Presentation, b: Presentation): boolean {
  return timeOf(a.updatedAt) > timeOf(b.updatedAt);
}

function sameContent(a: Presentation, b: Presentation): boolean {
  return contentFingerprint(a) === contentFingerprint(b);
}

interface Choice {
  document: Presentation;
  push: boolean;
}

function keepLocal(local: Presentation): Choice {
  return { document: local, push: false };
}

function isReplaceableOnRefresh(
  doc: Presentation,
  isQueued: (id: string) => boolean,
): boolean {
  return isSyncedWithServer(doc) && !isQueued(doc.id);
}

/**
 * 다시 받기 병합(`refresh`)이 이 내 세트를 그 판(`serverUpdatedAt`)의 서버 판으로 바꾸는지. 서버 판의
 * 내용은 보지 않는다. 그래서 바꾸지 않을 세트는 서버 판을 받지 않아도 병합 결과가 같고, 다시 받기는 그
 * 세트의 곡을 따로 받지 않는다(`pullServerPresentations`의 `keepsLocal`).
 */
export function adoptsOnRefresh(
  local: Presentation,
  serverUpdatedAt: string,
  isQueued: (id: string) => boolean,
): boolean {
  return (
    isReplaceableOnRefresh(local, isQueued) &&
    timeOf(serverUpdatedAt) > timeOf(local.updatedAt)
  );
}

function chooseOwnOnRefresh(
  local: Presentation,
  server: Presentation,
  isQueued: (id: string) => boolean,
): Choice {
  return adoptsOnRefresh(local, server.updatedAt, isQueued)
    ? { document: asSynced(server), push: false }
    : keepLocal(local);
}

function chooseOwn(local: Presentation, server: Presentation): Choice {
  const base = local.baseUpdatedAt;
  if (base === undefined) {
    if (sameContent(local, server)) {
      return { document: asSynced(server), push: false };
    }
    return isNewer(local, server)
      ? { document: { ...local, baseUpdatedAt: server.updatedAt }, push: true }
      : { document: asSynced(server), push: false };
  }
  if (isSyncedWithServer(local)) {
    const serverAt = timeOf(server.updatedAt);
    const syncedAt = timeOf(local.updatedAt);
    const adopts =
      serverAt > syncedAt ||
      (serverAt === syncedAt && !sameContent(local, server));
    return adopts
      ? { document: asSynced(server), push: false }
      : { document: local, push: false };
  }
  if (
    sameContent(local, server) &&
    (base === null || timeOf(server.updatedAt) >= timeOf(base))
  ) {
    return { document: asSynced(server), push: false };
  }
  return { document: local, push: true };
}

function choose(
  local: Presentation,
  server: Presentation,
  options: MergeOptions,
): Choice {
  const refresh = options.mode === "refresh";
  if (server.access) return { document: server, push: false };
  if (local.access) {
    return isNewer(local, server)
      ? { document: local, push: !refresh }
      : { document: asSynced(server), push: false };
  }
  return refresh
    ? chooseOwnOnRefresh(local, server, options.isQueued ?? (() => false))
    : chooseOwn(local, server);
}

/**
 * 문서 단위 병합. 문서 하나를 통째로 고르고 필드 단위로 섞지 않는다. 곡 순서는 서버 것, 스타일은
 * 로컬 것이 되면 사용자가 만든 적 없는 세트가 나온다.
 *
 * 내 세트는 기준 판(`baseUpdatedAt`)으로 고른다. 기기 시계로 고르면 시계가 느린 기기의 편집이
 * 지고, 더 오래된 서버 목록이 방금 확정된 판을 되돌린다.
 * - 고친 것이 없는 판은 서버 판이 더 새로울 때, 또는 시각이 같아도 서버가 내용을 고쳤을 때(없는
 *   폴더·배경을 비움 등) 서버 판을 받는다. 그 밖에는 로컬 객체를 그대로 둔다.
 * - 고친 판은 서버 판과 내용이 같고 서버 판이 기준 판보다 이르지 않으면 서버 판을 맞춘 판으로 받는다.
 *   그 밖에는 남기고 올려, 그사이 다른 곳에서 바꿨으면 서버가 412로 알린다.
 * - 기준 판이 없는 이전 저장본은 내용이 같으면 맞춘 판으로 받고, 다르면 한 번만 시각으로 고른다.
 *   로컬이 더 새로우면 서버 판을 기준 판으로 삼아 올린다.
 * - 서버에 없는 내 세트는 기준 판을 비우고 올려 서버에 다시 만든다. 고친 것이 없는 판은 push가
 *   건너뛰므로, 비우지 않으면 서버가 잃은 세트가 서버에 돌아오지 않는다.
 * 받는 서버 판에는 그 판을 기준 판으로 단다.
 *
 * 다시 받기(`refresh`)는 받기만 한다. 서버와 맞춘 판이고 이 탭이 올리기를 기다리지 않는(`isQueued`)
 * 세트만 서버 판이 더 새로울 때 받는다. 시각이 같은 서버 판은 내용이 달라도 받지 않는다. 서버가 고친
 * 내용(없는 폴더·배경을 비움 등)은 부팅 병합이 맞추고, 포커스마다 도는 다시 받기가 받으면 아무도 바꾸지
 * 않은 세트의 되돌리기 기록을 지운다. 고친 세트, 이전 저장본, 서버에 없는 세트는 그대로 두고 올리지도
 * 않는다. 올리는 일은 큐와 다음 부팅이 한다.
 *
 * 공유받은 세트(`access`)는 보기 전용이라 언제나 서버본을 쓰고 올리지 않는다. 서버 목록에 없으면
 * 공유가 끝난 것이므로 지운다.
 */
export function mergeDocuments(
  local: Presentation[],
  server: Presentation[],
  options: MergeOptions = {},
): MergeResult {
  const serverById = new Map(server.map((doc) => [doc.id, doc]));
  const localIds = new Set(local.map((doc) => doc.id));
  const documents: Presentation[] = [];
  const needsPush: string[] = [];
  const removed: string[] = [];

  for (const localDoc of local) {
    const serverDoc = serverById.get(localDoc.id);
    if (serverDoc) {
      const choice = choose(localDoc, serverDoc, options);
      documents.push(choice.document);
      if (choice.push) needsPush.push(localDoc.id);
      continue;
    }
    if (localDoc.access) {
      removed.push(localDoc.id);
      continue;
    }
    if (options.mode === "refresh") {
      documents.push(localDoc);
      continue;
    }
    documents.push(
      localDoc.baseUpdatedAt === null
        ? localDoc
        : { ...localDoc, baseUpdatedAt: null },
    );
    needsPush.push(localDoc.id);
  }

  for (const serverDoc of server) {
    if (localIds.has(serverDoc.id)) continue;
    documents.push(serverDoc.access ? serverDoc : asSynced(serverDoc));
  }

  documents.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { documents, needsPush, removed };
}

interface BootMergePlan {
  documents: Presentation[];
  needsPush: string[];
  /** 로컬 저장소에서 지울 프레젠테이션 (로컬에 있던 것만) */
  removedIds: string[];
}

/**
 * 부팅 동기화에서 로컬 프레젠테이션과 서버 프레젠테이션을 맞춘 결과를 계산한다(`mergeDocuments`).
 *
 * - 서버 삭제 기록(`deletedIds`)에 있는 프레젠테이션은 다른 기기에서 영구 삭제된 것이라 지운다.
 *   올리지 않은 편집이 있다고 확실한 세트(`hasUnsyncedEdits`)만 남기고 올린다. 서버가 영구 삭제했다고
 *   답하면(410) 그 편집을 사본으로 남긴다.
 * - 받기 전부터 알던 내 세트가 그사이 로컬에서 사라졌으면(영구 삭제, 다른 탭의 삭제) 서버 목록에
 *   있어도 다시 넣지 않는다. 목록은 그 삭제보다 먼저 받은 것일 수 있다.
 * - 서버 목록에서 빠진 공유받은 프레젠테이션은 서버를 받기 전부터 알던 것
 *   (`knownBeforePull`)만 지운다. 받는 사이에 새로 들어온 공유받은 프레젠테이션은
 *   그보다 앞선 서버 목록에 없을 뿐이라 그대로 둔다.
 *
 * 다시 받기(`refresh`)는 `mergeDocuments`의 규칙대로 받기만 하고 `needsPush`는 늘 비어 있다. 영구 삭제
 * 기록이 있는 세트도 서버와 맞춘 판이고 올리기를 기다리지 않을 때만 지운다. 남긴 세트는 큐의 push가
 * 410을 받거나 다음 부팅이 올려 서버가 정한다.
 */
export function planBootMerge(
  local: Presentation[],
  server: Presentation[],
  deletedIds: readonly string[],
  knownBeforePull: ReadonlySet<string>,
  options: MergeOptions = {},
): BootMergePlan {
  const refresh = options.mode === "refresh";
  const isQueued = options.isQueued ?? (() => false);
  const deleted = new Set(deletedIds);
  const serverIds = new Set(server.map((doc) => doc.id));
  const localIds = new Set(local.map((doc) => doc.id));
  const tombstoned = local.filter(
    (doc) => !doc.access && deleted.has(doc.id) && !serverIds.has(doc.id),
  );
  const tombstonedIds = new Set(tombstoned.map((doc) => doc.id));
  const keptEdits = tombstoned.filter((doc) =>
    refresh ? !isReplaceableOnRefresh(doc, isQueued) : hasUnsyncedEdits(doc),
  );
  const keptIds = new Set(keptEdits.map((doc) => doc.id));

  const merged = mergeDocuments(
    local.filter((doc) => !tombstonedIds.has(doc.id)),
    server.filter(
      (doc) =>
        doc.access !== undefined ||
        localIds.has(doc.id) ||
        !knownBeforePull.has(doc.id),
    ),
    options,
  );
  const joinedDuringPull = local.filter(
    (doc) => merged.removed.includes(doc.id) && !knownBeforePull.has(doc.id),
  );
  const removedShared = merged.removed.filter((id) => knownBeforePull.has(id));

  return {
    documents: [...merged.documents, ...joinedDuringPull, ...keptEdits].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt),
    ),
    needsPush: refresh
      ? []
      : [...merged.needsPush, ...keptEdits.map((doc) => doc.id)],
    removedIds: [
      ...deletedIds.filter((id) => tombstonedIds.has(id) && !keptIds.has(id)),
      ...removedShared,
    ],
  };
}
