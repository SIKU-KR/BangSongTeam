import { z } from "zod";
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
import { isProjecting } from "../../features/presentation/fullscreen";
import { isSyncedWithServer } from "../../features/presentation/presentationDocument";
import { setSyncStatus, type SyncStatus } from "./syncStatus";
import { cyrb53 } from "./contentHash";
import { relateVersions } from "./mergeDocuments";
import {
  confirmVersion,
  isKnownAncestor,
  noteOwnVersion,
} from "./presentationLineage";

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

interface KnownServerDecks {
  revision: number;
  fingerprints: Map<string, string>;
}

/**
 * 문서 id → 서버에 있다고 아는 판(`revision`)과 그 판의 덱 지문(덱 id → 지문). 메모리에만 둔다.
 *
 * 바뀐 덱만 올리는 기준이다. 모르는 문서(새로고침 직후 부팅 동기화 전 등)는
 * 모든 덱을 보낸다. 서버가 실제로 덱을 잃었으면(다른 기기에서 곡을 뺀 경우 등) 409를
 * 받고 모든 덱을 담아 다시 보내므로, 이 표가 틀려도 곡이 빠지지는 않는다.
 */
const serverDecks = new Map<string, KnownServerDecks>();

function deckFingerprint(deck: Deck): string {
  return cyrb53(JSON.stringify(deck));
}

function rememberServerDecks(
  document: PresentationDocument,
  revision: string,
): void {
  serverDecks.set(document.id, {
    revision: Date.parse(revision),
    fingerprints: new Map(
      document.items.map((item) => [item.deck.id, deckFingerprint(item.deck)]),
    ),
  });
}

/**
 * 서버에서 받은 문서들을 변경분 계산의 기준으로 삼는다 (부팅 동기화, 열려 있는 탭의 다시 받기).
 * 보기 전용 공유 세트는 올리지 않으므로 기억하지 않는다.
 *
 * 이미 아는 판보다 오래된 문서는 기준으로 삼지 않는다. 목록을 받는 사이 이 탭이 올려 서버가 더 새 판을
 * 확정했는데 그보다 먼저 받은 목록으로 기준을 되돌리면, 그 판에서 옛 내용으로 되돌린 곡(되돌리기 등)이
 * 바뀌지 않은 곡으로 보여 올라가지 않는다. 서버는 기준 판이 맞으니 저장을 받고, 서버에는 되돌리기 전 곡이
 * 남는다.
 */
export function rememberServerDocuments(documents: readonly unknown[]): void {
  for (const candidate of documents) {
    const parsed = PresentationDocumentSchema.safeParse(candidate);
    if (!parsed.success || parsed.data.access) continue;
    const known = serverDecks.get(parsed.data.id);
    if (known && known.revision > Date.parse(parsed.data.updatedAt)) continue;
    rememberServerDecks(parsed.data, parsed.data.updatedAt);
  }
}

export function __resetServerDecksForTests(): void {
  serverDecks.clear();
}

async function sendChanges(changes: PresentationChanges): Promise<unknown> {
  return callSyncApi<unknown>(() =>
    api.api.presentations[":id"].$patch({
      param: { id: changes.id },
      json: changes,
    }),
  );
}

function storedRevisionOf(body: unknown, sent: PresentationDocument): string {
  const updatedAt =
    typeof body === "object" && body !== null && "updatedAt" in body
      ? body.updatedAt
      : undefined;
  const parsed = z.iso.datetime().safeParse(updatedAt);
  return parsed.success ? parsed.data : sent.updatedAt;
}

function conflictingPresentationOf(
  err: ServerRejectedError,
): PresentationDocument | null {
  const body = err.body;
  const presentation =
    typeof body === "object" && body !== null && "presentation" in body
      ? body.presentation
      : undefined;
  const parsed = PresentationDocumentSchema.safeParse(presentation);
  return parsed.success ? parsed.data : null;
}

/**
 * 내 프레젠테이션을 올릴 때 스토어에 묻고 결과를 알리는 창구. 부팅 동기화가 등록하고 `stopSync`가
 * 뗀다.
 *
 * - `current`: 그 세트의 지금 판. 큐에 든 사본은 넣은 때의 판이라, 그사이 이 탭이 고쳤거나 다른
 *   탭이 쓴 저장본을 다시 읽었으면 낡았다. 낡은 판을 올리면 그 뒤의 수정을 서버에서 되돌린다.
 *   지운 세트면 없다고 답한다.
 * - `requeue`: 송출 중이거나 큐가 담긴 폴더를 올린 뒤 다른 폴더로 옮겨 지금 보내지 못한 그 세트를
 *   큐에 다시 넣는다.
 * - `saved`: 서버가 보낸 판(`sent`, 스토어의 그 객체)을 `stored` 판으로 받았다.
 * - `rebase`: 412의 서버 판이 이 탭이 만든 판이라, 지금 판을 그 판(`base`) 위에 얹어 다시 보낸다.
 * - `adopt`: 이 탭은 고친 것이 없고 서버 판이 앞섰다. 서버 판을 받는다.
 * - `conflict`: 양쪽 다 고쳤다. 이 탭의 편집을 사본으로 남기고 서버 판을 받는다.
 * - `gone`: 다른 곳에서 영구 삭제한 세트다(410).
 */
export interface OwnPresentationListener {
  current(id: string): Presentation | undefined;
  requeue(id: string): void;
  saved(sent: Presentation, stored: string): void;
  rebase(id: string, base: string): void;
  adopt(server: Presentation): void;
  conflict(server: Presentation): void;
  gone(id: string): void;
}

let ownListener: OwnPresentationListener | null = null;

export function setOwnPresentationListener(
  next: OwnPresentationListener | null,
): void {
  ownListener = next;
}

const MAX_REBASES = 2;

function folderOf(presentation: Presentation): string | null {
  return presentation.folderId ?? null;
}

type SendOutcome =
  | { kind: "saved"; stored: string }
  | { kind: "requeued" }
  | { kind: "gone"; error: ServerRejectedError }
  | {
      kind: "conflict";
      server: PresentationDocument;
      error: ServerRejectedError;
    };

async function sendPresentation(
  presentation: Presentation,
  listener: OwnPresentationListener | null,
): Promise<SendOutcome> {
  const document = toSyncableDocument(presentation);
  noteOwnVersion(presentation);
  const known = serverDecks.get(document.id);
  try {
    let body: unknown;
    try {
      body = await sendChanges(
        toPresentationChanges(
          document,
          (deck) => known?.fingerprints.get(deck.id) !== deckFingerprint(deck),
        ),
      );
    } catch (err) {
      if (!(err instanceof ServerRejectedError && err.status === 409)) {
        throw err;
      }
      serverDecks.delete(document.id);
      if (isProjecting()) {
        if (!listener) throw err;
        listener.requeue(document.id);
        return { kind: "requeued" };
      }
      body = await sendChanges(toPresentationChanges(document));
    }
    const stored = storedRevisionOf(body, document);
    rememberServerDecks(document, stored);
    return { kind: "saved", stored };
  } catch (err) {
    if (!(err instanceof ServerRejectedError)) throw err;
    if (err.status === 410) {
      serverDecks.delete(document.id);
      return { kind: "gone", error: err };
    }
    if (err.status !== 412) throw err;
    const server = conflictingPresentationOf(err);
    if (!server) throw err;
    return { kind: "conflict", server, error: err };
  }
}

/**
 * 세트를 서버에 올린다. 헤더와 곡 순서는 언제나, 덱은 서버에 마지막으로 올린 뒤
 * 바뀐 것만 보낸다. 서버가 모르는 곡이 있다고 하면(409) 모든 덱을 담아 한 번 더
 * 보낸다.
 *
 * 받은 사본이 아니라 스토어의 지금 판을 올린다(`OwnPresentationListener.current`). 그사이 지운
 * 세트나 공유받은 사본이 된 자리, 서버와 맞춘 판(`isSyncedWithServer`)은 요청 없이 끝낸다. 창구가
 * 없으면(부팅 동기화 전) 받은 사본을 올리고, 서버의 거절(412·410)은 그대로 던진다.
 *
 * 큐는 받은 사본의 폴더를 먼저 올린 뒤 부른다(`ensureFolderPushed`). 보낼 판(다시 얹은 판 포함)이
 * 그사이 다른 폴더로 옮겨졌으면 보내지 않고 큐에 다시 넣어, 큐가 그 폴더를 먼저 올리게 한다. 아직
 * 서버에 없는 폴더를 가리키면 서버가 루트로 옮겨 받고, 이 탭은 그 판을 맞춘 판으로 확정해 옮긴 뒤의
 * push가 아무것도 보내지 않아 다음 부팅에서 루트 자리가 이긴다.
 *
 * 저장 본문에 기준 판(`baseUpdatedAt`)을 싣는다. 서버가 받으면(200) 보낸 판과 서버가 남긴 판을
 * `saved`로 알린다. 판을 돌려주지 않는 이전 서버면 보낸 시각이 그 서버가 남긴 판이다. 그사이 다른
 * 곳에서 바꿔 서버가 쓰지 않았으면(412, 모든 덱을 다시 보낸 뒤도 같다) 서버가 돌려준 저장된 판을
 * 지금 판과 견준다(`relateVersions`).
 * - 이 탭이 이미 더 새 판을 받았으면 아무것도 하지 않는다.
 * - 내용이 같으면 그 판을 맞춘 판으로 확정한다.
 * - 서버 판이 이 탭이 만든 판이면(응답을 잃은 저장 등) 그 판 위에 얹어 다시 보낸다. 잇달아 두 번까지만
 *   다시 보내고, 그다음은 412를 영구 실패로 던진다. 송출 중이면 보내지 않고 큐에 다시 넣는다.
 * - 이 탭이 고친 것이 없으면 서버 판을 받고(`adopt`), 양쪽 다 고쳤으면 `conflict`로 둘 다 지킨다.
 * 412의 서버 판을 읽지 못하면 412를 영구 실패로 던진다. 영구 삭제한 세트라고 하면(410) 기억한 덱을
 * 잊고 `gone`으로 알린다.
 *
 * 송출 중에 409를 받으면 모든 덱을 다시 보내지 않고 큐에 다시 넣는다. 송출 화면은 요청이
 * 0건이어야 하고, 큐는 송출을 마친 뒤 모든 덱을 담아 올린다(기억한 덱 지문을 버렸다). 다시 넣는
 * 창구는 보내기 시작할 때 등록돼 있던 것이라, 보내는 동안 계정이 끝나 창구를 뗐어도(`stopSync`) 송출
 * 중에 다른 쿠키로 요청을 더 보내지 않는다. 창구 없이 보낸 push면 다시 보내지 않고 그 409를 던진다.
 *
 * 글 한도에 맞춘 문서를 올리고 그 문서의 덱 지문을 기억한다. 줄이기 전의 덱으로 기억하면
 * 줄인 곡을 올릴 때마다 바뀐 곡으로 보고 다시 보낸다. 보낸 판은 이 탭의 계보에 적는다
 * (`noteOwnVersion`). 서버가 받을 수 없는 문서면 요청 없이 `UnsyncableDocumentError`를 던진다.
 */
export async function pushPresentation(snapshot: Presentation): Promise<void> {
  const listener = ownListener;
  let presentation = listener ? listener.current(snapshot.id) : snapshot;
  let rebases = 0;
  while (
    presentation &&
    !presentation.access &&
    !isSyncedWithServer(presentation)
  ) {
    if (listener && folderOf(presentation) !== folderOf(snapshot)) {
      listener.requeue(presentation.id);
      return;
    }
    const outcome = await sendPresentation(presentation, listener);
    if (outcome.kind === "requeued") return;
    if (outcome.kind === "saved") {
      listener?.saved(presentation, outcome.stored);
      return;
    }
    if (!listener) throw outcome.error;
    if (outcome.kind === "gone") {
      listener.gone(presentation.id);
      return;
    }

    const { server } = outcome;
    const current = listener.current(presentation.id);
    if (!current || current.access) return;
    const relation = relateVersions(current, server, (fingerprint) =>
      isKnownAncestor(current.id, fingerprint),
    );
    if (relation === "skip") return;
    rememberServerDecks(server, server.updatedAt);
    if (relation === "same") {
      listener.saved(current, server.updatedAt);
      return;
    }
    if (relation === "behind") {
      listener.adopt(server);
      return;
    }
    if (relation === "diverged") {
      listener.conflict(server);
      return;
    }
    if (isProjecting()) {
      listener.requeue(current.id);
      return;
    }
    if (rebases >= MAX_REBASES) throw outcome.error;
    rebases += 1;
    confirmVersion(server);
    listener.rebase(current.id, server.updatedAt);
    presentation = listener.current(current.id);
    if (presentation?.baseUpdatedAt !== server.updatedAt) return;
  }
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
