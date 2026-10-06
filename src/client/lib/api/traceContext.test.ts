import { describe, it, expect } from "vitest";
import {
  createTraceContext,
  rememberRequestMeta,
  requestMetaOf,
  toRoutePattern,
} from "./traceContext";

describe("createTraceContext", () => {
  it("W3C traceparent 형식이고 requestId는 그 trace-id다", () => {
    const { traceparent, requestId } = createTraceContext();

    expect(traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(traceparent.split("-")[1]).toBe(requestId);
    expect(createTraceContext().requestId).not.toBe(requestId);
  });
});

describe("toRoutePattern", () => {
  it.each([
    ["/api/presentations", "/api/presentations"],
    ["/api/presentations/V1StGXR8_Z5jdHi6B-myT", "/api/presentations/:id"],
    ["/api/presentations/aaaaaaaaaaaaaaaaaaaaa", "/api/presentations/:id"],
    ["/api/share/s_Ab3dE5gH9k/join", "/api/share/:id/join"],
    [
      "/api/decks/V1StGXR8_Z5jdHi6B-myT/visibility",
      "/api/decks/:id/visibility",
    ],
    ["/api/media/loops/a.mp4", "/api/media/*"],
    ["/api/media/posters/a.webp", "/api/media/*"],
    ["/api/auth/get-session", "/api/auth/get-session"],
    ["http://localhost/api/health?x=1", "/api/health"],
    ["/assets/index.js", "/api"],
  ])("%s → %s", (url, expected) => {
    expect(toRoutePattern(url)).toBe(expected);
  });
});

describe("requestMetaOf", () => {
  it("붙여 둔 객체에서만 상관 ID를 찾는다", () => {
    const response = {};
    const meta = { requestId: "a".repeat(32), route: "/api/health" };
    rememberRequestMeta(response, meta);

    expect(requestMetaOf(response)).toBe(meta);
    expect(requestMetaOf({})).toBeUndefined();
    expect(requestMetaOf("x")).toBeUndefined();
    expect(requestMetaOf(null)).toBeUndefined();
  });
});
