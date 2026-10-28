import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeBroadcastChannel } from "../../test/fakeBroadcastChannel";
import { signInAsTestUser, signOutForTests } from "../../test/sessionFixture";
import { SEED_USER_ID } from "../../test/presentationFixture";
import {
  __resetStorageChannelForTests,
  announcePull,
  announceStorageChange,
  subscribeStorageChanges,
} from "./storageChannel";

const CHANNEL = "chiton:storage";
const FIRST = "p00000000000000000001";
const SECOND = "p00000000000000000002";

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("storageChannel", () => {
  let tabs: ReturnType<typeof installFakeBroadcastChannel>;

  beforeEach(() => {
    tabs = installFakeBroadcastChannel();
    __resetStorageChannelForTests();
    signInAsTestUser();
  });

  afterEach(() => {
    __resetStorageChannelForTests();
    vi.unstubAllGlobals();
  });

  it("쓴 기록의 id를 지금 사용자 id와 메시지 판 번호를 붙여 다른 탭에 알린다", async () => {
    const other = tabs.otherTab(CHANNEL);

    announceStorageChange("presentations", [FIRST, SECOND]);
    await nextTask();

    expect(other.received).toEqual([
      {
        v: 1,
        userId: SEED_USER_ID,
        kind: "presentations",
        ids: [FIRST, SECOND],
      },
    ]);
    other.close();
  });

  it("다른 탭이 알린 기록을 받고, 이 탭이 알린 기록은 이 탭이 다시 받지 않는다", async () => {
    const received = vi.fn();
    subscribeStorageChanges(received);
    const other = tabs.otherTab(CHANNEL);

    announceStorageChange("folders", [FIRST]);
    other.post({ v: 1, userId: SEED_USER_ID, kind: "decks", ids: [SECOND] });
    await nextTask();

    expect(received).toHaveBeenCalledExactlyOnceWith({
      v: 1,
      userId: SEED_USER_ID,
      kind: "decks",
      ids: [SECOND],
    });
    other.close();
  });

  it("모양이 맞지 않거나 모르는 판의 메시지는 버린다", async () => {
    const received = vi.fn();
    subscribeStorageChanges(received);
    const other = tabs.otherTab(CHANNEL);

    other.post({ v: 2, userId: SEED_USER_ID, kind: "decks", ids: [FIRST] });
    other.post({ v: 1, userId: SEED_USER_ID, kind: "backgrounds", ids: [] });
    other.post({ v: 1, userId: SEED_USER_ID, kind: "decks", ids: ["짧은 id"] });
    other.post({ v: 1, userId: "", kind: "decks", ids: [FIRST] });
    other.post({ v: 1, kind: "decks", ids: [FIRST] });
    other.post("프레젠테이션을 바꿨어요");
    await nextTask();

    expect(received).not.toHaveBeenCalled();
    other.close();
  });

  it("구독을 풀면 더 받지 않는다", async () => {
    const received = vi.fn();
    const unsubscribe = subscribeStorageChanges(received);
    const other = tabs.otherTab(CHANNEL);

    unsubscribe();
    other.post({ v: 1, userId: SEED_USER_ID, kind: "decks", ids: [FIRST] });
    await nextTask();

    expect(received).not.toHaveBeenCalled();
    other.close();
  });

  it("서버에서 내 데이터를 다시 받았다고 지금 사용자 id와 함께 알리고, 다른 탭은 그 알림을 받는다", async () => {
    const received = vi.fn();
    subscribeStorageChanges(received);
    const other = tabs.otherTab(CHANNEL);

    announcePull();
    other.post({ v: 1, userId: SEED_USER_ID, kind: "pulled", ids: [] });
    await nextTask();

    expect(other.received).toEqual([
      { v: 1, userId: SEED_USER_ID, kind: "pulled", ids: [] },
    ]);
    expect(received).toHaveBeenCalledExactlyOnceWith({
      v: 1,
      userId: SEED_USER_ID,
      kind: "pulled",
      ids: [],
    });
    other.close();
  });

  it("로그인하지 않았으면 다시 받았다고 알리지 않는다", async () => {
    const other = tabs.otherTab(CHANNEL);

    signOutForTests();
    announcePull();
    await nextTask();

    expect(other.received).toEqual([]);
    other.close();
  });

  it("로그인하지 않았거나 알릴 id가 없으면 보내지 않는다", async () => {
    const other = tabs.otherTab(CHANNEL);

    announceStorageChange("presentations", []);
    signOutForTests();
    announceStorageChange("presentations", [FIRST]);
    await nextTask();

    expect(other.received).toEqual([]);
    other.close();
  });

  it("BroadcastChannel이 없는 브라우저에서는 알리기·받기가 아무것도 하지 않는다", () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    __resetStorageChannelForTests();

    expect(() => announceStorageChange("decks", [FIRST])).not.toThrow();
    const unsubscribe = subscribeStorageChanges(vi.fn());
    expect(() => unsubscribe()).not.toThrow();
  });
});
