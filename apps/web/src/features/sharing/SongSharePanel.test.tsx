import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Deck } from "@repo/shared";
import { signInAsTestUser } from "../../test/sessionFixture";
import { withQueryClient } from "../../test/queryClientFixture";
import { installFakeApi, type FakeApi } from "../../test/fakeApi";
import {
  SEED_PRESENTATIONS,
  __loadDocumentsForTests,
  addDeckToPresentation,
  getActivePresentation,
  resetPresentationStore,
  updateSongStyle,
} from "../presentation";
import {
  getLibraryDeck,
  resetSongLibraryStore,
  saveSongToLibrary,
  upsertLibraryDeck,
} from "../editor/songLibraryStore";
import { __resetDeckSyncForTests } from "../../lib/sync/deckSync";
import { SongSharePanel } from "./SongSharePanel";

describe("SongSharePanel (편집기 '공유')", () => {
  let api: FakeApi;

  beforeEach(async () => {
    signInAsTestUser();
    resetPresentationStore();
    __loadDocumentsForTests(SEED_PRESENTATIONS);
    await resetSongLibraryStore();
    __resetDeckSyncForTests();

    api = installFakeApi({
      "PUT /api/decks/*": ({ body }) => ({
        body: { ok: true, deck: body },
      }),
      "PATCH /api/decks/*/visibility": ({ url, body }) => {
        const id = url.pathname.split("/")[3];
        const visibility = (body as { visibility: string }).visibility;
        return {
          body: {
            deck: {
              ...(getLibraryDeck(id) as Deck),
              visibility,
              publishedAt:
                visibility === "public" ? "2026-09-23T00:00:00.000Z" : null,
            },
          },
        };
      },
      "POST /api/reports": () => ({
        status: 201,
        body: { id: "e00000006000000000001" },
      }),
    });
  });

  afterEach(() => {
    api.restore();
    __resetDeckSyncForTests();
  });

  function addSong(): { index: number; master: Deck } {
    const master = saveSongToLibrary({
      title: "공유할 곡",
      lyricsRaw: "첫 줄\n\n둘째 줄",
    });
    addDeckToPresentation(master);
    return { index: getActivePresentation().items.length - 1, master };
  }

  function renderPanel(index: number) {
    const song = getActivePresentation().items[index].deck!;
    return render(
      withQueryClient(<SongSharePanel songIndex={index} song={song} />),
    );
  }

  it("shows a private song and requires copyright consent before publishing", async () => {
    const { index, master } = addSong();
    renderPanel(index);

    expect(screen.getByTestId("song-share-status")).toHaveTextContent("비공개");
    fireEvent.click(screen.getByTestId("song-share-publish-btn"));

    const confirm = screen.getByTestId("publish-confirm-btn");
    expect(confirm).toBeDisabled();
    expect(screen.getByText(/CCLI/)).toBeInTheDocument();
    expect(screen.getByText(/세트의 내용으로 바뀝니다/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("publish-accept-checkbox"));
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(screen.getByTestId("song-share-status")).toHaveTextContent(
        "공개 중 · 0회 가져감",
      ),
    );
    const patch = api.calls.find((c) => c.method === "PATCH");
    expect(patch?.path).toBe(`/api/decks/${master.id}/visibility`);
    expect(patch?.body).toEqual({
      visibility: "public",
      acceptedCopyrightNotice: true,
    });
    const putIndex = api.calls.findIndex((c) => c.method === "PUT");
    expect(putIndex).toBeGreaterThanOrEqual(0);
    expect(putIndex).toBeLessThan(api.calls.indexOf(patch!));
  });

  it("offers '공개본 업데이트' when the set copy has changed", () => {
    const { index, master } = addSong();
    upsertLibraryDeck({ ...master, visibility: "public" }, { push: false });
    updateSongStyle(index, { overlayOpacity: 90 });
    renderPanel(index);

    expect(screen.getByTestId("song-share-update-btn")).toBeInTheDocument();
    expect(screen.getByTestId("song-share-unpublish-btn")).toBeInTheDocument();
  });

  it("unpublishes", async () => {
    const { index, master } = addSong();
    upsertLibraryDeck({ ...master, visibility: "public" }, { push: false });
    renderPanel(index);

    fireEvent.click(screen.getByTestId("song-share-unpublish-btn"));
    await waitFor(() =>
      expect(getLibraryDeck(master.id)?.visibility).toBe("private"),
    );
  });

  it("shows taken-down songs without a publish button", () => {
    const { index, master } = addSong();
    upsertLibraryDeck(
      { ...master, takedownAt: "2026-09-23T00:00:00.000Z" },
      { push: false },
    );
    renderPanel(index);

    expect(screen.getByTestId("song-share-status")).toHaveTextContent(
      "게시 중단됨",
    );
    expect(
      screen.queryByTestId("song-share-publish-btn"),
    ).not.toBeInTheDocument();
  });

  it("credits the original author and sends manual correction suggestions", async () => {
    const source = "c000000060000000000aa";
    const fork = saveSongToLibrary({ title: "가져온 곡", lyricsRaw: "가사" });
    upsertLibraryDeck(
      {
        ...fork,
        origin: "fork",
        forkedFrom: source,
        forkedFromAuthorName: "김찬양",
      },
      { push: false },
    );
    addDeckToPresentation(getLibraryDeck(fork.id)!);
    renderPanel(getActivePresentation().items.length - 1);

    expect(screen.getByTestId("song-share-attribution")).toHaveTextContent(
      "원작: 김찬양",
    );
    fireEvent.click(screen.getByTestId("song-share-correction-btn"));
    expect(screen.getByTestId("report-reason-correction")).toBeChecked();
    fireEvent.change(screen.getByTestId("report-details-input"), {
      target: { value: "2절 둘째 줄은 '주의 사랑'입니다" },
    });
    fireEvent.click(screen.getByTestId("report-submit-btn"));

    await screen.findByTestId("report-dialog-done");
    expect(api.calls.find((c) => c.path === "/api/reports")?.body).toEqual({
      targetType: "deck",
      targetId: source,
      reason: "correction",
      details: "2절 둘째 줄은 '주의 사랑'입니다",
    });
  });

  it("does not offer a lyric-library contribution option", () => {
    const { index } = addSong();
    renderPanel(index);

    fireEvent.click(screen.getByTestId("song-share-publish-btn"));
    expect(
      screen.queryByTestId("publish-contribute-checkbox"),
    ).not.toBeInTheDocument();
  });

  it("disables sharing while offline", () => {
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const { index } = addSong();
    renderPanel(index);

    expect(screen.getByTestId("song-share-publish-btn")).toBeDisabled();
    expect(
      screen.getByText("공유는 온라인에서만 할 수 있습니다."),
    ).toBeInTheDocument();
    onLine.mockRestore();
  });
});
