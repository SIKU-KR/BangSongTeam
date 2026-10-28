import { flushPendingWrites } from "../../features/presentation";
import { flushFolderWrites } from "../../features/drive/folderStore";
import { flushSongWrites } from "../../features/editor/songLibraryStore";
import { isServerReachable } from "../api/connectivity";
import { getCurrentUserId } from "../auth/sessionStore";
import { stopSync } from "./bootSync";
import { flushDeckSync, hasUnsentDecks } from "./deckSync";
import { flushFolderSync, hasUnsentFolders } from "./folderSync";
import { listPendingDeckDeletes } from "./pendingDeckDeletes";
import { flushPendingSync, hasUnsentDocuments } from "./syncScheduler";

const SIGN_OUT_FLUSH_TIMEOUT_MS = 3000;

async function flushStoreWrites(): Promise<void> {
  await Promise.all([
    flushPendingWrites(),
    flushFolderWrites(),
    flushSongWrites(),
  ]);
}

/**
 * 로그아웃 요청을 보내기 전, 쿠키가 아직 유효할 때 부른다. 프레젠테이션·폴더·곡의 저장본 쓰기를
 * 마치고(앞서 쓰지 못해 다시 시도를 기다리는 쓰기도 지금 다시 한다), 서버에 닿으면
 * 디바운스·백오프 중인 폴더·프레젠테이션·곡 변경과 곡 삭제를 곧바로 보낸다.
 *
 * 로그아웃 뒤에 나가는 요청은 401로 버려져, 로그아웃 직전에 고친 내용과 지운 곡이 다른 기기에
 * 가지 않는다. 폴더를 먼저 보내는 것은 새 폴더로 옮긴 프레젠테이션이 폴더보다 먼저 닿으면 서버가
 * 루트로 옮기기 때문이다. 저장본 쓰기를 먼저 마쳐 두면 서버에 다 보내지 못한 변경도 그 계정의
 * 다음 부팅이 올린다. 그래서 서버로 보내기는 3초까지만 기다린다. 끊긴 네트워크에서 로그아웃
 * 버튼이 멈추면 안 된다.
 */
export async function flushBeforeSignOut(): Promise<void> {
  await flushStoreWrites();
  if (!isServerReachable()) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, SIGN_OUT_FLUSH_TIMEOUT_MS);
  });
  const flushed = flushFolderSync()
    .then(() => Promise.all([flushPendingSync(), flushDeckSync()]))
    .then(
      () => undefined,
      () => undefined,
    );
  await Promise.race([flushed, deadline]);
  clearTimeout(timer);
}

/**
 * 서버에 아직 닿지 못한 변경이 이 기기에 있는지. 큐가 기다리거나 보내는 중이거나 실패로 붙잡은
 * 프레젠테이션·폴더·곡과, 서버에서 아직 지우지 못한 곡(새로고침해도 남는 삭제 기록)을 센다. 이런
 * 변경은 로그아웃해도 이 기기에 남아, 같은 계정으로 다시 로그인한 부팅이 올린다.
 */
export function hasUnsentChanges(): boolean {
  const userId = getCurrentUserId();
  return (
    hasUnsentDocuments() ||
    hasUnsentFolders() ||
    hasUnsentDecks() ||
    (userId !== null && listPendingDeckDeletes(userId).length > 0)
  );
}

/**
 * 로그아웃하기 전에 사용자에게 먼저 물을지. 오프라인이거나 보내지 못한 변경이 있을 때다.
 *
 * 오프라인이면 로그아웃 요청이 닿지 않아 서버 세션이 남고, 다시 로그인하려면 인터넷이 필요해 그동안
 * 이 기기에서 작업을 이어 갈 수 없다. 보내지 못한 변경은 이 기기에 남아 다음 로그인에서 올라가지만,
 * 그 전에는 다른 기기에 보이지 않는다. 오프라인은 브라우저가 알리거나(`navigator.onLine`) 마지막
 * 요청이 서버에 닿지 못한 경우(`isServerReachable`)다. 둘 다 아니고 보낼 것이 없을 때만 묻지 않는다.
 */
export function shouldConfirmSignOut(): boolean {
  const offline =
    (typeof navigator !== "undefined" && !navigator.onLine) ||
    !isServerReachable();
  return offline || hasUnsentChanges();
}

/**
 * 이 탭의 계정이 끝나 새로고침하기 전에 부른다. 세 큐를 곧바로 끄고(`stopSync`) 프레젠테이션·폴더·곡의
 * 저장본 쓰기를 마칠 때까지 기다린다.
 *
 * 끄는 일은 기다리기 전에 동기로 한다. 쓰기를 기다리는 동안 큐의 타이머가 앞 계정의 항목을 다른
 * 계정의 쿠키로 보내면 안 된다. 쓰기를 기다리는 것은 새로고침이 디바운스 중이거나 끝나지 않은
 * 저장본 쓰기를 버리기 때문이다. 앞서 쓰지 못해 다시 시도를 기다리는 쓰기도 지금 한 번 다시 한다.
 * 큐를 껐으니 그 편집은 서버에도 가지 않아, 저장본에 남지 않으면 새로고침과 함께 사라진다.
 */
export async function stopAccountSync(): Promise<void> {
  stopSync();
  await flushStoreWrites();
}
