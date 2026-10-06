import {
  listPresentations,
  applyServerDocuments,
  removePersistedPresentation,
} from "../../features/presentation";
import {
  getFolders,
  applyServerFolders,
  applyServerFolder,
} from "../../features/drive/folderStore";
import {
  sortFoldersParentFirst,
  type DriveTombstones,
  type Folder,
} from "#shared";
import { savePresentation } from "../storage";
import { planBootMerge } from "./mergeDocuments";
import { mergeFolders } from "./mergeFolders";
import {
  getUserSongs,
  applyServerLibraryDecks,
  applyServerDeckFields,
} from "../../features/editor/songLibraryStore";
import { mergeLibraryDecks } from "./mergeLibraryDecks";
import { sharedPresentationListener } from "./sharedPresentationListener";
import {
  pullPresentations,
  pushPresentation,
  rememberServerDocuments,
  setSharedPresentationListener,
  pullDecks,
  pullFolders,
} from "./presentationSync";
import { isRetryableApiError } from "../api/request";
import {
  setFolderSyncEnabled,
  setServerFolderListener,
  pushFolderNow,
} from "./folderSync";
import {
  resetSyncStatus,
  setSyncStatus,
  type SyncDomain,
  type SyncStatus,
} from "./syncStatus";
import { setSyncEnabled } from "./syncScheduler";
import {
  setDeckSyncEnabled,
  setServerDeckListener,
  pushDeckNow,
} from "./deckSync";
import { refreshBackgroundCatalog } from "./backgroundSync";
import { isProjectionPath } from "../../features/presentation/fullscreen";

/**
 * 송출 중 새로고침하면 부팅 경로를 처음부터 다시 탄다. 여기서 서버와 맞추면
 * 송출 중 API·데이터 요청 0건이 깨지므로, 송출 화면에서는 부팅 동기화를 돌리지 않는다.
 */
export function shouldRunBootSync(pathname: string): boolean {
  return !isProjectionPath(pathname);
}

/**
 * 부팅 시 서버와 한 번 맞춘다.
 *
 * **백그라운드로 돌린다.** 로컬 하이드레이션이 끝나면 곧바로 화면을 그리고,
 * 서버 병합은 그 뒤에 붙인다. 서버를 기다리느라 첫 화면이 늦어지면 네트워크가
 * 느린 교회에서 예배 시작이 그만큼 밀린다.
 *
 * 오프라인은 조용히 넘어간다 — 실패가 아니라 정상 경로다.
 *
 * 결과는 폴더·세트·곡 도메인별로 따로 남긴다. 한데 모아 한 번에 쓰면 세트 push가
 * 실패해도 뒤의 곡 동기화가 성공하는 순간 헤더가 '동기화됨'으로 바뀐다.
 * 상태 초기화는 큐를 켜기 전에 한다. 켠 뒤에 지우면 먼저 실패한 큐의 기록이 사라진다.
 */
export async function runBootSync(): Promise<void> {
  resetSyncStatus();
  setSyncStatus("folder", "syncing");
  setSyncStatus("presentation", "syncing");
  setSyncStatus("deck", "syncing");
  setSharedPresentationListener(sharedPresentationListener);
  setSyncEnabled(true);
  setDeckSyncEnabled(true);
  setServerDeckListener(applyServerDeckFields);
  setFolderSyncEnabled(true);
  setServerFolderListener(applyServerFolder);
  void refreshBackgroundCatalog();

  const knownBeforePull = new Set(listPresentations().map((doc) => doc.id));
  let serverDocuments;
  let tombstones: DriveTombstones;
  let unsynced: readonly SyncDomain[] = ["folder", "presentation", "deck"];
  try {
    const folderList = await pullFolders();
    tombstones = folderList.tombstones;
    setSyncStatus("folder", await syncFolders(folderList.folders, tombstones));
    unsynced = ["presentation", "deck"];
    serverDocuments = await pullPresentations();
    rememberServerDocuments(serverDocuments);
  } catch (err) {
    for (const domain of unsynced) setSyncStatus(domain, failureStatus(err));
    return;
  }

  const { documents, needsPush, removedIds } = planBootMerge(
    listPresentations(),
    serverDocuments,
    tombstones.presentationIds,
    knownBeforePull,
  );

  applyServerDocuments(documents);
  for (const id of removedIds) {
    await removePersistedPresentation(id);
  }

  for (const document of documents) {
    try {
      await savePresentation(document);
    } catch (error) {
      void error;
    }
  }

  setSyncStatus(
    "presentation",
    await pushEachTrackingStatus(
      findEach(documents, needsPush),
      pushPresentation,
    ),
  );

  setSyncStatus("deck", await syncLibraryDecks());
}

function failureStatus(err: unknown): SyncStatus {
  return isRetryableApiError(err) ? "offline" : "error";
}

async function syncFolders(
  serverFolders: Folder[],
  tombstones: DriveTombstones,
): Promise<SyncStatus> {
  const deletedIds = new Set(tombstones.folderIds);
  const local = getFolders();
  const { folders, needsPush } = mergeFolders(
    local.filter((folder) => !deletedIds.has(folder.id)),
    serverFolders,
  );
  await applyServerFolders(
    folders,
    local.filter((folder) => deletedIds.has(folder.id)).map((f) => f.id),
  );

  const toPush = new Set(needsPush);
  return pushEachTrackingStatus(
    sortFoldersParentFirst(
      folders.filter((candidate) => toPush.has(candidate.id)),
      folders,
    ),
    pushFolderNow,
  );
}

async function syncLibraryDecks(): Promise<SyncStatus> {
  let serverDecks;
  try {
    serverDecks = await pullDecks();
  } catch (err) {
    return failureStatus(err);
  }

  const { decks, needsPush } = mergeLibraryDecks(getUserSongs(), serverDecks);
  await applyServerLibraryDecks(decks);

  return pushEachTrackingStatus(findEach(decks, needsPush), pushDeckNow);
}

function findEach<T extends { id: string }>(
  items: readonly T[],
  ids: readonly string[],
): T[] {
  return ids
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is T => item !== undefined);
}

async function pushEachTrackingStatus<T>(
  items: readonly T[],
  push: (item: T) => Promise<unknown>,
): Promise<SyncStatus> {
  let failed = false;
  let offline = false;
  for (const item of items) {
    try {
      await push(item);
    } catch (err) {
      if (failureStatus(err) === "offline") offline = true;
      else failed = true;
    }
  }
  if (failed) return "error";
  return offline ? "offline" : "synced";
}
