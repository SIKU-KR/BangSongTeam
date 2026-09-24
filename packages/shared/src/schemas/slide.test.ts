import { describe, it, expect } from "vitest";
import { SlideSchema } from "./slide";

describe("SlideSchema", () => {
  it("parses a valid slide with explicit id", () => {
    const valid = {
      id: "s_custom1",
      order: 0,
      lines: ["은혜 아래 있네", "주의 자비 넘치네"],
    };
    const parsed = SlideSchema.parse(valid);
    expect(parsed).toEqual(valid);
  });

  it("generates a default random ID starting with s_ when id is omitted", () => {
    const parsed = SlideSchema.parse({
      order: 1,
      lines: ["참 아름다워라"],
    });
    expect(parsed.id).toMatch(/^s_[A-Za-z0-9_-]{10}$/);
    expect(parsed.order).toBe(1);
    expect(parsed.lines).toEqual(["참 아름다워라"]);
  });

  it("allows 0 to 4 lines", () => {
    expect(() =>
      SlideSchema.parse({
        order: 0,
        lines: [],
      }),
    ).not.toThrow();

    expect(() =>
      SlideSchema.parse({
        order: 0,
        lines: ["Line 1", "Line 2", "Line 3", "Line 4"],
      }),
    ).not.toThrow();
  });

  it("rejects slides with more than 4 lines", () => {
    expect(() =>
      SlideSchema.parse({
        order: 0,
        lines: ["1", "2", "3", "4", "5"],
      }),
    ).toThrow();
  });

  it("rejects lines exceeding 80 characters", () => {
    const longLine = "가".repeat(81);
    expect(() =>
      SlideSchema.parse({
        order: 0,
        lines: [longLine],
      }),
    ).toThrow();

    const maxLine = "가".repeat(80);
    expect(() =>
      SlideSchema.parse({
        order: 0,
        lines: [maxLine],
      }),
    ).not.toThrow();
  });

  it("rejects negative order or non-integer order", () => {
    expect(() =>
      SlideSchema.parse({
        order: -1,
        lines: ["line"],
      }),
    ).toThrow();

    expect(() =>
      SlideSchema.parse({
        order: 1.5,
        lines: ["line"],
      }),
    ).toThrow();
  });
});
