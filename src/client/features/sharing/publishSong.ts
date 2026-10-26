import type { Deck, VisibilityUpdateRequest } from "#shared";
import {
  applyServerDeckFields,
  dropDeletedLibraryDeck,
  getLibraryDeck,
} from "../editor/songLibraryStore";
import { isDeckDeletedError, pushDeckNow } from "../../lib/sync/deckSync";
import { updateDeckVisibility } from "../../lib/api/catalogApi";
import { SHARING_COPY } from "#copy/sharing";

export interface PublishDeps {
  push: (deck: Deck) => Promise<Deck>;
  setVisibility: (
    id: string,
    request: VisibilityUpdateRequest,
  ) => Promise<Deck>;
}

const defaultDeps: PublishDeps = {
  push: pushDeckNow,
  setVisibility: updateDeckVisibility,
};

async function dropIfDeleted<T>(
  libraryDeckId: string,
  request: Promise<T>,
): Promise<T> {
  try {
    return await request;
  } catch (err) {
    if (isDeckDeletedError(err)) dropDeletedLibraryDeck(libraryDeckId);
    throw err;
  }
}

/**
 * 내 보관함 곡을 공유 라이브러리에 공개한다. 서버에 아직 없는 곡일 수 있어
 * 최신 내용을 먼저 올린 뒤 공개로 바꾼다. 세트에서 고친 내용은 보관함 원본에
 * 반영되지 않으므로 공개되는 것은 보관함에 있는 그대로다.
 *
 * 서버가 이미 지운 곡이라고 답하면(410) 보관함에서 내려놓고 오류를 그대로 던진다. 다른 기기나
 * 탭에서 지운 곡이다. 송출 주소로 연 탭처럼 부팅 동기화가 돌지 않아 큐가 410을 알리지 못하는
 * 화면에서도 곡이 남지 않게 여기서 직접 내려놓는다.
 */
export async function publishLibraryDeck(
  libraryDeckId: string,
  deps: PublishDeps = defaultDeps,
): Promise<Deck> {
  const deck = getLibraryDeck(libraryDeckId);
  if (!deck) throw new Error(SHARING_COPY.library.deckNotFound);
  const saved = await dropIfDeleted(libraryDeckId, deps.push(deck));
  const published = await dropIfDeleted(
    libraryDeckId,
    deps.setVisibility(saved.id, {
      visibility: "public",
      acceptedCopyrightNotice: true,
    }),
  );
  applyServerDeckFields(published);
  return published;
}

/**
 * 공개를 거둔다. 이미 가져간 사본은 남는다. 서버가 이미 지운 곡이라고 답하면(410)
 * `publishLibraryDeck`처럼 보관함에서 내려놓는다.
 */
export async function unpublishLibraryDeck(
  libraryDeckId: string,
  deps: PublishDeps = defaultDeps,
): Promise<Deck> {
  const saved = await dropIfDeleted(
    libraryDeckId,
    deps.setVisibility(libraryDeckId, { visibility: "private" }),
  );
  applyServerDeckFields(saved);
  return saved;
}
