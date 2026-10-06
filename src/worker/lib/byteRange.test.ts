import { describe, it, expect } from "vitest";
import { parseRangeHeader, resolveByteRange } from "./byteRange";

describe("parseRangeHeader", () => {
  it("닫힌 범위, 열린 범위, suffix 범위를 읽는다", () => {
    expect(parseRangeHeader("bytes=0-3")).toEqual({ start: 0, end: 3 });
    expect(parseRangeHeader("bytes=5-")).toEqual({ start: 5 });
    expect(parseRangeHeader("bytes=-4")).toEqual({ suffix: 4 });
  });

  it("단위의 대소문자와 앞뒤 공백을 가리지 않는다", () => {
    expect(parseRangeHeader(" BYTES=0-3 ")).toEqual({ start: 0, end: 3 });
  });

  it("구문이 깨졌거나 지원하지 않는 헤더는 무시한다", () => {
    expect(parseRangeHeader("bytes=abc")).toBeNull();
    expect(parseRangeHeader("bytes=-")).toBeNull();
    expect(parseRangeHeader("bytes=")).toBeNull();
    expect(parseRangeHeader("items=0-1")).toBeNull();
    expect(parseRangeHeader("bytes=0-1,4-5")).toBeNull();
  });

  it("안전한 정수를 넘는 위치는 버리지 않고 가장 큰 안전한 정수로 줄인다", () => {
    const max = Number.MAX_SAFE_INTEGER;
    expect(parseRangeHeader("bytes=99999999999999999999-")).toEqual({
      start: max,
    });
    expect(parseRangeHeader("bytes=0-99999999999999999999")).toEqual({
      start: 0,
      end: max,
    });
    expect(parseRangeHeader("bytes=-99999999999999999999")).toEqual({
      suffix: max,
    });
  });
});

describe("resolveByteRange", () => {
  it("끝 위치를 객체 크기 안으로 줄인다", () => {
    expect(resolveByteRange({ start: 10, end: 100 }, 16)).toEqual({
      start: 10,
      end: 15,
    });
    expect(resolveByteRange({ start: 5 }, 16)).toEqual({ start: 5, end: 15 });
    expect(resolveByteRange({ start: 0, end: 3 }, 16)).toEqual({
      start: 0,
      end: 3,
    });
  });

  it("suffix 범위는 끝에서부터 세고, 크기보다 길면 전체를 가리킨다", () => {
    expect(resolveByteRange({ suffix: 4 }, 16)).toEqual({ start: 12, end: 15 });
    expect(resolveByteRange({ suffix: 100 }, 16)).toEqual({
      start: 0,
      end: 15,
    });
  });

  it("만족할 수 없는 범위는 null을 돌려준다", () => {
    expect(resolveByteRange({ start: 16 }, 16)).toBeNull();
    expect(resolveByteRange({ start: 100, end: 200 }, 16)).toBeNull();
    expect(resolveByteRange({ start: 5, end: 2 }, 16)).toBeNull();
    expect(resolveByteRange({ suffix: 0 }, 16)).toBeNull();
    expect(resolveByteRange({ start: 0 }, 0)).toBeNull();
    expect(resolveByteRange({ suffix: 4 }, 0)).toBeNull();
  });
});
