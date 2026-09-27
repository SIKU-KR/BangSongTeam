import {
  DeckSchema,
  FolderDeleteResponseSchema,
  FolderSchema,
  PresentationDocumentSchema,
  toPresentationChanges,
  type Deck,
  type Folder,
  type FolderDeleteResponse,
  type FolderListResponse,
  type Presentation,
  type PresentationChanges,
  type PresentationDocument,
} from "#shared";
import { api } from "../api/client";
import { setSyncStatus } from "./syncStatus";

/** 서버가 세션을 거절했다 (만료·로그아웃) */
export class SessionExpiredError extends Error {
  constructor() {
    super("세션이 만료되었습니다");
    this.name = "SessionExpiredError";
  }
}

/** 네트워크에 닿지 못했다 — 실패가 아니라 오프라인이다 */
export class OfflineError extends Error {
  constructor(cause?: unknown) {
    super("서버에 연결할 수 없습니다");
    this.name = "OfflineError";
    this.cause = cause;
  }
}

/**
 * 서버가 요청을 거절했다 (4xx·5xx). 상태 코드로 사유를 가를 수 있게 남긴다.
 * 메시지는 서버가 준 한국어 오류 문장이 있으면 그것을 쓴다.
 */
export class ServerRejectedError extends Error {
  readonly status: number;
  constructor(status: number, message?: string) {
    super(message ?? `서버가 요청을 거절했습니다 (${status})`);
    this.name = "ServerRejectedError";
    this.status = status;
  }
}

/**
 * 프레젠테이션을 서버가 받을 수 있는 문서로 좁힌다.
 *
 * 덱이 비어 있는 항목이 하나라도 있으면 서버의 `PresentationDocumentSchema`가
 * 거절한다. 여기서 걸러 내지 않으면 400을 받고 그 문서는 영영 안 올라간다.
 */
export function toSyncableDocument(
  presentation: Presentation,
): PresentationDocument | null {
  const result = PresentationDocumentSchema.safeParse(presentation);
  return result.success ? result.data : null;
}

interface RpcResponse {
  status: number;
  ok: boolean;
  json: () => Promise<unknown>;
}

export async function send<T>(request: () => Promise<RpcResponse>): Promise<T> {
  let response: RpcResponse;
  try {
    response = await request();
  } catch (err) {
    setSyncStatus("offline");
    throw new OfflineError(err);
  }

  if (response.status === 401) {
    setSyncStatus("error");
    throw new SessionExpiredError();
  }
  if (!response.ok) {
    setSyncStatus("error");
    let message: string | undefined;
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body?.error === "string") message = body.error;
    } catch (error) {
      void error;
    }
    throw new ServerRejectedError(response.status, message);
  }

  return (await response.json()) as T;
}

/**
 * 문서 id → (덱 id → 서버에 있다고 아는 덱의 지문). 메모리에만 둔다.
 *
 * 바뀐 덱만 올리는 기준이다. 모르는 문서(새로고침 직후 부팅 동기화 전 등)는
 * 모든 덱을 보낸다. 서버가 실제로 덱을 잃었으면(다른 기기에서 영구 삭제 등) 409를
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
  await send(() =>
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
 */
export async function pushPresentation(
  presentation: Presentation,
): Promise<boolean> {
  const document = toSyncableDocument(presentation);
  if (!document) return false;

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
  return true;
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

/**
 * 공유받은 세트의 최신본을 받는다 (편집기를 열 때·창에 돌아올 때).
 * 소유자가 링크를 끄거나 재설정했으면 로컬에서 지우도록 알린다. 오프라인이면
 * 받아 둔 것을 그대로 쓴다.
 */
export async function refreshSharedPresentation(id: string): Promise<void> {
  try {
    const body = await send<{ presentation: unknown }>(() =>
      api.api.presentations[":id"].$get({ param: { id } }),
    );
    sharedListener?.replaced(
      PresentationDocumentSchema.parse(body.presentation),
    );
    setSyncStatus("synced");
  } catch (err) {
    if (err instanceof ServerRejectedError && err.status === 404) {
      sharedListener?.lost(id);
      setSyncStatus("synced");
      return;
    }
    if (err instanceof OfflineError) return;
    throw err;
  }
}

export async function pullPresentations(): Promise<PresentationDocument[]> {
  const body = await send<{ presentations: PresentationDocument[] }>(() =>
    api.api.presentations.$get(),
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
  const body = await send<{ deck: Deck }>(() =>
    api.api.decks[":id"].$put({ param: { id: deck.id }, json: deck }),
  );
  return DeckSchema.parse(body.deck);
}

/** 이미 없으면(404) 성공으로 본다 */
export async function deleteDeckRemote(id: string): Promise<void> {
  try {
    await send(() => api.api.decks[":id"].$delete({ param: { id } }));
  } catch (err) {
    if (err instanceof ServerRejectedError && err.status === 404) return;
    throw err;
  }
}

export async function pullDecks(): Promise<Deck[]> {
  const body = await send<{ decks: Deck[] }>(() => api.api.decks.$get());
  return body.decks;
}

/** 이미 없으면(404 — 한 번도 안 올라간 문서) 성공으로 본다 */
export async function deletePresentationRemote(id: string): Promise<void> {
  try {
    await send(() => api.api.presentations[":id"].$delete({ param: { id } }));
  } catch (err) {
    if (!(err instanceof ServerRejectedError && err.status === 404)) throw err;
  }
  serverDecks.delete(id);
}

export async function pullFolders(): Promise<FolderListResponse> {
  return send<FolderListResponse>(() => api.api.folders.$get());
}

/**
 * 폴더 1건을 서버에 올리고 서버가 확정한 폴더를 돌려받는다.
 * 서버는 없는 부모·사이클을 루트로 보정하므로 호출자는 응답을 반영해야 한다.
 */
export async function pushFolder(folder: Folder): Promise<Folder> {
  const body = await send<{ folder: Folder }>(() =>
    api.api.folders[":id"].$put({ param: { id: folder.id }, json: folder }),
  );
  return FolderSchema.parse(body.folder);
}

/**
 * 폴더를 하위 폴더·프레젠테이션과 함께 서버에서 영구 삭제한다.
 * 이미 없으면(404 — 한 번도 안 올라간 폴더) 지운 것이 없는 성공으로 본다.
 */
export async function deleteFolderRemote(
  id: string,
): Promise<FolderDeleteResponse> {
  try {
    const body = await send<unknown>(() =>
      api.api.folders[":id"].$delete({ param: { id } }),
    );
    return FolderDeleteResponseSchema.parse(body);
  } catch (err) {
    if (err instanceof ServerRejectedError && err.status === 404) {
      return { ok: true, deletedFolderIds: [], deletedPresentationIds: [] };
    }
    throw err;
  }
}
