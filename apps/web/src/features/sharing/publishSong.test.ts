import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  DEFAULT_DECK_STYLE,
  DeckSchema,
  INITIAL_BACKGROUNDS,
  type Deck,
} from "@repo/shared";
import { signInAsTestUser } from "../../test/sessionFixture";
import {
  SEED_PRESENTATIONS,
  SEED_USER_ID,
} from "../presentation/mockPresentations";
import {
  __loadDocumentsForTests,
  addDeckToPresentation,
  getActivePresentation,
  resetPresentationStore,
  updateSlideLines,
  updateSongStyle,
} from "../presentation/presentationStore";
import {
  getLibraryDeck,
  getUserSongs,
  resetSongLibraryStore,
  saveSongToLibrary,
} from "../editor/songLibraryStore";
import {
  buildPublishedDeck,
  canContributeFromSong,
  hasUnpublishedChanges,
  publishSong,
  resolveLibraryMaster,
  unpublishSong,
  updatePublishedSong,
  type PublishDeps,
} from "./publishSong";

function fakeDeps(): PublishDeps & {
  push: ReturnType<typeof vi.fn>;
  setVisibility: ReturnType<typeof vi.fn>;
} {
  return {
    push: vi.fn(async (deck: Deck) => deck),
    setVisibility: vi.fn(async (id: string, request) => ({
      ...(getLibraryDeck(id) as Deck),
      visibility: request.visibility,
      publishedAt:
        request.visibility === "public" ? "2026-09-23T00:00:00.000Z" : null,
    })),
  };
}

describe("편집기 '공유' — 보관함 원본 공개", () => {
  beforeEach(async () => {
    signInAsTestUser();
    resetPresentationStore();
    __loadDocumentsForTests(SEED_PRESENTATIONS);
    await resetSongLibraryStore();
  });

  function addLibrarySong(): { index: number; master: Deck } {
    const master = saveSongToLibrary({
      title: "보관함 곡",
      lyricsRaw: "첫 줄\n\n둘째 슬라이드",
      backgroundId: INITIAL_BACKGROUNDS[1].id,
    });
    addDeckToPresentation(master);
    return { index: getActivePresentation().items.length - 1, master };
  }

  it("finds the library master through the set clone's forkedFrom", () => {
    const { index, master } = addLibrarySong();
    const song = getActivePresentation().items[index].deck!;
    expect(resolveLibraryMaster(song)?.id).toBe(master.id);
  });

  it("publishes the master with the set's current content", async () => {
    const { index, master } = addLibrarySong();
    updateSlideLines(index, 0, ["세트에서 고친 첫 줄"]);
    updateSongStyle(index, { overlayOpacity: 85 });

    const deps = fakeDeps();
    const published = await publishSong(index, {}, deps);

    const pushed = deps.push.mock.calls[0][0] as Deck;
    expect(pushed.id).toBe(master.id);
    expect(pushed.slides[0].lines).toEqual(["세트에서 고친 첫 줄"]);
    // 슬라이드에서 가사 원문을 다시 만든다
    expect(pushed.lyricsRaw).toBe("세트에서 고친 첫 줄\n\n둘째 슬라이드");
    expect(pushed.style.overlayOpacity).toBe(85);

    expect(deps.setVisibility).toHaveBeenCalledWith(master.id, {
      visibility: "public",
      acceptedCopyrightNotice: true,
    });
    expect(published.visibility).toBe("public");
    expect(getLibraryDeck(master.id)?.visibility).toBe("public");
  });

  it("creates and links a new library master for a pasted set song", async () => {
    const pasted = DeckSchema.parse({
      id: "90000000-0000-4000-8000-0000000000cc",
      userId: SEED_USER_ID,
      scope: "presentation",
      title: "붙여넣은 곡",
      lyricsRaw: "가사",
      slides: [{ id: "s1", order: 0, lines: ["가사"] }],
      backgroundId: null,
      style: DEFAULT_DECK_STYLE,
      createdAt: "2026-09-20T00:00:00.000Z",
      updatedAt: "2026-09-20T00:00:00.000Z",
    });
    addDeckToPresentation(pasted);
    const index = getActivePresentation().items.length - 1;

    const deps = fakeDeps();
    await publishSong(index, { contributeToCatalog: true }, deps);

    const created = getUserSongs()[0];
    expect(created).toMatchObject({
      scope: "library",
      title: "붙여넣은 곡",
      origin: "user",
      contributeToCatalog: true,
      visibility: "public",
    });
    expect(getActivePresentation().items[index].deck?.forkedFrom).toBe(
      created.id,
    );

    // 두 번째 공개는 같은 원본을 고친다 (새 덱을 또 만들지 않는다)
    await updatePublishedSong(index, deps);
    expect(getUserSongs()).toHaveLength(1);
  });

  it("stays private when uploading the master fails", async () => {
    const { index, master } = addLibrarySong();
    const deps = fakeDeps();
    deps.push.mockRejectedValueOnce(new Error("offline"));

    await expect(publishSong(index, {}, deps)).rejects.toThrow("offline");
    expect(deps.setVisibility).not.toHaveBeenCalled();
    expect(getLibraryDeck(master.id)?.visibility).toBe("private");
  });

  it("unpublishes the master", async () => {
    const { index, master } = addLibrarySong();
    const deps = fakeDeps();
    await publishSong(index, {}, deps);
    await unpublishSong(master.id, deps);
    expect(getLibraryDeck(master.id)?.visibility).toBe("private");
  });

  it("detects set edits that are not in the published copy yet", () => {
    const { index, master } = addLibrarySong();
    const song = () => getActivePresentation().items[index].deck!;
    expect(hasUnpublishedChanges(song(), master)).toBe(false);

    updateSongStyle(index, { fontSizeVw: 6 });
    expect(hasUnpublishedChanges(song(), master)).toBe(true);
  });

  it("never contributes forks or catalog imports as root versions", () => {
    const base = DeckSchema.parse({
      id: "90000000-0000-4000-8000-0000000000ee",
      userId: SEED_USER_ID,
      scope: "presentation",
      title: "포크 곡",
      lyricsRaw: "가사",
      slides: [{ id: "s1", order: 0, lines: ["가사"] }],
      backgroundId: null,
      style: DEFAULT_DECK_STYLE,
      origin: "fork",
      createdAt: "2026-09-20T00:00:00.000Z",
      updatedAt: "2026-09-20T00:00:00.000Z",
    });
    expect(canContributeFromSong(base)).toBe(false);
    expect(
      buildPublishedDeck(base, undefined, { contributeToCatalog: true })
        .contributeToCatalog,
    ).toBe(false);
    expect(canContributeFromSong({ ...base, origin: "catalog" })).toBe(false);
    expect(canContributeFromSong({ ...base, origin: undefined })).toBe(true);
  });
});
