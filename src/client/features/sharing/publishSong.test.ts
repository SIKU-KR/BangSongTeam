import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Deck } from "#shared";
import { signInAsTestUser } from "../../test/sessionFixture";
import {
  getLibraryDeck,
  getUserSongs,
  hydrateSongLibrary,
  resetSongLibraryStore,
  saveSongToLibrary,
} from "../editor/songLibraryStore";
import { ServerRejectedError } from "../../lib/api/request";
import { __resetDeckSyncForTests } from "../../lib/sync/deckSync";
import {
  publishLibraryDeck,
  unpublishLibraryDeck,
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

describe("내 보관함 곡 공개", () => {
  beforeEach(async () => {
    signInAsTestUser();
    __resetDeckSyncForTests();
    await resetSongLibraryStore();
  });

  afterEach(() => {
    __resetDeckSyncForTests();
  });

  function addLibrarySong(): Deck {
    return saveSongToLibrary({
      title: "보관함 곡",
      lyricsRaw: "첫 줄\n\n둘째 슬라이드",
    });
  }

  it("uploads the library deck and then makes it public", async () => {
    const master = addLibrarySong();
    const deps = fakeDeps();

    const published = await publishLibraryDeck(master.id, deps);

    expect((deps.push.mock.calls[0][0] as Deck).id).toBe(master.id);
    expect(deps.setVisibility).toHaveBeenCalledWith(master.id, {
      visibility: "public",
      acceptedCopyrightNotice: true,
    });
    expect(published.visibility).toBe("public");
    expect(getLibraryDeck(master.id)?.visibility).toBe("public");
  });

  it("stays private when uploading fails", async () => {
    const master = addLibrarySong();
    const deps = fakeDeps();
    deps.push.mockRejectedValueOnce(new Error("offline"));

    await expect(publishLibraryDeck(master.id, deps)).rejects.toThrow(
      "offline",
    );
    expect(deps.setVisibility).not.toHaveBeenCalled();
    expect(getLibraryDeck(master.id)?.visibility).toBe("private");
  });

  it("rejects a deck that is not in the library", async () => {
    await expect(
      publishLibraryDeck("9000000000000000000zz", fakeDeps()),
    ).rejects.toThrow("보관함에서 곡을 찾을 수 없어요");
  });

  it("unpublishes", async () => {
    const master = addLibrarySong();
    const deps = fakeDeps();
    await publishLibraryDeck(master.id, deps);
    await unpublishLibraryDeck(master.id, deps);
    expect(getLibraryDeck(master.id)?.visibility).toBe("private");
  });

  it("다른 기기에서 지운 곡이라 올리기가 410이면 보관함에서 내려놓고 공개하지 않는다", async () => {
    const master = addLibrarySong();
    const deps = fakeDeps();
    deps.push.mockRejectedValueOnce(new ServerRejectedError(410, "지운 곡"));

    await expect(publishLibraryDeck(master.id, deps)).rejects.toBeInstanceOf(
      ServerRejectedError,
    );

    expect(deps.setVisibility).not.toHaveBeenCalled();
    expect(getLibraryDeck(master.id)).toBeUndefined();
    await hydrateSongLibrary();
    expect(getUserSongs()).toEqual([]);
  });

  it("공개 전환이 410이면 보관함에서 내려놓는다", async () => {
    const master = addLibrarySong();
    const deps = fakeDeps();
    deps.setVisibility.mockRejectedValueOnce(new ServerRejectedError(410));

    await expect(publishLibraryDeck(master.id, deps)).rejects.toBeInstanceOf(
      ServerRejectedError,
    );

    expect(getLibraryDeck(master.id)).toBeUndefined();
  });

  it("공개를 거두다 410이면 보관함에서 내려놓는다", async () => {
    const master = addLibrarySong();
    const deps = fakeDeps();
    deps.setVisibility.mockRejectedValueOnce(new ServerRejectedError(410));

    await expect(unpublishLibraryDeck(master.id, deps)).rejects.toBeInstanceOf(
      ServerRejectedError,
    );

    expect(getLibraryDeck(master.id)).toBeUndefined();
  });

  it("410이 아닌 거절은 곡을 그대로 둔다", async () => {
    const master = addLibrarySong();
    const deps = fakeDeps();
    deps.setVisibility.mockRejectedValueOnce(new ServerRejectedError(403));

    await expect(unpublishLibraryDeck(master.id, deps)).rejects.toBeInstanceOf(
      ServerRejectedError,
    );

    expect(getLibraryDeck(master.id)?.id).toBe(master.id);
  });
});
