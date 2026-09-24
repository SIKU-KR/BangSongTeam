import {
  createId,
  DeckSchema,
  mergeSlidesToLyrics,
  type Deck,
  type VisibilityUpdateRequest,
} from "#shared";
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

/**
 * 세트 곡이 복제해 온 내 보관함 덱.
 */
export function resolveLibraryMaster(song: Deck): Deck | undefined {
  if (!song.forkedFrom) return undefined;
  const deck = getLibraryDeck(song.forkedFrom);
  return deck && deck.userId === song.userId ? deck : undefined;
}

function contentOf(song: Deck) {
  const slides = [...song.slides]
    .sort((a, b) => a.order - b.order)
    .map((slide, order) => ({ ...slide, lines: [...slide.lines], order }));
  return {
    title: song.title,
    artist: song.artist,
    slides,
    lyricsRaw: mergeSlidesToLyrics(slides),
    style: JSON.parse(JSON.stringify(song.style)) as Deck["style"],
    backgroundId: song.backgroundId,
  };
}

/** 세트 곡 내용을 반영한 보관함 덱 (원본이 없으면 새로 만든다). */
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

/** 세트 곡이 보관함 원본과 달라졌는지 확인한다. */
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

async function syncMaster(songIndex: number, deps: PublishDeps): Promise<Deck> {
  const song = songAt(songIndex);
  const master = resolveLibraryMaster(song);
  const next = buildPublishedDeck(song, master);

  upsertLibraryDeck(next, { push: false });
  if (!master) linkSongToLibraryDeck(songIndex, next.id);

  return deps.push(next);
}

/**
 * 세트 곡을 공유 라이브러리에 공개한다.
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

/** 이미 공개한 곡에 세트에서 고친 내용을 반영한다. */
export async function updatePublishedSong(
  songIndex: number,
  deps: PublishDeps = defaultDeps,
): Promise<Deck> {
  return syncMaster(songIndex, deps);
}

/** 공개를 거둔다. 이미 가져간 사본은 남는다. */
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
