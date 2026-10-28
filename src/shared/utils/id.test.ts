import { describe, it, expect, vi, afterEach } from "vitest";
import { IdSchema } from "../schemas/id";
import { createId, createSlideId } from "./id";

const nextNanoIds = vi.hoisted((): string[] => []);

vi.mock("nanoid", async (importOriginal) => {
  const actual = await importOriginal<typeof import("nanoid")>();
  return {
    ...actual,
    nanoid: (size?: number): string =>
      nextNanoIds.shift() ?? actual.nanoid(size),
  };
});

afterEach(() => {
  nextNanoIds.length = 0;
});

describe("createId", () => {
  it("IdSchema를 통과하는 21자 id를 만든다", () => {
    for (let i = 0; i < 50; i++) {
      const id = createId();
      expect(id).toHaveLength(21);
      expect(IdSchema.safeParse(id).success).toBe(true);
    }
  });

  it("반복 생성해도 겹치지 않는다", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => createId()));
    expect(ids.size).toBe(1000);
  });

  it("Firestore가 예약한 __…__ 꼴이 나오면 버리고 다시 만든다", () => {
    nextNanoIds.push("__abcdefghijklmnopq__", "V1StGXR8_Z5jdHi6B-myT");

    expect(createId()).toBe("V1StGXR8_Z5jdHi6B-myT");
  });
});

describe("createSlideId", () => {
  it("s_ 접두사가 붙은 짧은 id를 만든다", () => {
    const id = createSlideId();
    expect(id).toMatch(/^s_[A-Za-z0-9_-]{10}$/);
    expect(createSlideId()).not.toBe(id);
  });
});
