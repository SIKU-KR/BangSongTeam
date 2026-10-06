import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetConnectivityForTests,
  isServerReachable,
  markServerReachable,
  markServerUnreachable,
  subscribeServerReachability,
} from "./connectivity";

describe("connectivity", () => {
  beforeEach(() => {
    __resetConnectivityForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __resetConnectivityForTests();
  });

  it("값이 실제로 바뀔 때만 구독자에게 알린다", () => {
    const listener = vi.fn();
    subscribeServerReachability(listener);

    markServerReachable();
    expect(listener).not.toHaveBeenCalled();

    markServerUnreachable();
    markServerUnreachable();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(isServerReachable()).toBe(false);

    markServerReachable();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(isServerReachable()).toBe(true);
  });

  it("구독을 풀면 더는 알리지 않는다", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeServerReachability(listener);
    unsubscribe();

    markServerUnreachable();

    expect(listener).not.toHaveBeenCalled();
  });

  it("처음 값은 navigator.onLine이 false일 때만 닿지 못함이다", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    __resetConnectivityForTests();
    expect(isServerReachable()).toBe(false);

    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    __resetConnectivityForTests();
    expect(isServerReachable()).toBe(true);
  });
});
