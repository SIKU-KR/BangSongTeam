import {
  DeckSchema,
  PresentationDocumentSchema,
  type Deck,
  type Presentation,
  type PresentationDocument,
} from "@repo/shared";
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

/**
 * Hono RPC는 `ClientResponse`를 돌려준다. workers-types의 `Response`와는
 * 다른 타입이라 구조적으로만 받는다 (상태·본문만 쓰면 충분하다).
 */
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
    } catch {
      // 본문이 JSON이 아니면 상태 코드만으로 알린다
    }
    throw new ServerRejectedError(response.status, message);
  }

  return (await response.json()) as T;
}

/** 프레젠테이션 문서 1건을 서버에 올린다 */
export async function pushPresentation(
  presentation: Presentation,
): Promise<boolean> {
  const document = toSyncableDocument(presentation);
  if (!document) return false;

  await send(() =>
    api.api.presentations[":id"].$put({
      param: { id: document.id },
      json: document,
    }),
  );
  return true;
}

/** 내 프레젠테이션 전체를 서버에서 받아 온다 */
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

/** 보관함 곡 1건을 서버에서 지운다. 이미 없으면(404) 성공으로 본다 */
export async function deleteDeckRemote(id: string): Promise<void> {
  try {
    await send(() => api.api.decks[":id"].$delete({ param: { id } }));
  } catch (err) {
    if (err instanceof ServerRejectedError && err.status === 404) return;
    throw err;
  }
}

/** 내 보관함 곡 전체를 서버에서 받아 온다 */
export async function pullDecks(): Promise<Deck[]> {
  const body = await send<{ decks: Deck[] }>(() => api.api.decks.$get());
  return body.decks;
}
