import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageChangeKind } from "#shared";
import { installFakeBroadcastChannel } from "../../test/fakeBroadcastChannel";
import { signInAsTestUser } from "../../test/sessionFixture";
import { SEED_USER_ID } from "../../test/presentationFixture";
import { __resetStorageChannelForTests } from "../storage/storageChannel";
import {
  __resetStorageSyncForTests,
  listenForStorageChanges,
  resumeHeldStorageChanges,
  startStorageSync,
} from "./storageSync";

type Reload = (
  ids: readonly string[],
  isPaused: () => boolean,
) => Promise<string[]>;

const reloads = vi.hoisted(() => ({
  presentations: vi.fn<Reload>(),
  folders: vi.fn<Reload>(),
  decks: vi.fn<Reload>(),
}));

vi.mock(
  "../../features/presentation/presentationStore",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../features/presentation/presentationStore")
    >()),
    reloadPresentationsFromStorage: reloads.presentations,
  }),
);

vi.mock("../../features/drive/folderStore", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../features/drive/folderStore")
  >()),
  reloadFoldersFromStorage: reloads.folders,
}));

vi.mock("../../features/editor/songLibraryStore", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../features/editor/songLibraryStore")
  >()),
  reloadSongsFromStorage: reloads.decks,
}));

const CHANNEL = "chiton:storage";
const PROJECTION_PATH = "/present/p00000000000000000001/fullscreen";
const SET_A = "p00000000000000000001";
const SET_B = "p00000000000000000002";
const FOLDER = "a00000000000000000001";
const SONG = "c00000000000000000001";
const OTHER_USER = "999999999999999999999";

function change(
  kind: StorageChangeKind,
  ids: string[],
  userId: string = SEED_USER_ID,
): unknown {
  return { v: 1, userId, kind, ids };
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function reloadedIds(kind: StorageChangeKind): string[][] {
  return reloads[kind].mock.calls.map(([ids]) => [...ids]);
}

function readUntilReleased(): { release: () => void } {
  let release: () => void = () => undefined;
  reloads.presentations.mockImplementationOnce(async (ids, isPaused) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return isPaused() ? [...ids] : [];
  });
  return { release: () => release() };
}

describe("storageSync", () => {
  const startPath = window.location.pathname;
  let tabs: ReturnType<typeof installFakeBroadcastChannel>;

  beforeEach(() => {
    tabs = installFakeBroadcastChannel();
    __resetStorageChannelForTests();
    __resetStorageSyncForTests();
    signInAsTestUser();
    for (const reload of Object.values(reloads)) {
      reload.mockReset();
      reload.mockResolvedValue([]);
    }
  });

  afterEach(() => {
    __resetStorageSyncForTests();
    __resetStorageChannelForTests();
    vi.unstubAllGlobals();
    window.history.pushState({}, "", startPath);
  });

  it("알림의 종류마다 그 스토어가 저장본을 다시 읽게 한다", async () => {
    startStorageSync();
    const other = tabs.otherTab(CHANNEL);

    other.post(change("presentations", [SET_A]));
    other.post(change("folders", [FOLDER]));
    other.post(change("decks", [SONG]));
    await nextTask();

    expect(reloadedIds("presentations")).toEqual([[SET_A]]);
    expect(reloadedIds("folders")).toEqual([[FOLDER]]);
    expect(reloadedIds("decks")).toEqual([[SONG]]);
    other.close();
  });

  it("다른 사용자의 알림은 따르지 않는다", async () => {
    startStorageSync();
    const other = tabs.otherTab(CHANNEL);

    other.post(change("presentations", [SET_A], OTHER_USER));
    await nextTask();

    expect(reloads.presentations).not.toHaveBeenCalled();
    other.close();
  });

  it("여러 번 시작해도 알림마다 한 번만 다시 읽는다", async () => {
    listenForStorageChanges();
    startStorageSync();
    startStorageSync();
    const other = tabs.otherTab(CHANNEL);

    other.post(change("decks", [SONG]));
    await nextTask();

    expect(reloads.decks).toHaveBeenCalledTimes(1);
    other.close();
  });

  it("스토어를 싣는 동안 받은 알림은 모아 두었다가 시작하면 다시 읽는다", async () => {
    listenForStorageChanges();
    const other = tabs.otherTab(CHANNEL);

    other.post(change("presentations", [SET_A]));
    other.post(change("decks", [SONG]));
    await nextTask();
    resumeHeldStorageChanges();
    await nextTask();

    expect(reloads.presentations).not.toHaveBeenCalled();
    expect(reloads.decks).not.toHaveBeenCalled();

    startStorageSync();
    await nextTask();

    expect(reloadedIds("presentations")).toEqual([[SET_A]]);
    expect(reloadedIds("decks")).toEqual([[SONG]]);
    expect(reloads.folders).not.toHaveBeenCalled();
    other.close();
  });

  it("모아 둔 알림은 그 사이 다른 계정으로 바뀌었으면 다시 읽지 않는다", async () => {
    listenForStorageChanges();
    const other = tabs.otherTab(CHANNEL);

    other.post(change("presentations", [SET_A]));
    await nextTask();
    signInAsTestUser(OTHER_USER);
    startStorageSync();
    await nextTask();

    expect(reloads.presentations).not.toHaveBeenCalled();
    other.close();
  });

  it("송출 중에 받은 id는 모아 두었다가 송출을 마친 뒤에 한 번에 다시 읽는다", async () => {
    window.history.pushState({}, "", PROJECTION_PATH);
    startStorageSync();
    const other = tabs.otherTab(CHANNEL);

    other.post(change("presentations", [SET_A]));
    other.post(change("presentations", [SET_A, SET_B]));
    other.post(change("decks", [SONG]));
    await nextTask();
    resumeHeldStorageChanges();
    await nextTask();

    expect(reloads.presentations).not.toHaveBeenCalled();
    expect(reloads.decks).not.toHaveBeenCalled();

    window.history.pushState({}, "", "/presentations");
    resumeHeldStorageChanges();
    await nextTask();

    expect(reloadedIds("presentations")).toEqual([[SET_A, SET_B]]);
    expect(reloadedIds("decks")).toEqual([[SONG]]);
    expect(reloads.folders).not.toHaveBeenCalled();

    resumeHeldStorageChanges();
    await nextTask();
    expect(reloads.presentations).toHaveBeenCalledTimes(1);
    other.close();
  });

  it("다시 읽는 동안 송출을 시작하면 읽은 것을 싣지 않고 모아 두었다가 송출을 마친 뒤에 다시 읽는다", async () => {
    const read = readUntilReleased();
    startStorageSync();
    const other = tabs.otherTab(CHANNEL);

    other.post(change("presentations", [SET_A]));
    await nextTask();
    expect(reloads.presentations).toHaveBeenCalledTimes(1);

    window.history.pushState({}, "", PROJECTION_PATH);
    read.release();
    await nextTask();
    resumeHeldStorageChanges();
    await nextTask();

    expect(reloads.presentations).toHaveBeenCalledTimes(1);

    window.history.pushState({}, "", "/presentations");
    resumeHeldStorageChanges();
    await nextTask();

    expect(reloadedIds("presentations")).toEqual([[SET_A], [SET_A]]);
    other.close();
  });

  it("앞선 다시 읽기를 기다리는 동안 송출을 시작하면 그 뒤의 알림은 읽지 않고 모아 둔다", async () => {
    const read = readUntilReleased();
    startStorageSync();
    const other = tabs.otherTab(CHANNEL);

    other.post(change("presentations", [SET_A]));
    other.post(change("presentations", [SET_B]));
    await nextTask();
    window.history.pushState({}, "", PROJECTION_PATH);
    read.release();
    await nextTask();

    expect(reloadedIds("presentations")).toEqual([[SET_A]]);

    window.history.pushState({}, "", "/presentations");
    resumeHeldStorageChanges();
    await nextTask();

    expect(reloadedIds("presentations")).toEqual([[SET_A], [SET_A, SET_B]]);
    other.close();
  });

  it("다시 읽기마다 송출 중인지 묻는 판정을 스토어에 넘긴다", async () => {
    startStorageSync();
    const other = tabs.otherTab(CHANNEL);

    other.post(change("folders", [FOLDER]));
    await nextTask();
    const [, isPaused] = reloads.folders.mock.calls[0];

    expect(isPaused()).toBe(false);
    window.history.pushState({}, "", PROJECTION_PATH);
    expect(isPaused()).toBe(true);
    other.close();
  });

  it("같은 종류는 받은 순서대로 앞의 다시 읽기가 끝난 뒤에 다시 읽는다", async () => {
    const read = readUntilReleased();
    startStorageSync();
    const other = tabs.otherTab(CHANNEL);

    other.post(change("presentations", [SET_A]));
    other.post(change("presentations", [SET_B]));
    await nextTask();

    expect(reloadedIds("presentations")).toEqual([[SET_A]]);

    read.release();
    await nextTask();

    expect(reloadedIds("presentations")).toEqual([[SET_A], [SET_B]]);
    other.close();
  });
});
