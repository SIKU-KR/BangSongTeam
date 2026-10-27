import { buildFolderIndex, isFarFuture, type Folder } from "#shared";

interface FolderMergeResult {
  folders: Folder[];
  needsPush: string[];
}

/**
 * 폴더 단위 Last-Write-Wins 병합.
 *
 * 오프라인 기기 두 대가 A를 B 안으로, B를 A 안으로 옮기면 폴더별로는 각각
 * 이겨도 합치면 사이클이 된다. 그런 폴더는 서버본으로 되돌린다 — 서버는 사이클을
 * 저장하지 않으므로 서버 트리는 늘 유효하고, 되돌리지 않으면 push가 매번 루트로
 * 보정되며 기기마다 트리가 어긋난다.
 *
 * 로컬 시각이 기기 시계보다 한참 앞서면(`isFarFuture`) 로컬 폴더가 더 늦어도 서버본을 고른다.
 * 빠른 시계가 남긴 값이라, 이기게 두면 부팅마다 다시 올라가고 서버가 줄인 시각이 그동안 다른 기기의
 * 수정을 옛 수정으로 막는다.
 */
export function mergeFolders(
  local: Folder[],
  server: Folder[],
): FolderMergeResult {
  const serverById = new Map(server.map((folder) => [folder.id, folder]));
  const byId = new Map<string, Folder>(serverById);
  const localWins = new Set<string>();

  for (const localFolder of local) {
    const serverFolder = serverById.get(localFolder.id);
    if (
      !serverFolder ||
      (localFolder.updatedAt > serverFolder.updatedAt &&
        !isFarFuture(localFolder.updatedAt))
    ) {
      byId.set(localFolder.id, localFolder);
      localWins.add(localFolder.id);
    }
  }

  for (;;) {
    const { cycleMembers } = buildFolderIndex([...byId.values()]);
    const revertable = [...cycleMembers].filter(
      (id) => localWins.has(id) && serverById.has(id),
    );
    if (revertable.length === 0) break;
    for (const id of revertable) {
      byId.set(id, serverById.get(id) as Folder);
      localWins.delete(id);
    }
  }

  const folders = [...byId.values()].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  return { folders, needsPush: [...localWins] };
}
