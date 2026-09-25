import type { Deck, VisibilityUpdateRequest } from "#shared";
import {
  applyServerDeckFields,
  getLibraryDeck,
} from "../editor/songLibraryStore";
import { pushDeckNow } from "../../lib/sync/deckSync";
import { updateDeckVisibility } from "../../lib/api/catalogApi";

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

/**
 * 내 보관함 곡을 공유 라이브러리에 공개한다. 서버에 아직 없는 곡일 수 있어
 * 최신 내용을 먼저 올린 뒤 공개로 바꾼다. 세트에서 고친 내용은 보관함 원본에
 * 반영되지 않으므로 공개되는 것은 보관함에 있는 그대로다.
 */
export async function publishLibraryDeck(
  libraryDeckId: string,
  deps: PublishDeps = defaultDeps,
): Promise<Deck> {
  const deck = getLibraryDeck(libraryDeckId);
  if (!deck) throw new Error("보관함에서 곡을 찾을 수 없습니다");
  const saved = await deps.push(deck);
  const published = await deps.setVisibility(saved.id, {
    visibility: "public",
    acceptedCopyrightNotice: true,
  });
  applyServerDeckFields(published);
  return published;
}

/** 공개를 거둔다. 이미 가져간 사본은 남는다. */
export async function unpublishLibraryDeck(
  libraryDeckId: string,
  deps: PublishDeps = defaultDeps,
): Promise<Deck> {
  const saved = await deps.setVisibility(libraryDeckId, {
    visibility: "private",
  });
  applyServerDeckFields(saved);
  return saved;
}
