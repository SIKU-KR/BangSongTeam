import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DEFAULT_DECK_STYLE, DeckSchema, type Deck } from "@repo/shared";
import { signInAsTestUser } from "../../test/sessionFixture";
import { SEED_USER_ID as TEST_USER_ID } from "../../features/presentation";
import {
  getUserSongs,
  resetSongLibraryStore,
  saveSongToLibrary,
} from "../../features/editor/songLibraryStore";
import { shouldRunBootSync, runBootSync } from "./bootSync";
import {
  __resetDeckSyncForTests,
  __setDeckTransportForTests,
} from "./deckSync";
import { __resetSyncSchedulerForTests } from "./syncScheduler";

const presentationSync = vi.hoisted(() => ({
  pullPresentations: vi.fn(async () => []),
  pushPresentation: vi.fn(async () => true),
  pullDecks: vi.fn(async (): Promise<Deck[]> => []),
}));

vi.mock("./presentationSync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./presentationSync")>();
  return { ...actual, ...presentationSync };
});

function serverDeck(overrides: Partial<Deck> = {}): Deck {
  return DeckSchema.parse({
    id: "c0000000-0000-4000-8000-0000000000ff",
    userId: TEST_USER_ID,
    scope: "library",
    title: "다른 PC에서 만든 곡",
    lyricsRaw: "가사",
    slides: [],
    backgroundId: null,
    style: DEFAULT_DECK_STYLE,
    visibility: "public",
    forkCount: 2,
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
    ...overrides,
  });
}

describe("shouldRunBootSync", () => {
  it("skips projection windows to keep Zero-Fetch", () => {
    expect(shouldRunBootSync("/present/abc/fullscreen")).toBe(false);
    expect(shouldRunBootSync("/present/abc/fullscreen/")).toBe(false);
  });

  it("runs on editing screens and the worship prep screen", () => {
    expect(shouldRunBootSync("/presentations")).toBe(true);
    expect(shouldRunBootSync("/editor/abc")).toBe(true);
    expect(shouldRunBootSync("/present/abc/ready")).toBe(true);
  });
});

describe("runBootSync — library decks (M5-2)", () => {
  let push: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    signInAsTestUser();
    await resetSongLibraryStore();
    __resetDeckSyncForTests();
    __resetSyncSchedulerForTests();
    push = vi.fn(async (deck: Deck) => deck);
    __setDeckTransportForTests({ push });
    presentationSync.pullDecks.mockResolvedValue([]);
  });

  afterEach(() => {
    __resetDeckSyncForTests();
    __resetSyncSchedulerForTests();
  });

  it("adopts library decks from the server", async () => {
    presentationSync.pullDecks.mockResolvedValue([serverDeck()]);
    await runBootSync();
    expect(getUserSongs().map((d) => d.title)).toEqual(["다른 PC에서 만든 곡"]);
    expect(getUserSongs()[0].forkCount).toBe(2);
  });

  it("uploads local-only decks (first sign-in after M5)", async () => {
    // 부팅 전 로컬에만 있던 곡. 동기화가 꺼져 있어 예약 push는 없다.
    const local = saveSongToLibrary({ title: "로컬 곡", lyricsRaw: "가사" });
    await runBootSync();
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0].id).toBe(local.id);
  });

  it("keeps working when the deck pull fails", async () => {
    presentationSync.pullDecks.mockRejectedValue(new Error("500"));
    const local = saveSongToLibrary({ title: "로컬 곡", lyricsRaw: "가사" });
    await runBootSync();
    expect(getUserSongs().map((d) => d.id)).toEqual([local.id]);
  });
});
