import { describe, it, expect } from "vitest";
import { IdSchema, ID_PATTERN } from "./id";

describe("IdSchema", () => {
  it("21자 NanoID를 통과시킨다", () => {
    for (const id of [
      "V1StGXR8_Z5jdHi6B-myT",
      "mJIToShuKOc3FsbZIihi6",
      "-_-_-_-_-_-_-_-_-_-_-",
      "000000000000000000001",
    ]) {
      expect(IdSchema.safeParse(id).success).toBe(true);
      expect(id).toMatch(ID_PATTERN);
    }
  });

  it("UUID는 받지 않는다 (호환 없음)", () => {
    expect(
      IdSchema.safeParse("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11").success,
    ).toBe(false);
  });

  it("길이가 21자가 아니면 거부한다", () => {
    expect(IdSchema.safeParse("").success).toBe(false);
    expect(IdSchema.safeParse("V1StGXR8_Z5jdHi6B-my").success).toBe(false); // 20자
    expect(IdSchema.safeParse("V1StGXR8_Z5jdHi6B-myTT").success).toBe(false); // 22자
  });

  it("URL-safe 알파벳 밖의 문자는 거부한다", () => {
    expect(IdSchema.safeParse("V1StGXR8_Z5jdHi6B-my.").success).toBe(false);
    expect(IdSchema.safeParse("V1StGXR8_Z5jdHi6B-my/").success).toBe(false);
    expect(IdSchema.safeParse("V1StGXR8 Z5jdHi6B-myT").success).toBe(false);
  });
});
