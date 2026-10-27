import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  forgetJoinedShare,
  recallJoinedShare,
  rememberJoinedShare,
} from "./joinedShares";

const USER = "00000000x000000000001";
const OTHER_USER = "00000000x000000000002";
const FIRST = "p0000000000000000000a";
const SECOND = "p0000000000000000000b";

function idOf(n: number): string {
  return `p${String(n).padStart(20, "0")}`;
}

describe("joinedShares (링크로 참여한 프레젠테이션 기억)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("참여한 링크가 가리킨 프레젠테이션을 다시 찾는다", () => {
    rememberJoinedShare(USER, "tok-first", FIRST);

    expect(recallJoinedShare(USER, "tok-first")).toBe(FIRST);
    expect(recallJoinedShare(USER, "tok-other")).toBeNull();
  });

  it("같은 링크로 다시 참여하면 가리키는 프레젠테이션을 바꾼다", () => {
    rememberJoinedShare(USER, "tok-first", FIRST);
    rememberJoinedShare(USER, "tok-first", SECOND);

    expect(recallJoinedShare(USER, "tok-first")).toBe(SECOND);
  });

  it("사용자마다 따로 기억해 다른 계정의 기록을 쓰지 않는다", () => {
    rememberJoinedShare(USER, "tok-first", FIRST);

    expect(recallJoinedShare(OTHER_USER, "tok-first")).toBeNull();
  });

  it("잊은 링크는 다시 찾지 못하고 다른 링크는 남는다", () => {
    rememberJoinedShare(USER, "tok-first", FIRST);
    rememberJoinedShare(USER, "tok-second", SECOND);

    forgetJoinedShare(USER, "tok-first");

    expect(recallJoinedShare(USER, "tok-first")).toBeNull();
    expect(recallJoinedShare(USER, "tok-second")).toBe(SECOND);
  });

  it("가장 최근 50개 링크만 남긴다", () => {
    for (let n = 0; n < 51; n += 1) {
      rememberJoinedShare(USER, `tok-${n}`, idOf(n));
    }

    expect(recallJoinedShare(USER, "tok-0")).toBeNull();
    expect(recallJoinedShare(USER, "tok-1")).toBe(idOf(1));
    expect(recallJoinedShare(USER, "tok-50")).toBe(idOf(50));
  });

  it("다시 참여한 링크는 가장 최근으로 옮겨 밀려나지 않게 한다", () => {
    for (let n = 0; n < 50; n += 1) {
      rememberJoinedShare(USER, `tok-${n}`, idOf(n));
    }
    rememberJoinedShare(USER, "tok-0", idOf(0));
    rememberJoinedShare(USER, "tok-new", idOf(99));

    expect(recallJoinedShare(USER, "tok-0")).toBe(idOf(0));
    expect(recallJoinedShare(USER, "tok-1")).toBeNull();
  });

  it.each(["{깨진 JSON", '{"tok-first":"x"}', '[["tok-first",3]]'])(
    "깨진 기록(%s)은 없는 것으로 보고 다음 참여 때 새로 쓴다",
    (raw) => {
      localStorage.setItem(`chiton:share-targets:${USER}`, raw);

      expect(recallJoinedShare(USER, "tok-first")).toBeNull();

      rememberJoinedShare(USER, "tok-second", SECOND);
      expect(recallJoinedShare(USER, "tok-second")).toBe(SECOND);
    },
  );

  it("저장소를 쓸 수 없어도 던지지 않고 기억하지 않는다", () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(() => rememberJoinedShare(USER, "tok-first", FIRST)).not.toThrow();
    expect(recallJoinedShare(USER, "tok-first")).toBeNull();
    expect(() => forgetJoinedShare(USER, "tok-first")).not.toThrow();
  });
});
