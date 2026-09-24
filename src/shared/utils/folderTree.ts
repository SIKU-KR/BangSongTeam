/**
 * 드라이브 폴더 트리 연산 (서버·클라이언트 공용, 순수 함수).
 *
 * 폴더는 `parentId`로만 이어진 인접 리스트다. 오프라인 기기 두 대가 서로 반대로
 * 옮기면 사이클이, 다른 기기에서 부모를 영구 삭제하면 고아가 생길 수 있다.
 * 그래서 선언된 `parentId`를 그대로 믿지 않고 **유효 부모**를 계산한다 —
 * 부모가 없거나 사이클에 걸린 폴더는 루트로 취급한다. 화면이 무한 루프에
 * 빠지거나 폴더가 사라져 보이는 일이 없어야 한다.
 */

/** 트리 연산에 필요한 최소 필드 (공유 `Folder`와 서버 행 모두 만족) */
export interface FolderLink {
  id: string;
  parentId: string | null;
  trashedAt?: string | null;
}

export interface FolderIndex<T extends FolderLink> {
  byId: ReadonlyMap<string, T>;
  /** 유효 부모 (`null` = 루트). 모든 폴더 id가 들어 있다 */
  parentOf: ReadonlyMap<string, string | null>;
  /** 유효 부모 기준 자식 목록 (`null` 키 = 루트의 자식). 입력 순서를 유지한다 */
  childrenOf: ReadonlyMap<string | null, readonly T[]>;
  /** 사이클에 걸려 루트로 끊어 낸 폴더 id */
  cycleMembers: ReadonlySet<string>;
}

export function buildFolderIndex<T extends FolderLink>(
  folders: readonly T[],
): FolderIndex<T> {
  const byId = new Map<string, T>();
  for (const folder of folders) byId.set(folder.id, folder);

  const parentOf = new Map<string, string | null>();
  const cycleMembers = new Set<string>();

  for (const start of byId.values()) {
    if (parentOf.has(start.id)) continue;

    const path: string[] = [];
    const onPath = new Set<string>();
    let cursor: string | null = start.id;

    while (cursor !== null && !parentOf.has(cursor)) {
      if (onPath.has(cursor)) {
        for (const member of path.slice(path.indexOf(cursor))) {
          parentOf.set(member, null);
          cycleMembers.add(member);
        }
        break;
      }
      const node = byId.get(cursor) as T;
      onPath.add(cursor);
      path.push(cursor);

      const parentId = node.parentId;
      if (parentId === null || !byId.has(parentId)) {
        parentOf.set(cursor, null);
        break;
      }
      cursor = parentId;
    }

    for (const id of path) {
      if (!parentOf.has(id)) {
        parentOf.set(id, (byId.get(id) as T).parentId);
      }
    }
  }

  const childrenOf = new Map<string | null, T[]>();
  for (const folder of byId.values()) {
    const parentId = parentOf.get(folder.id) ?? null;
    const siblings = childrenOf.get(parentId);
    if (siblings) siblings.push(folder);
    else childrenOf.set(parentId, [folder]);
  }

  return { byId, parentOf, childrenOf, cycleMembers };
}

/**
 * 루트부터 해당 폴더까지의 경로 (브레드크럼). 모르는 id면 빈 배열.
 * 유효 부모는 사이클이 없으므로 반드시 끝난다.
 */
export function getFolderPath<T extends FolderLink>(
  index: FolderIndex<T>,
  folderId: string | null | undefined,
): T[] {
  const path: T[] = [];
  let cursor = folderId ?? null;
  while (cursor !== null) {
    const folder = index.byId.get(cursor);
    if (!folder) break;
    path.push(folder);
    cursor = index.parentOf.get(cursor) ?? null;
  }
  return path.reverse();
}

/** 자신을 포함한 모든 하위 폴더 id. 모르는 id면 빈 집합 */
export function collectDescendantFolderIds<T extends FolderLink>(
  index: FolderIndex<T>,
  folderId: string,
): Set<string> {
  const result = new Set<string>();
  if (!index.byId.has(folderId)) return result;

  const queue = [folderId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (result.has(current)) continue;
    result.add(current);
    for (const child of index.childrenOf.get(current) ?? []) {
      queue.push(child.id);
    }
  }
  return result;
}

/** `folderId`를 `newParentId` 아래로 옮기면 사이클이 생기는지 (자기 자신 포함) */
export function wouldCreateCycle<T extends FolderLink>(
  index: FolderIndex<T>,
  folderId: string,
  newParentId: string | null,
): boolean {
  if (newParentId === null) return false;
  if (newParentId === folderId) return true;
  return collectDescendantFolderIds(index, folderId).has(newParentId);
}

/** 폴더 자신이나 조상 중 하나라도 휴지통에 있는지 */
export function isFolderTrashed<T extends FolderLink>(
  index: FolderIndex<T>,
  folderId: string | null | undefined,
): boolean {
  return getFolderPath(index, folderId).some((folder) =>
    Boolean(folder.trashedAt),
  );
}

/**
 * 항목이 실제로 놓일 폴더. 폴더가 없으면(다른 기기에서 영구 삭제 등) 루트.
 */
export function resolveFolderId<T extends FolderLink>(
  index: FolderIndex<T>,
  folderId: string | null | undefined,
): string | null {
  if (!folderId) return null;
  return index.byId.has(folderId) ? folderId : null;
}

/** 이름 충돌 비교 키 (앞뒤 공백·대소문자 무시) */
export function folderNameKey(name: string): string {
  return name.trim().toLowerCase();
}

const MAX_NAME_LENGTH = 100;
const NUMBERED_NAME = /^(.*) \((\d+)\)$/;

/**
 * 같은 위치에 겹치는 이름이 있으면 파일 탐색기처럼 번호를 붙인다.
 * "새 폴더" → "새 폴더 (2)", "새 폴더 (2)" → "새 폴더 (3)".
 */
export function resolveUniqueName(
  base: string,
  takenNames: Iterable<string>,
): string {
  const taken = new Set<string>();
  for (const name of takenNames) taken.add(folderNameKey(name));

  const trimmed = base.trim().slice(0, MAX_NAME_LENGTH);
  if (!taken.has(folderNameKey(trimmed))) return trimmed;

  const match = NUMBERED_NAME.exec(trimmed);
  const stem = match ? match[1] : trimmed;
  let counter = match ? Number(match[2]) + 1 : 2;

  for (;;) {
    const suffix = ` (${counter})`;
    const candidate = `${stem.slice(0, MAX_NAME_LENGTH - suffix.length)}${suffix}`;
    if (!taken.has(folderNameKey(candidate))) return candidate;
    counter += 1;
  }
}

/**
 * 부모가 자식보다 먼저 오도록 정렬한다 (서버 push 순서).
 * 서버는 모르는 부모를 루트로 보정하므로, 자식이 먼저 도착하면 루트로 튄다.
 */
export function sortFoldersParentFirst<T extends FolderLink>(
  folders: readonly T[],
  context: readonly T[] = folders,
): T[] {
  const index = buildFolderIndex(context);
  const depthOf = (id: string): number => {
    let depth = 0;
    let cursor = index.parentOf.get(id) ?? null;
    while (cursor !== null) {
      depth += 1;
      cursor = index.parentOf.get(cursor) ?? null;
    }
    return depth;
  };
  return folders
    .map((folder, order) => ({ folder, order, depth: depthOf(folder.id) }))
    .sort((a, b) => a.depth - b.depth || a.order - b.order)
    .map((entry) => entry.folder);
}
