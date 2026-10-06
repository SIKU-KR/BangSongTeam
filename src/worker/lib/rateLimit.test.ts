import { describe, it, expect, vi } from "vitest";
import { createFixedWindowLimiter } from "./rateLimit";

describe("createFixedWindowLimiter", () => {
  it("창 안에서 한도까지만 허용하고 창이 지나면 다시 센다", () => {
    let now = 0;
    const allow = createFixedWindowLimiter({
      limit: 2,
      windowMs: 1000,
      now: () => now,
    });

    expect([allow("a"), allow("a"), allow("a")]).toEqual([true, true, false]);
    expect(allow("b")).toBe(true);

    now = 999;
    expect(allow("a")).toBe(false);
    now = 1000;
    expect(allow("a")).toBe(true);
  });

  it("키가 많이 쌓이면 지난 창을 비워도 지금 창의 한도는 지킨다", () => {
    let now = 0;
    const allow = createFixedWindowLimiter({
      limit: 1,
      windowMs: 1000,
      now: () => now,
    });
    for (let index = 0; index < 1000; index += 1) allow(`old-${index}`);

    now = 1500;
    expect(allow("fresh")).toBe(true);
    expect(allow("fresh")).toBe(false);
    expect(allow("old-0")).toBe(true);
  });

  it("한 창 안에 새 키가 몰려도 지난 창 비우기는 창마다 한 번만 한다", () => {
    let now = 0;
    const allow = createFixedWindowLimiter({
      limit: 1,
      windowMs: 1000,
      now: () => now,
    });
    for (let index = 0; index < 1000; index += 1) allow(`first-${index}`);
    const scans = vi.spyOn(Map.prototype, Symbol.iterator);

    now = 500;
    for (let index = 0; index < 100; index += 1) allow(`burst-${index}`);
    expect(scans).toHaveBeenCalledTimes(1);

    now = 1500;
    allow("next");
    expect(scans).toHaveBeenCalledTimes(2);
    expect(allow("first-0")).toBe(true);
    scans.mockRestore();
  });
});
