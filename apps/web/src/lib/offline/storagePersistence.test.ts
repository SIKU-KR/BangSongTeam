import { describe, it, expect, afterEach, vi } from "vitest";
import {
  requestPersistentStorage,
  checkPersistentStorage,
  estimateStorageUsage,
} from "./storagePersistence";

const original = Object.getOwnPropertyDescriptor(navigator, "storage");

function setStorage(value: unknown): void {
  Object.defineProperty(navigator, "storage", {
    value,
    configurable: true,
  });
}

afterEach(() => {
  if (original) {
    Object.defineProperty(navigator, "storage", original);
  } else {
    // @ts-expect-error 테스트에서 주입한 속성을 되돌린다
    delete navigator.storage;
  }
  vi.restoreAllMocks();
});

describe("requestPersistentStorage", () => {
  it("승인되면 persisted를 돌려준다", async () => {
    setStorage({
      persisted: async () => false,
      persist: async () => true,
    });

    expect(await requestPersistentStorage()).toBe("persisted");
  });

  it("거부는 예외가 아니라 denied 상태다", async () => {
    setStorage({
      persisted: async () => false,
      persist: async () => false,
    });

    expect(await requestPersistentStorage()).toBe("denied");
  });

  it("이미 영구 상태면 다시 요청하지 않는다", async () => {
    const persist = vi.fn(async () => true);
    setStorage({ persisted: async () => true, persist });

    expect(await requestPersistentStorage()).toBe("persisted");
    expect(persist).not.toHaveBeenCalled();
  });

  it("지원하지 않는 브라우저는 unsupported다", async () => {
    setStorage(undefined);

    expect(await requestPersistentStorage()).toBe("unsupported");
  });

  it("요청이 던지면 unsupported로 떨어지고 전파하지 않는다", async () => {
    setStorage({
      persisted: async () => {
        throw new Error("blocked");
      },
      persist: async () => true,
    });

    expect(await requestPersistentStorage()).toBe("unsupported");
  });
});

describe("checkPersistentStorage", () => {
  it("요청 없이 현재 상태만 읽는다", async () => {
    const persist = vi.fn(async () => true);
    setStorage({ persisted: async () => false, persist });

    expect(await checkPersistentStorage()).toBe("denied");
    expect(persist).not.toHaveBeenCalled();
  });
});

describe("estimateStorageUsage", () => {
  it("사용량과 할당량을 돌려준다", async () => {
    setStorage({
      estimate: async () => ({ usage: 1024, quota: 4096 }),
    });

    expect(await estimateStorageUsage()).toEqual({
      usageBytes: 1024,
      quotaBytes: 4096,
    });
  });

  it("지원하지 않으면 null이다", async () => {
    setStorage(undefined);

    expect(await estimateStorageUsage()).toBeNull();
  });
});
