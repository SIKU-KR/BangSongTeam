import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  forgetDeckDelete,
  listPendingDeckDeletes,
  rememberDeckDelete,
} from "./pendingDeckDeletes";

const USER = "00000000x000000000001";
const OTHER_USER = "00000000x000000000002";
const A = "c0000000000000000000a";
const B = "c0000000000000000000b";

function storageKey(userId: string): string {
  return `pending-deck-deletes:${userId}`;
}

describe("pendingDeckDeletes", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("사용자별로 지운 곡을 기록하고 목록에서 빼낸다", () => {
    rememberDeckDelete(USER, A);
    rememberDeckDelete(USER, B);
    rememberDeckDelete(USER, A);
    rememberDeckDelete(OTHER_USER, B);

    expect(listPendingDeckDeletes(USER)).toEqual([A, B]);
    expect(listPendingDeckDeletes(OTHER_USER)).toEqual([B]);

    forgetDeckDelete(USER, A);

    expect(listPendingDeckDeletes(USER)).toEqual([B]);
    expect(listPendingDeckDeletes(OTHER_USER)).toEqual([B]);
  });

  it("마지막 곡을 빼면 저장한 값도 지운다", () => {
    rememberDeckDelete(USER, A);
    forgetDeckDelete(USER, A);

    expect(localStorage.getItem(storageKey(USER))).toBeNull();
    expect(listPendingDeckDeletes(USER)).toEqual([]);
  });

  it("모듈을 다시 불러와도(새로고침) 기록이 남는다", async () => {
    rememberDeckDelete(USER, A);

    vi.resetModules();
    const reloaded = await import("./pendingDeckDeletes");

    expect(reloaded.listPendingDeckDeletes(USER)).toEqual([A]);
  });

  it("읽을 수 없는 값과 id 형식이 아닌 값은 버린다", () => {
    localStorage.setItem(storageKey(USER), "{깨진 값");
    expect(listPendingDeckDeletes(USER)).toEqual([]);

    localStorage.setItem(storageKey(USER), JSON.stringify({ ids: [A] }));
    expect(listPendingDeckDeletes(USER)).toEqual([]);

    localStorage.setItem(
      storageKey(USER),
      JSON.stringify([A, "짧은 id", 42, null, B]),
    );
    expect(listPendingDeckDeletes(USER)).toEqual([A, B]);
  });

  it("읽을 수 없는 값이 있어도 새로 지운 곡은 기록한다", () => {
    localStorage.setItem(storageKey(USER), "{깨진 값");

    rememberDeckDelete(USER, A);

    expect(listPendingDeckDeletes(USER)).toEqual([A]);
  });

  it("id 형식이 아닌 곡은 기록하지 않는다", () => {
    rememberDeckDelete(USER, "짧은 id");

    expect(localStorage.getItem(storageKey(USER))).toBeNull();
  });

  it("저장소를 쓸 수 없어도 던지지 않고 기록이 없는 것으로 본다", () => {
    const blocked = (): never => {
      throw new DOMException("저장소를 쓸 수 없어요", "SecurityError");
    };
    vi.spyOn(localStorage, "getItem").mockImplementation(blocked);
    vi.spyOn(localStorage, "setItem").mockImplementation(blocked);
    vi.spyOn(localStorage, "removeItem").mockImplementation(blocked);

    expect(() => rememberDeckDelete(USER, A)).not.toThrow();
    expect(() => forgetDeckDelete(USER, A)).not.toThrow();
    expect(listPendingDeckDeletes(USER)).toEqual([]);
  });
});
