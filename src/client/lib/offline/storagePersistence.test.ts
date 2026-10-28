import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  __resetStoragePersistenceForTests,
  requestPersistentStorage,
  useStoragePersistence,
} from "./storagePersistence";

const original = Object.getOwnPropertyDescriptor(navigator, "storage");

function setStorage(value: unknown): void {
  Object.defineProperty(navigator, "storage", {
    value,
    configurable: true,
  });
}

beforeEach(() => {
  __resetStoragePersistenceForTests();
});

afterEach(() => {
  window.history.pushState(null, "", "/");
  if (original) {
    Object.defineProperty(navigator, "storage", original);
  } else {
    // @ts-expect-error 테스트에서 주입한 속성을 되돌린다
    delete navigator.storage;
  }
  vi.restoreAllMocks();
});

describe("requestPersistentStorage", () => {
  it("영구 저장이 아직이면 요청하고 허락받았는지 돌려준다", async () => {
    const persist = vi.fn(async () => true);
    setStorage({ persisted: async () => false, persist });

    await expect(requestPersistentStorage()).resolves.toBe(true);

    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("거부는 예외가 아니라 false다", async () => {
    setStorage({
      persisted: async () => false,
      persist: async () => false,
    });

    await expect(requestPersistentStorage()).resolves.toBe(false);
  });

  it("이미 영구 상태면 다시 요청하지 않고 true다", async () => {
    const persist = vi.fn(async () => true);
    setStorage({ persisted: async () => true, persist });

    await expect(requestPersistentStorage()).resolves.toBe(true);

    expect(persist).not.toHaveBeenCalled();
  });

  it("지원하지 않는 브라우저에서는 던지지 않고 null이다", async () => {
    setStorage(undefined);

    await expect(requestPersistentStorage()).resolves.toBeNull();
  });

  it("요청이 던지면 전파하지 않고 null이다", async () => {
    const persist = vi.fn(async () => true);
    setStorage({
      persisted: async () => {
        throw new Error("blocked");
      },
      persist,
    });

    await expect(requestPersistentStorage()).resolves.toBeNull();
    expect(persist).not.toHaveBeenCalled();
  });

  it("송출 화면에서는 묻지 않고 마지막으로 확인한 상태를 돌려준다", async () => {
    const persist = vi.fn(async () => false);
    setStorage({ persisted: async () => false, persist });
    await requestPersistentStorage();
    persist.mockClear();
    window.history.pushState(null, "", "/present/abc/fullscreen");

    await expect(requestPersistentStorage()).resolves.toBe(false);
    expect(persist).not.toHaveBeenCalled();
  });

  it("묻는 동안 다시 불러도 허락을 한 번만 묻는다", async () => {
    let answer: (granted: boolean) => void = () => undefined;
    const persist = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          answer = resolve;
        }),
    );
    setStorage({ persisted: async () => false, persist });

    const first = requestPersistentStorage();
    const second = requestPersistentStorage();
    await vi.waitFor(() => expect(persist).toHaveBeenCalled());
    answer(false);

    await expect(Promise.all([first, second])).resolves.toEqual([false, false]);
    expect(persist).toHaveBeenCalledTimes(1);
  });
});

describe("useStoragePersistence", () => {
  it("확인하기 전에는 null이고, 확인하면 그 결과로 다시 그린다", async () => {
    setStorage({
      persisted: async () => false,
      persist: async () => false,
    });
    const { result } = renderHook(() => useStoragePersistence());
    expect(result.current).toBeNull();

    await act(async () => {
      await requestPersistentStorage();
    });

    expect(result.current).toBe(false);
  });
});
