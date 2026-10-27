import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ERROR_COPY } from "#copy/common";
import { PersistenceUnavailableError } from "./db";
import {
  clearPersistenceError,
  getPersistenceError,
  reportPersistenceError,
} from "./persistenceStatus";

function resetPersistenceStatus(): void {
  clearPersistenceError();
  clearPersistenceError("session");
}

describe("persistenceStatus", () => {
  beforeEach(resetPersistenceStatus);
  afterEach(resetPersistenceStatus);

  it("다른 탭의 이전 버전에 막혔으면 다른 탭을 닫으라고 안내한다", () => {
    reportPersistenceError(
      new PersistenceUnavailableError(undefined, "blocked"),
    );

    expect(getPersistenceError()).toEqual({
      kind: "blocked",
      message: ERROR_COPY.persistence.blocked,
    });
  });

  it("다른 탭이 새 버전을 열었으면 새로고침하라고 안내한다", () => {
    reportPersistenceError(
      new PersistenceUnavailableError(undefined, "outdated"),
    );

    expect(getPersistenceError()).toEqual({
      kind: "outdated",
      message: ERROR_COPY.persistence.outdated,
    });
  });

  it("이유가 없는 PersistenceUnavailableError는 저장소를 쓸 수 없다고 안내한다", () => {
    reportPersistenceError(new PersistenceUnavailableError());

    expect(getPersistenceError()?.kind).toBe("unavailable");
  });

  describe("세션 캐시의 실패", () => {
    it("세션 캐시를 다시 저장해도 스토어가 저장하지 못한 경고는 남긴다", () => {
      reportPersistenceError(new DOMException("가득 참", "QuotaExceededError"));
      reportPersistenceError(
        new PersistenceUnavailableError(undefined, "blocked"),
        "session",
      );

      clearPersistenceError("session");

      expect(getPersistenceError()?.kind).toBe("quota");
    });

    it("스토어가 다시 저장해도 세션 캐시를 읽지 못한 경고는 남긴다", () => {
      reportPersistenceError(
        new PersistenceUnavailableError(undefined, "blocked"),
        "session",
      );
      reportPersistenceError(new DOMException("가득 참", "QuotaExceededError"));

      clearPersistenceError();

      expect(getPersistenceError()?.kind).toBe("blocked");
    });
  });
});
