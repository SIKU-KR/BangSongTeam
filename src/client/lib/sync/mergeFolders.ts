import { buildFolderIndex, isFarFuture, type Folder } from "#shared";
import { serverAlignedNow } from "../api/serverClock";
import type { MergeMode } from "./mergeDocuments";

interface FolderMergeResult {
  folders: Folder[];
  needsPush: string[];
}

interface FolderMergeOptions {
  mode?: MergeMode;
  knownBeforePull?: ReadonlySet<string>;
}

/**
 * 폴더 단위 Last-Write-Wins 병합.
 *
 * 오프라인 기기 두 대가 A를 B 안으로, B를 A 안으로 옮기면 폴더별로는 각각
 * 이겨도 합치면 사이클이 된다. 그런 폴더는 서버본으로 되돌린다 — 서버는 사이클을
 * 저장하지 않으므로 서버 트리는 늘 유효하고, 되돌리지 않으면 push가 매번 루트로
 * 보정되며 기기마다 트리가 어긋난다.
 *
 * 로컬 시각이 서버에 맞춘 지금(`serverAlignedNow`)보다 한참 앞서면(`isFarFuture`) 로컬 폴더가 더
 * 늦어도 서버본을 고른다. 빠른 시계가 남긴 값이라, 이기게 두면 부팅마다 다시 올라가고 서버가 줄인 시각이
 * 그동안 다른 기기의 수정을 옛 수정으로 막는다. 시계가 늦은 기기의 기기 시계로 가르면 서버 판 바로 뒤로
 * 찍은 수정까지 진다.
 *
 * 받기 전부터 알던 폴더(`knownBeforePull`)가 그사이 로컬에서 사라졌으면 서버 목록에 있어도 넣지
 * 않는다. 받는 동안이나 받기 직전에 비우기·다른 탭이 지운 폴더라, 목록이 그 삭제보다 먼저 받은 것일 수
 * 있다. 넣으면 다음 부팅이 서버에 다시 만든다.
 *
 * 다시 받기(`refresh`)는 받기만 한다. 이기는 로컬 폴더와 로컬에만 있는 폴더도 그대로 두고 올릴
 * 목록(`needsPush`)은 비운다. 그 폴더는 큐와 다음 부팅이 올린다.
 */
export function mergeFolders(
  local: Folder[],
  server: Folder[],
  options: FolderMergeOptions = {},
): FolderMergeResult {
  const localIds = new Set(local.map((folder) => folder.id));
  const known = options.knownBeforePull ?? new Set<string>();
  const serverById = new Map(
    server
      .filter((folder) => localIds.has(folder.id) || !known.has(folder.id))
      .map((folder) => [folder.id, folder]),
  );
  const byId = new Map<string, Folder>(serverById);
  const localWins = new Set<string>();
  const nowMs = serverAlignedNow();

  for (const localFolder of local) {
    const serverFolder = serverById.get(localFolder.id);
    if (
      !serverFolder ||
      (localFolder.updatedAt > serverFolder.updatedAt &&
        !isFarFuture(localFolder.updatedAt, nowMs))
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
  return {
    folders,
    needsPush: options.mode === "refresh" ? [] : [...localWins],
  };
}
