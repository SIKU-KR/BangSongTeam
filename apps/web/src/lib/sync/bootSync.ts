import {
  listPresentations,
  applyServerDocuments,
} from "../../features/presentation";
import { savePresentation } from "../storage";
import { mergeDocuments } from "./mergeDocuments";
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
  OfflineError,
} from "./presentationSync";
import { setSyncStatus } from "./syncStatus";
import { setSyncEnabled } from "./syncScheduler";
import {
  setDeckSyncEnabled,
  setServerDeckListener,
  pushDeckNow,
} from "./deckSync";

/**
 * 송출 화면(청중 전체화면)에서는 부팅 동기화를 돌리지 않는다.
 *
 * 송출 중 새로고침하면 부팅 경로를 처음부터 다시 탄다. 여기서 서버와 맞추면
 * 송출 중 네트워크 요청 0건(M4-5 Zero-Fetch)이 깨진다. 예배 준비(`/ready`)는
 * 온라인 단계이므로 그대로 동기화한다.
 */
const PROJECTION_ROUTE = /^\/present\/[^/]+\/fullscreen\/?$/;

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

  let serverDocuments;
  try {
    setSyncStatus("syncing");
    serverDocuments = await pullPresentations();
  } catch (err) {
    if (err instanceof OfflineError) {
      setSyncStatus("offline");
    } else {
      setSyncStatus("error");
    }
    return;
  }

  const { documents, needsPush } = mergeDocuments(
    listPresentations(),
    serverDocuments,
  );

  applyServerDocuments(documents);

  // 서버에서 받은 문서를 로컬에도 적어 둔다. 다음 부팅에서 네트워크가
  // 없어도 그대로 열려야 한다 (오프라인 송출).
  for (const document of documents) {
    try {
      await savePresentation(document);
    } catch {
      // 로컬 저장 실패는 persistenceStatus가 따로 알린다
    }
  }

  // 로컬이 더 최신이거나 서버에 없던 문서를 올린다 (첫 로그인 업로드 경로)
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

  // 보관함 곡 (M5-2). 공유·가져오기는 보관함 덱이 서버에 있어야 성립한다.
  const deckOffline = await syncLibraryDecks();

  setSyncStatus(offline || deckOffline ? "offline" : "synced");
}

/** @returns 오프라인이었는지 */
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
