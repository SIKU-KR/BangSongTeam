import { describe, expect, it } from "vitest";
import { reorderedSongIndex, resolveDropIndex } from "./slidePaneDnd";

describe("resolveDropIndex", () => {
  it("대상 썸네일의 위 절반이면 앞 틈, 아래 절반이면 뒤 틈", () => {
    const rect = { top: 100, height: 40 };
    expect(resolveDropIndex(2, 110, rect)).toBe(2);
    expect(resolveDropIndex(2, 130, rect)).toBe(3);
  });
});

describe("reorderedSongIndex", () => {
  it("원래 자리보다 뒤 틈에 놓으면 빠진 곡만큼 하나를 뺀다", () => {
    expect(reorderedSongIndex(1, 3)).toBe(2);
    expect(reorderedSongIndex(0, 4)).toBe(3);
  });

  it("원래 자리보다 앞 틈이나 바로 앞뒤 틈에 놓으면 그대로다", () => {
    expect(reorderedSongIndex(2, 0)).toBe(0);
    expect(reorderedSongIndex(2, 2)).toBe(2);
    expect(reorderedSongIndex(2, 3)).toBe(2);
  });
});
