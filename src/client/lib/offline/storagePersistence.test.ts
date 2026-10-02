import { describe, it, expect, afterEach, vi } from "vitest";
import { requestPersistentStorage } from "./storagePersistence";

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
  it("영구 저장이 아직이면 요청한다", async () => {
    const persist = vi.fn(async () => true);
    setStorage({ persisted: async () => false, persist });

    await requestPersistentStorage();

    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("거부는 예외가 아니다", async () => {
    setStorage({
      persisted: async () => false,
      persist: async () => false,
    });

    await expect(requestPersistentStorage()).resolves.toBeUndefined();
  });

  it("이미 영구 상태면 다시 요청하지 않는다", async () => {
    const persist = vi.fn(async () => true);
    setStorage({ persisted: async () => true, persist });

    await requestPersistentStorage();

    expect(persist).not.toHaveBeenCalled();
  });

  it("지원하지 않는 브라우저에서도 던지지 않는다", async () => {
    setStorage(undefined);

    await expect(requestPersistentStorage()).resolves.toBeUndefined();
  });

  it("요청이 던져도 전파하지 않는다", async () => {
    const persist = vi.fn(async () => true);
    setStorage({
      persisted: async () => {
        throw new Error("blocked");
      },
      persist,
    });

    await expect(requestPersistentStorage()).resolves.toBeUndefined();
    expect(persist).not.toHaveBeenCalled();
  });
});
