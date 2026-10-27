import { ERROR_COPY } from "#copy/common";
import {
  DeckSchema,
  FolderDeleteResponseSchema,
  FolderSchema,
  IdSchema,
  PresentationDocumentSchema,
  fitPresentationToLimits,
  toPresentationChanges,
  type Deck,
  type DeckListResponse,
  type Folder,
  type FolderDeleteRequest,
  type FolderDeleteResponse,
  type FolderListResponse,
  type Presentation,
  type PresentationChanges,
  type PresentationDocument,
} from "#shared";
import { api } from "../api/client";
import {
  callApi,
  isRetryableApiError,
  OfflineError,
  requestIdOfError,
  ServerRejectedError,
  SessionExpiredError,
} from "../api/request";
import { requestSessionCheck } from "../auth/sessionStore";
import { reportApiFailure } from "../observability/clientReports";
import { setSyncStatus, type SyncStatus } from "./syncStatus";

function isSessionMismatch(err: unknown): boolean {
  return (
    err instanceof SessionExpiredError ||
    (err instanceof ServerRejectedError && err.status === 403)
  );
}

async function callSyncApi<T>(
  request: Parameters<typeof callApi>[0],
): Promise<T> {
  try {
    return await callApi<T>(request);
  } catch (err) {
    reportApiFailure(err);
    if (isSessionMismatch(err)) requestSessionCheck();
    throw err;
  }
}

/**
 * 이 기기에 있는 프레젠테이션이 서버가 받을 수 있는 모양이 아니다. 글 한도에 맞춰도 스키마를
 * 통과하지 못한 문서(덱이 빠진 항목 등)라 다시 보내도 같은 결과다.
 *
 * 동기화 큐는 다시 시도하지 않는 영구 실패로 남긴다(`isRetryableApiError`가 거짓). 그래서
 * 헤더가 '동기화 실패'와 이유를 보여 주고, '다시 시도'나 다음 편집 때만 다시 보낸다. `cause`는
 * 로그에 남길 스키마 오류다.
 */
export class UnsyncableDocumentError extends Error {
  constructor(cause?: unknown) {
    super(ERROR_COPY.documentInvalid);
    this.name = "UnsyncableDocumentError";
    this.cause = cause;
  }
}

/**
 * 동기화 실패를 화면에 보일 이유(`SyncFailure.reason`). 서버가 거절하며 준 문장과 보낼 수
 * 없는 문서만 이유가 된다. 그 밖의 오류 문구는 응답 스키마 오류처럼 개발자용 글일 수 있어
 * 보여 주지 않는다.
 */
export function syncFailureReasonOf(err: unknown): string | undefined {
  return err instanceof ServerRejectedError ||
    err instanceof UnsyncableDocumentError
    ? err.message
    : undefined;
}

/**
 * 프레젠테이션을 서버가 받을 수 있는 문서로 좁힌다. 글 한도를 넘은 제목·원작자 이름은
 * 줄이고(`fitPresentationToLimits`), 그래도 스키마를 통과하지 못하면
 * `UnsyncableDocumentError`를 던진다.
 *
 * 덱이 비어 있는 항목이 하나라도 있으면 서버의 `PresentationDocumentSchema`가 거절한다.
 * 조용히 건너뛰면 큐가 성공으로 세어, 올라가지 않은 문서가 '동기화됨'으로 보인다.
 */
function toSyncableDocument(presentation: Presentation): PresentationDocument {
  const result = PresentationDocumentSchema.safeParse(
    fitPresentationToLimits(presentation),
  );
  if (!result.success) throw new UnsyncableDocumentError(result.error);
  return result.data;
}

/**
 * 문서 id → (덱 id → 서버에 있다고 아는 덱의 지문). 메모리에만 둔다.
 *
 * 바뀐 덱만 올리는 기준이다. 모르는 문서(새로고침 직후 부팅 동기화 전 등)는
 * 모든 덱을 보낸다. 서버가 실제로 덱을 잃었으면(다른 기기에서 곡을 뺀 경우 등) 409를
 * 받고 모든 덱을 담아 다시 보내므로, 이 표가 틀려도 곡이 빠지지는 않는다.
 */
const serverDecks = new Map<string, Map<string, string>>();

/**
 * 스키마로 파싱한 덱의 JSON을 53비트 해시로 줄인다 (cyrb53). 덱 본문을 통째로
 * 들고 있으면 세트 수만큼 메모리를 한 벌 더 쓴다.
 */
function deckFingerprint(deck: Deck): string {
  const text = JSON.stringify(deck);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function rememberServerDecks(document: PresentationDocument): void {
  serverDecks.set(
    document.id,
    new Map(
      document.items.map((item) => [item.deck.id, deckFingerprint(item.deck)]),
    ),
  );
}

/**
 * 서버에서 받은 문서들을 변경분 계산의 기준으로 삼는다 (부팅 동기화).
 * 보기 전용 공유 세트는 올리지 않으므로 기억하지 않는다.
 */
export function rememberServerDocuments(documents: readonly unknown[]): void {
  for (const candidate of documents) {
    const parsed = PresentationDocumentSchema.safeParse(candidate);
    if (parsed.success && !parsed.data.access) rememberServerDecks(parsed.data);
  }
}

export function __resetServerDecksForTests(): void {
  serverDecks.clear();
}

async function sendChanges(changes: PresentationChanges): Promise<void> {
  await callSyncApi(() =>
    api.api.presentations[":id"].$patch({
      param: { id: changes.id },
      json: changes,
    }),
  );
}

/**
 * 세트를 서버에 올린다. 헤더와 곡 순서는 언제나, 덱은 서버에 마지막으로 올린 뒤
 * 바뀐 것만 보낸다. 서버가 모르는 곡이 있다고 하면(409) 모든 덱을 담아 한 번 더
 * 보낸다.
 *
 * 글 한도에 맞춘 문서를 올리고 그 문서의 덱 지문을 기억한다. 줄이기 전의 덱으로 기억하면
 * 줄인 곡을 올릴 때마다 바뀐 곡으로 보고 다시 보낸다. 서버가 받을 수 없는 문서면 요청 없이
 * `UnsyncableDocumentError`를 던진다.
 */
export async function pushPresentation(
  presentation: Presentation,
): Promise<void> {
  const document = toSyncableDocument(presentation);

  const known = serverDecks.get(document.id);
  try {
    await sendChanges(
      toPresentationChanges(
        document,
        (deck) => known?.get(deck.id) !== deckFingerprint(deck),
      ),
    );
  } catch (err) {
    if (!(err instanceof ServerRejectedError && err.status === 409)) throw err;
    serverDecks.delete(document.id);
    await sendChanges(toPresentationChanges(document));
  }

  rememberServerDecks(document);
}

/** 공유받은 세트의 최신본을 받았거나(`replaced`) 접근을 잃었을 때(`lost`) 알린다. */
export interface SharedPresentationListener {
  replaced: (document: PresentationDocument) => void;
  lost: (id: string) => void;
}

let sharedListener: SharedPresentationListener | null = null;

export function setSharedPresentationListener(
  next: SharedPresentationListener | null,
): void {
  sharedListener = next;
}

let sharedRefreshGeneration = 0;

/**
 * 공유받은 프레젠테이션의 최신본을 받는다 (편집기를 열 때·창에 돌아올 때).
 * 소유자가 링크를 끄거나 재설정했으면 로컬에서 지우도록 알린다. 오프라인이면
 * 받아 둔 것을 그대로 쓴다.
 *
 * 동기화 큐를 거치지 않는 요청이라 결과를 `shared` 도메인 상태로 직접 남긴다.
 * 이 상태는 공유받은 프레젠테이션을 보는 동안만 의미가 있으므로, 화면을 떠나면
 * `endSharedPresentationRefresh`로 지운다. 그 뒤에 도착한 응답은 상태를 남기지 않는다.
 */
export async function refreshSharedPresentation(id: string): Promise<void> {
  const generation = sharedRefreshGeneration;
  const report = (status: SyncStatus, requestId?: string): void => {
    if (generation === sharedRefreshGeneration) {
      setSyncStatus("shared", status, requestId);
    }
  };
  try {
    const body = await callSyncApi<{ presentation: unknown }>(() =>
      api.api.presentations[":id"].$get({ param: { id } }),
    );
    sharedListener?.replaced(
      PresentationDocumentSchema.parse(body.presentation),
    );
    report("synced");
  } catch (err) {
    if (err instanceof ServerRejectedError && err.status === 404) {
      sharedListener?.lost(id);
      report("synced");
      return;
    }
    report(
      isRetryableApiError(err) ? "offline" : "error",
      requestIdOfError(err),
    );
    if (err instanceof OfflineError) return;
    throw err;
  }
}

/**
 * 공유받은 프레젠테이션 화면을 떠날 때 부른다. 새로고침 결과는 그 화면에만 해당하는
 * 읽기라, 남겨 두면 내 프레젠테이션이 다 저장된 뒤에도 헤더가 '오프라인'·'동기화 실패'로 남는다.
 */
export function endSharedPresentationRefresh(): void {
  sharedRefreshGeneration += 1;
  setSyncStatus("shared", "idle");
}

export async function pullPresentations(): Promise<PresentationDocument[]> {
  const body = await callSyncApi<{ presentations: PresentationDocument[] }>(
    () => api.api.presentations.$get(),
  );
  return body.presentations;
}

/**
 * 보관함 곡 1건을 서버에 올리고 서버가 확정한 덱을 돌려받는다.
 *
 * 공유 필드(공개 여부·가져간 횟수·출처)는 서버가 정하므로, 호출자는 응답 덱을
 * 로컬에 반영해야 한다.
 */
export async function pushDeck(deck: Deck): Promise<Deck> {
  const body = await callSyncApi<{ deck: Deck }>(() =>
    api.api.decks[":id"].$put({ param: { id: deck.id }, json: deck }),
  );
  return DeckSchema.parse(body.deck);
}

/**
 * 보관함 곡을 서버에서 지운다. 서버가 지운 곡으로 기록했으면(200) true, 이 계정의 곡이 아니라고
 * 하면(404) false다.
 *
 * 서버는 한 번도 올라가지 않은 곡도 지운 곡으로 기록하고 200으로 답한다. 404는 다른 계정의
 * 쿠키로 보낸 요청처럼 이 계정으로는 지울 수 없을 때 온다. 실패로 남기지는 않지만, 호출자는
 * 곡 주인의 다음 부팅에 다시 보낼 수 있게 삭제 기록을 남긴다.
 */
export async function deleteDeckRemote(id: string): Promise<boolean> {
  try {
    await callSyncApi(() => api.api.decks[":id"].$delete({ param: { id } }));
    return true;
  } catch (err) {
    if (err instanceof ServerRejectedError && err.status === 404) return false;
    throw err;
  }
}

/**
 * 내 보관함 곡과 이 계정에서 지운 곡 id를 받는다.
 *
 * 곡은 검증하지 않고 넘긴다. 한 곡이 깨졌다고 보관함 전체를 받지 못하면 안 된다. 지운 곡 id는
 * 하나씩 걸러 형식이 맞는 것만 남긴다. 곡 삭제 기록을 남기기 전의 서버는 목록을 보내지 않는다.
 */
export async function pullDecks(): Promise<{
  decks: Deck[];
  deletedIds: string[];
}> {
  const body = await callSyncApi<DeckListResponse>(() => api.api.decks.$get());
  const deletedIds: unknown = body.deletedIds;
  return {
    decks: body.decks,
    deletedIds: Array.isArray(deletedIds)
      ? deletedIds.filter((id): id is string => IdSchema.safeParse(id).success)
      : [],
  };
}

/** 이미 없으면(404 — 한 번도 안 올라간 문서) 성공으로 본다 */
export async function deletePresentationRemote(id: string): Promise<void> {
  try {
    await callSyncApi(() =>
      api.api.presentations[":id"].$delete({ param: { id } }),
    );
  } catch (err) {
    if (!(err instanceof ServerRejectedError && err.status === 404)) throw err;
  }
  serverDecks.delete(id);
}

export async function pullFolders(): Promise<FolderListResponse> {
  return callSyncApi<FolderListResponse>(() => api.api.folders.$get());
}

/**
 * 폴더 1건을 서버에 올리고 서버가 확정한 폴더를 돌려받는다.
 * 서버는 없는 부모·사이클을 루트로 보정하므로 호출자는 응답을 반영해야 한다.
 */
export async function pushFolder(folder: Folder): Promise<Folder> {
  const body = await callSyncApi<{ folder: Folder }>(() =>
    api.api.folders[":id"].$put({ param: { id: folder.id }, json: folder }),
  );
  return FolderSchema.parse(body.folder);
}

/**
 * 폴더를 하위 폴더·프레젠테이션과 함께 서버에서 영구 삭제한다. `expected`는 이 기기가 본
 * 하위 트리(폴더 자신 포함)다.
 *
 * 서버는 그 폴더나 조상이 서버의 휴지통에 없거나, 서버 트리에 `expected` 밖의 항목(다른
 * 기기에서 옮겨 넣은 것 등)이 있으면 아무것도 지우지 않고 409로 거절한다. 409를 포함한 거절은
 * 서버 문장을 담아 그대로 던진다. 이미 없으면(404 — 한 번도 안 올라간 폴더) 지운 것이 없는
 * 성공으로 본다.
 */
export async function deleteFolderRemote(
  id: string,
  expected: NonNullable<FolderDeleteRequest["expected"]>,
): Promise<FolderDeleteResponse> {
  try {
    const body = await callSyncApi<unknown>(() =>
      api.api.folders[":id"].$delete({ param: { id }, json: { expected } }),
    );
    return FolderDeleteResponseSchema.parse(body);
  } catch (err) {
    if (err instanceof ServerRejectedError && err.status === 404) {
      return { ok: true, deletedFolderIds: [], deletedPresentationIds: [] };
    }
    throw err;
  }
}
