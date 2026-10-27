import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageChangeKind } from "#shared";
import { installFakeBroadcastChannel } from "../../test/fakeBroadcastChannel";
import { signInAsTestUser } from "../../test/sessionFixture";
import { SEED_USER_ID } from "../../test/presentationFixture";
import { __resetStorageChannelForTests } from "../storage/storageChannel";
import {
  __resetStorageSyncForTests,
  resumeHeldStorageChanges,
  startStorageSync,
} from "./storageSync";

const reloads = vi.hoisted(() => ({
  presentations: vi.fn(async (ids: readonly string[]) => {
    void ids;
  }),
  folders: vi.fn(async (ids: readonly string[]) => {
    void ids;
  }),
  decks: vi.fn(async (ids: readonly string[]) => {
    void ids;
  }),
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
  ...(await importOriginal<typeof import("../../features/drive/folderStore")>()),
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
      reload.mockResolvedValue(undefined);
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

    expect(reloads.presentations).toHaveBeenCalledExactlyOnceWith([SET_A]);
    expect(reloads.folders).toHaveBeenCalledExactlyOnceWith([FOLDER]);
    expect(reloads.decks).toHaveBeenCalledExactlyOnceWith([SONG]);
    other.close();
  });

  it("다른 사용자의 알림은 따르지 않는다", async () => {
    startStorageSync();
    const other = tabs.otherTab(CHANNEL);

    other.post(change("presentations", [SET_A], "999999999999999999999"));
    await nextTask();

    expect(reloads.presentations).not.toHaveBeenCalled();
    other.close();
  });

  it("여러 번 시작해도 알림마다 한 번만 다시 읽는다", async () => {
    startStorageSync();
    startStorageSync();
    const other = tabs.otherTab(CHANNEL);

    other.post(change("decks", [SONG]));
    await nextTask();

    expect(reloads.decks).toHaveBeenCalledTimes(1);
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

    expect(reloads.presentations).toHaveBeenCalledExactlyOnceWith([
      SET_A,
      SET_B,
    ]);
    expect(reloads.decks).toHaveBeenCalledExactlyOnceWith([SONG]);
    expect(reloads.folders).not.toHaveBeenCalled();

    resumeHeldStorageChanges();
    await nextTask();
    expect(reloads.presentations).toHaveBeenCalledTimes(1);
    other.close();
  });

  it("같은 종류는 받은 순서대로 앞의 다시 읽기가 끝난 뒤에 다시 읽는다", async () => {
    let finishFirst: () => void = () => undefined;
    reloads.presentations.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        }),
    );
    startStorageSync();
    const other = tabs.otherTab(CHANNEL);

    other.post(change("presentations", [SET_A]));
    other.post(change("presentations", [SET_B]));
    await nextTask();

    expect(reloads.presentations).toHaveBeenCalledExactlyOnceWith([SET_A]);

    finishFirst();
    await nextTask();

    expect(reloads.presentations).toHaveBeenCalledTimes(2);
    expect(reloads.presentations).toHaveBeenLastCalledWith([SET_B]);
    other.close();
  });
});
