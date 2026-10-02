import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  clearProjectionResume,
  loadProjectionResume,
  saveProjectionResume,
  type ProjectionResume,
} from "./projectionResume";

const RESUME: ProjectionResume = {
  songIndex: 1,
  slideIndex: 2,
  itemId: "item-2",
  hasStarted: true,
  isBlackout: false,
  isLyricsHidden: true,
};

describe("projectionResume", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("저장한 상태를 프레젠테이션별로 돌려주고, 지우면 없앤다", () => {
    saveProjectionResume("a", RESUME);

    expect(loadProjectionResume("a")).toEqual(RESUME);
    expect(loadProjectionResume("b")).toBeNull();

    clearProjectionResume("a");

    expect(loadProjectionResume("a")).toBeNull();
  });

  it.each(["{not json", JSON.stringify({ songIndex: -1 })])(
    "깨진 값(%s)은 처음부터 시작한다",
    (raw) => {
      window.sessionStorage.setItem("chiton:projection:a", raw);

      expect(loadProjectionResume("a")).toBeNull();
    },
  );

  it("저장소를 쓸 수 없어도 예외를 던지지 않는다", () => {
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(() => saveProjectionResume("a", RESUME)).not.toThrow();
    expect(loadProjectionResume("a")).toBeNull();
    expect(() => clearProjectionResume("a")).not.toThrow();
  });
});
