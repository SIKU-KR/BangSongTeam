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
import { sortFoldersParentFirst, type DriveTombstones } from "#shared";
import { savePresentation } from "../storage";
import { mergeDocuments } from "./mergeDocuments";
import { mergeFolders } from "./mergeFolders";
import {
  getUserSongs,
  applyServerLibraryDecks,
  applyServerDeckFields,
} from "../../features/editor/songLibraryStore";
import { mergeLibraryDecks } from "./mergeLibraryDecks";
import {
  pullPresentations,
  pushPresentation,
  pullDecks,
  pullFolders,
  OfflineError,
} from "./presentationSync";
import {
  setFolderSyncEnabled,
  setServerFolderListener,
  pushFolderNow,
} from "./folderSync";
import { setSyncStatus } from "./syncStatus";
import { setSyncEnabled } from "./syncScheduler";
import {
  setDeckSyncEnabled,
  setServerDeckListener,
  pushDeckNow,
} from "./deckSync";

const PROJECTION_ROUTE = /^\/present\/[^/]+\/fullscreen\/?$/;

/**
 * 송출 중 새로고침하면 부팅 경로를 처음부터 다시 탄다. 여기서 서버와 맞추면
 * 송출 중 API·데이터 요청 0건이 깨지므로, 송출 화면에서는 부팅 동기화를 돌리지 않는다.
 */
export function shouldRunBootSync(pathname: string): boolean {
  return !PROJECTION_ROUTE.test(pathname);
}

/**
 * 부팅 시 서버와 한 번 맞춘다.
 *
 * **백그라운드로 돌린다.** 로컬 하이드레이션이 끝나면 곧바로 화면을 그리고,
 * 서버 병합은 그 뒤에 붙인다. 서버를 기다리느라 첫 화면이 늦어지면 네트워크가
 * 느린 교회에서 예배 시작이 그만큼 밀린다.
 *
 * 오프라인은 조용히 넘어간다 — 실패가 아니라 정상 경로다.
 */
export async function runBootSync(): Promise<void> {
  setSyncEnabled(true);
  setDeckSyncEnabled(true);
  setServerDeckListener(applyServerDeckFields);
  setFolderSyncEnabled(true);
  setServerFolderListener(applyServerFolder);

  let serverDocuments;
  let tombstones: DriveTombstones;
  let folderOffline: boolean;
  try {
    setSyncStatus("syncing");
    const folderList = await pullFolders();
    tombstones = folderList.tombstones;
    folderOffline = await syncFolders(folderList.folders, tombstones);
    serverDocuments = await pullPresentations();
  } catch (err) {
    if (err instanceof OfflineError) {
      setSyncStatus("offline");
    } else {
      setSyncStatus("error");
    }
    return;
  }

  const deletedIds = new Set(tombstones.presentationIds);
  const local = listPresentations();
  const { documents, needsPush } = mergeDocuments(
    local.filter((doc) => !deletedIds.has(doc.id)),
    serverDocuments,
  );

  applyServerDocuments(documents);
  for (const doc of local) {
    if (deletedIds.has(doc.id)) await removePersistedPresentation(doc.id);
  }

  for (const document of documents) {
    try {
      await savePresentation(document);
    } catch (error) {
      void error;
    }
  }

  let offline = false;
  for (const id of needsPush) {
    const document = documents.find((doc) => doc.id === id);
    if (!document) continue;
    try {
      await pushPresentation(document);
    } catch (err) {
      if (err instanceof OfflineError) offline = true;
    }
  }

  const deckOffline = await syncLibraryDecks();

  setSyncStatus(offline || deckOffline || folderOffline ? "offline" : "synced");
}

async function syncFolders(
  serverFolders: Parameters<typeof mergeFolders>[1],
  tombstones: DriveTombstones,
): Promise<boolean> {
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
  let offline = false;
  for (const folder of sortFoldersParentFirst(
    folders.filter((candidate) => toPush.has(candidate.id)),
    folders,
  )) {
    try {
      await pushFolderNow(folder);
    } catch (err) {
      if (err instanceof OfflineError) offline = true;
    }
  }
  return offline;
}

async function syncLibraryDecks(): Promise<boolean> {
  let serverDecks;
  try {
    serverDecks = await pullDecks();
  } catch (err) {
    return err instanceof OfflineError;
  }

  const { decks, needsPush } = mergeLibraryDecks(getUserSongs(), serverDecks);
  await applyServerLibraryDecks(decks);

  let offline = false;
  for (const id of needsPush) {
    const deck = decks.find((candidate) => candidate.id === id);
    if (!deck) continue;
    try {
      await pushDeckNow(deck);
    } catch (err) {
      if (err instanceof OfflineError) offline = true;
    }
  }
  return offline;
}
