import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ERROR_COPY } from "#copy/common";
import { PersistenceUnavailableError } from "./db";
import {
  __resetPersistenceStatusForTests,
  clearPersistenceError,
  getPersistenceError,
  reportPersistenceError,
} from "./persistenceStatus";

const quotaError = (): DOMException =>
  new DOMException("가득 참", "QuotaExceededError");

describe("persistenceStatus", () => {
  beforeEach(__resetPersistenceStatusForTests);
  afterEach(__resetPersistenceStatusForTests);

  it("다른 탭의 이전 버전에 막혔으면 다른 탭을 닫으라고 안내한다", () => {
    reportPersistenceError(
      new PersistenceUnavailableError(undefined, "blocked"),
      "presentation",
    );

    expect(getPersistenceError()).toEqual({
      kind: "blocked",
      message: ERROR_COPY.persistence.blocked,
    });
  });

  it("다른 탭이 새 버전을 열었으면 새로고침하라고 안내한다", () => {
    reportPersistenceError(
      new PersistenceUnavailableError(undefined, "outdated"),
      "presentation",
    );

    expect(getPersistenceError()).toEqual({
      kind: "outdated",
      message: ERROR_COPY.persistence.outdated,
    });
  });

  it("이유가 없는 PersistenceUnavailableError는 저장소를 쓸 수 없다고 안내한다", () => {
    reportPersistenceError(new PersistenceUnavailableError(), "presentation");

    expect(getPersistenceError()?.kind).toBe("unavailable");
  });

  it("저장 공간이 가득 차면 거의 비지 않는 휴지통 대신 배경 영상과 기기 저장 공간을 비우라고 안내한다", () => {
    reportPersistenceError(quotaError(), "presentation");

    const error = getPersistenceError();
    expect(error?.kind).toBe("quota");
    expect(error?.message).not.toMatch(/휴지통/);
    expect(error?.message).toMatch(/배경 영상/);
  });

  describe("저장소마다 따로 두는 실패", () => {
    it("곡 보관함이 다시 저장해도 프레젠테이션이 저장하지 못한 경고는 남긴다", () => {
      reportPersistenceError(quotaError(), "presentation");
      reportPersistenceError(new Error("disk"), "deck");

      clearPersistenceError("deck");

      expect(getPersistenceError()?.kind).toBe("quota");
      expect(getPersistenceError("presentation")?.kind).toBe("quota");
      expect(getPersistenceError("deck")).toBeNull();
    });

    it("저장소를 고르면 그 저장소의 쓰기와 불러오기 실패만 본다", () => {
      reportPersistenceError(new Error("disk"), "deck:hydrate");

      expect(getPersistenceError("presentation")).toBeNull();
      expect(getPersistenceError("deck")?.kind).toBe("unknown");

      reportPersistenceError(quotaError(), "presentation:hydrate");

      expect(getPersistenceError("presentation")?.kind).toBe("quota");
    });

    it("불러오기 실패는 그 저장소의 쓰기가 성공해도 남는다", () => {
      reportPersistenceError(new Error("읽기 실패"), "presentation:hydrate");

      clearPersistenceError("presentation");

      expect(getPersistenceError("presentation")?.kind).toBe("unknown");
    });

    it("가장 나중에 알린 실패를 보인다", () => {
      reportPersistenceError(quotaError(), "presentation");
      reportPersistenceError(new Error("disk"), "folder");

      expect(getPersistenceError()?.kind).toBe("unknown");

      reportPersistenceError(quotaError(), "presentation");

      expect(getPersistenceError()?.kind).toBe("quota");
    });

    it("같은 종류의 실패를 다시 알리면 같은 객체를 돌려준다", () => {
      reportPersistenceError(quotaError(), "presentation");
      const first = getPersistenceError("presentation");

      reportPersistenceError(new Error("disk"), "deck");
      reportPersistenceError(quotaError(), "presentation");

      expect(getPersistenceError("presentation")).toBe(first);
      expect(getPersistenceError()).toBe(first);
    });

    it("테스트 초기화는 모든 저장소의 실패를 지운다", () => {
      reportPersistenceError(quotaError(), "presentation");
      reportPersistenceError(new Error("disk"), "deck:hydrate");
      reportPersistenceError(new PersistenceUnavailableError(), "session");

      __resetPersistenceStatusForTests();

      expect(getPersistenceError()).toBeNull();
    });
  });

  describe("세션 캐시의 실패", () => {
    it("세션 캐시를 다시 저장해도 스토어가 저장하지 못한 경고는 남긴다", () => {
      reportPersistenceError(quotaError(), "presentation");
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
      reportPersistenceError(quotaError(), "presentation");

      clearPersistenceError("presentation");

      expect(getPersistenceError()?.kind).toBe("blocked");
    });
  });
});
