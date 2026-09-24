import {
  createId,
  DeckSchema,
  mergeSlidesToLyrics,
  type Deck,
  type VisibilityUpdateRequest,
} from "@repo/shared";
import {
  getActivePresentation,
  linkSongToLibraryDeck,
} from "../presentation/presentationStore";
import {
  applyServerDeckFields,
  getLibraryDeck,
  upsertLibraryDeck,
} from "../editor/songLibraryStore";
import { pushDeckNow } from "../../lib/sync/deckSync";
import { updateDeckVisibility } from "../../lib/api/catalogApi";

// ============================================================================
// 편집기 '공유' — 세트 곡을 보관함 원본으로 공개한다 (M5, PRD 4.7)
//
// 공유 단위는 보관함 덱이다. 세트 곡은 그 세트 전용 복제본이라 세트를 지우면
// 함께 사라지고, 같은 곡을 여러 세트에 담으면 공개본이 여러 개 생긴다. 그래서
// 세트 곡의 현재 내용(가사·슬라이드·배경·스타일)을 보관함 원본에 반영한 뒤
// 그 원본을 공개한다.
// ============================================================================

/**
 * 세트 곡이 복제해 온 내 보관함 덱.
 * 세트 복제본의 `forkedFrom`이 그 id다 (`cloneDeckForPresentation`).
 */
export function resolveLibraryMaster(song: Deck): Deck | undefined {
  if (!song.forkedFrom) return undefined;
  const deck = getLibraryDeck(song.forkedFrom);
  return deck && deck.userId === song.userId ? deck : undefined;
}

/** 공개본에 담을 곡 내용 (세트 곡 기준) */
function contentOf(song: Deck) {
  const slides = [...song.slides]
    .sort((a, b) => a.order - b.order)
    .map((slide, order) => ({ ...slide, lines: [...slide.lines], order }));
  return {
    title: song.title,
    artist: song.artist,
    slides,
    // 세트 곡의 `lyricsRaw`는 슬라이드 편집을 따라가지 않는다. 슬라이드에서 다시 만든다.
    lyricsRaw: mergeSlidesToLyrics(slides),
    style: JSON.parse(JSON.stringify(song.style)) as Deck["style"],
    backgroundId: song.backgroundId,
  };
}

/** 세트 곡 내용을 반영한 보관함 덱 (원본이 없으면 새로 만든다) */
export function buildPublishedDeck(song: Deck, master: Deck | undefined): Deck {
  const now = new Date().toISOString();
  const content = contentOf(song);

  if (master) {
    return DeckSchema.parse({
      ...master,
      ...content,
      updatedAt: now,
    });
  }

  return DeckSchema.parse({
    id: createId(),
    userId: song.userId,
    scope: "library",
    presentationId: null,
    ...content,
    visibility: "private",
    forkedFrom: null,
    forkedFromAuthorName: song.forkedFromAuthorName ?? null,
    forkCount: 0,
    origin: "user",
    createdAt: now,
    updatedAt: now,
  });
}

/** 세트 곡이 공개본(보관함 원본)과 달라졌는가 — '공개본 업데이트' 버튼 표시 */
export function hasUnpublishedChanges(song: Deck, master: Deck): boolean {
  const a = contentOf(song);
  const b = contentOf(master);
  return (
    a.title !== b.title ||
    a.artist !== b.artist ||
    a.backgroundId !== b.backgroundId ||
    JSON.stringify(a.slides.map((s) => s.lines)) !==
      JSON.stringify(b.slides.map((s) => s.lines)) ||
    JSON.stringify(a.style) !== JSON.stringify(b.style)
  );
}

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

function songAt(songIndex: number): Deck {
  const song = getActivePresentation().items[songIndex]?.deck;
  if (!song) throw new Error("곡을 찾을 수 없습니다");
  return song;
}

/** 세트 곡 내용을 보관함 원본에 반영하고 서버에 올린다 */
async function syncMaster(songIndex: number, deps: PublishDeps): Promise<Deck> {
  const song = songAt(songIndex);
  const master = resolveLibraryMaster(song);
  const next = buildPublishedDeck(song, master);

  upsertLibraryDeck(next, { push: false });
  // 보관함 원본이 없던 곡(붙여넣기로 바로 담은 곡 등)은 새 원본에 연결해 둔다.
  // 다음 '공개본 업데이트'가 같은 원본을 고친다.
  if (!master) linkSongToLibraryDeck(songIndex, next.id);

  // 공개 전환은 서버에 이 내용이 있어야 의미가 있다. 디바운스 큐가 아니라 바로 올린다.
  return deps.push(next);
}

/**
 * 세트 곡을 공유 라이브러리에 공개한다.
 *
 * 저작권 안내 동의는 호출 전에 `PublishDialog`가 받는다. 서버에 올리는 데
 * 실패하면 공개 요청을 보내지 않으므로, 실패는 언제나 '비공개로 남음'이다.
 */
export async function publishSong(
  songIndex: number,
  deps: PublishDeps = defaultDeps,
): Promise<Deck> {
  const saved = await syncMaster(songIndex, deps);
  const published = await deps.setVisibility(saved.id, {
    visibility: "public",
    acceptedCopyrightNotice: true,
  });
  applyServerDeckFields(published);
  return published;
}

/** 이미 공개한 곡에 세트에서 고친 내용을 반영한다 (공개 상태는 서버가 유지한다) */
export async function updatePublishedSong(
  songIndex: number,
  deps: PublishDeps = defaultDeps,
): Promise<Deck> {
  return syncMaster(songIndex, deps);
}

/** 공개를 거둔다. 이미 가져간 사본은 남는다 (PRD 4.7) */
export async function unpublishSong(
  libraryDeckId: string,
  deps: PublishDeps = defaultDeps,
): Promise<Deck> {
  const saved = await deps.setVisibility(libraryDeckId, {
    visibility: "private",
  });
  applyServerDeckFields(saved);
  return saved;
}
