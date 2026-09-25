import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Deck } from "#shared";
import { signInAsTestUser } from "../../test/sessionFixture";
import { withQueryClient } from "../../test/queryClientFixture";
import { installFakeApi, type FakeApi } from "../../test/fakeApi";
import {
  getLibraryDeck,
  resetSongLibraryStore,
  saveSongToLibrary,
  upsertLibraryDeck,
  useLibraryDeck,
} from "../editor/songLibraryStore";
import { __resetDeckSyncForTests } from "../../lib/sync/deckSync";
import { LibraryShareControls } from "./LibraryShareControls";

function LiveControls({ id }: { id: string }): React.JSX.Element | null {
  const deck = useLibraryDeck(id);
  return deck ? <LibraryShareControls deck={deck} /> : null;
}

describe("LibraryShareControls (내 보관함 곡 공개)", () => {
  let api: FakeApi;

  beforeEach(async () => {
    signInAsTestUser();
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

  function addSong(): Deck {
    return saveSongToLibrary({
      title: "공유할 곡",
      lyricsRaw: "첫 줄\n\n둘째 줄",
    });
  }

  function renderControls(id: string) {
    return render(withQueryClient(<LiveControls id={id} />));
  }

  it("requires copyright consent, uploads, then publishes the library deck", async () => {
    const deck = addSong();
    renderControls(deck.id);

    expect(screen.getByTestId("song-share-status")).toHaveTextContent("비공개");
    fireEvent.click(screen.getByTestId("song-share-publish-btn"));

    const confirm = screen.getByTestId("publish-confirm-btn");
    expect(confirm).toBeDisabled();
    expect(screen.getByText(/CCLI/)).toBeInTheDocument();
    expect(screen.getByText(/보관함에 있는 이 곡 그대로/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("publish-accept-checkbox"));
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(screen.getByTestId("song-share-status")).toHaveTextContent(
        "공개 중 · 0회 가져감",
      ),
    );
    const patch = api.calls.find((c) => c.method === "PATCH");
    expect(patch?.path).toBe(`/api/decks/${deck.id}/visibility`);
    expect(patch?.body).toEqual({
      visibility: "public",
      acceptedCopyrightNotice: true,
    });
    const putIndex = api.calls.findIndex((c) => c.method === "PUT");
    expect(putIndex).toBeGreaterThanOrEqual(0);
    expect(putIndex).toBeLessThan(api.calls.indexOf(patch!));
    expect(screen.queryByTestId("publish-dialog")).not.toBeInTheDocument();
  });

  it("unpublishes", async () => {
    const deck = addSong();
    upsertLibraryDeck({ ...deck, visibility: "public" }, { push: false });
    renderControls(deck.id);

    fireEvent.click(screen.getByTestId("song-share-unpublish-btn"));
    await waitFor(() =>
      expect(getLibraryDeck(deck.id)?.visibility).toBe("private"),
    );
    expect(screen.getByTestId("song-share-status")).toHaveTextContent("비공개");
  });

  it("shows taken-down songs without publish controls", () => {
    const deck = addSong();
    upsertLibraryDeck(
      { ...deck, takedownAt: "2026-09-23T00:00:00.000Z" },
      { push: false },
    );
    renderControls(deck.id);

    expect(screen.getByTestId("song-share-status")).toHaveTextContent(
      "게시 중단됨",
    );
    expect(
      screen.queryByTestId("song-share-publish-btn"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("song-share-unpublish-btn"),
    ).not.toBeInTheDocument();
  });

  it("sends a correction suggestion to the original of a forked song", async () => {
    const source = "c000000060000000000aa";
    const fork = addSong();
    upsertLibraryDeck(
      {
        ...fork,
        origin: "fork",
        forkedFrom: source,
        forkedFromAuthorName: "김찬양",
      },
      { push: false },
    );
    renderControls(fork.id);

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

  it("does not offer correction for songs the user wrote", () => {
    const deck = addSong();
    renderControls(deck.id);
    expect(
      screen.queryByTestId("song-share-correction-btn"),
    ).not.toBeInTheDocument();
  });

  it("disables sharing while offline", () => {
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const deck = addSong();
    renderControls(deck.id);

    expect(screen.getByTestId("song-share-publish-btn")).toBeDisabled();
    expect(
      screen.getByText("공유는 온라인에서만 할 수 있습니다."),
    ).toBeInTheDocument();
    onLine.mockRestore();
  });
});
