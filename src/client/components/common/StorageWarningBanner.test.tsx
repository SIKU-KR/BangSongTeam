import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { toast } from "sonner";
import { MEDIA_CACHE_NAME } from "#shared";
import { ERROR_COPY } from "#copy/common";
import { SHELL_COPY } from "#copy/shell";
import { resetFakeCacheStorage } from "../../test/fakeCacheStorage";
import {
  installFakeLockManager,
  removeFakeLockManager,
} from "../../test/fakeLockManager";
import { StorageWarningBanner } from "./StorageWarningBanner";
import {
  reportPersistenceError,
  clearPersistenceError,
  reportCorruptedRecords,
} from "../../lib/storage";
import { __resetPersistenceStatusForTests } from "../../lib/storage/persistenceStatus";
import { PersistenceUnavailableError } from "../../lib/storage/db";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), info: vi.fn() } }));

describe("StorageWarningBanner", () => {
  beforeEach(() => {
    __resetPersistenceStatusForTests();
  });

  it("저장 오류가 없으면 아무것도 렌더링하지 않는다", () => {
    render(<StorageWarningBanner />);

    expect(
      screen.queryByTestId("storage-warning-banner"),
    ).not.toBeInTheDocument();
  });

  it("IndexedDB를 쓸 수 없으면 해당 안내를 띄운다", () => {
    reportPersistenceError(new PersistenceUnavailableError(), "presentation");
    render(<StorageWarningBanner />);

    expect(screen.getByTestId("storage-warning-banner")).toHaveTextContent(
      ERROR_COPY.persistence.unavailable,
    );
  });

  it("용량 초과는 별도 문구로 구분한다", () => {
    reportPersistenceError(
      new DOMException("quota", "QuotaExceededError"),
      "deck",
    );
    render(<StorageWarningBanner />);

    expect(screen.getByTestId("storage-warning-banner")).toHaveTextContent(
      /저장 공간이 가득/,
    );
  });

  it("닫기 버튼을 제공하지 않는다 (해소될 때까지 계속 보여야 한다)", () => {
    reportPersistenceError(new Error("boom"), "folder");
    render(<StorageWarningBanner />);

    expect(screen.getByTestId("storage-warning-banner")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("읽지 못한 저장본이 있으면 격리 안내를 띄운다", () => {
    reportCorruptedRecords([{ id: "p1" }, { id: "p2" }]);
    render(<StorageWarningBanner />);

    const banner = screen.getByTestId("corrupted-warning-banner");
    expect(banner).toHaveTextContent(SHELL_COPY.storage.corrupted(2));
  });

  it("격리 안내는 저장이 다시 성공해도 사라지지 않는다", () => {
    reportCorruptedRecords([{ id: "p1" }]);
    reportPersistenceError(new Error("boom"), "presentation");
    clearPersistenceError("presentation");
    render(<StorageWarningBanner />);

    expect(
      screen.queryByTestId("storage-warning-banner"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("corrupted-warning-banner")).toBeInTheDocument();
  });

  it("한 저장소가 다시 저장해도 다른 저장소가 저장하지 못한 경고는 남는다", () => {
    reportPersistenceError(
      new DOMException("quota", "QuotaExceededError"),
      "presentation",
    );
    reportPersistenceError(new Error("boom"), "deck");
    render(<StorageWarningBanner />);

    act(() => clearPersistenceError("deck"));

    expect(screen.getByTestId("storage-warning-banner")).toHaveTextContent(
      ERROR_COPY.persistence.quota,
    );
  });

  it("격리된 저장본이 없으면 격리 안내를 렌더링하지 않는다", () => {
    reportCorruptedRecords([]);
    render(<StorageWarningBanner />);

    expect(
      screen.queryByTestId("corrupted-warning-banner"),
    ).not.toBeInTheDocument();
  });

  describe("저장 공간이 가득 찼을 때", () => {
    async function seedCachedVideo(url: string): Promise<void> {
      const cache = await caches.open(MEDIA_CACHE_NAME);
      await cache.put(url, new Response("media", { status: 200 }));
    }

    async function cachedVideos(): Promise<string[]> {
      const cache = await caches.open(MEDIA_CACHE_NAME);
      return (await cache.keys()).map((request) => request.url);
    }

    beforeEach(() => {
      resetFakeCacheStorage();
      installFakeLockManager();
      vi.mocked(toast.success).mockClear();
      vi.mocked(toast.info).mockClear();
      reportPersistenceError(
        new DOMException("quota", "QuotaExceededError"),
        "presentation",
      );
    });

    afterEach(() => {
      removeFakeLockManager();
    });

    it("휴지통을 비우라고 하지 않고, 저장한 배경 영상을 지울 수 있게 한다", async () => {
      await seedCachedVideo("/api/media/loops/a.mp4");
      await seedCachedVideo("/api/media/loops/b.mp4");
      render(<StorageWarningBanner />);

      expect(
        screen.getByTestId("storage-warning-banner"),
      ).not.toHaveTextContent(/휴지통/);
      fireEvent.click(
        screen.getByRole("button", { name: SHELL_COPY.storage.clearMedia }),
      );

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith(
          SHELL_COPY.storage.mediaCleared(2),
        );
      });
      expect(await cachedVideos()).toEqual([]);
    });

    it("지울 배경 영상이 없으면 기기 저장 공간을 비우라고 알린다", async () => {
      render(<StorageWarningBanner />);

      fireEvent.click(
        screen.getByRole("button", { name: SHELL_COPY.storage.clearMedia }),
      );

      await waitFor(() => {
        expect(toast.info).toHaveBeenCalledWith(
          SHELL_COPY.storage.noMediaToClear,
        );
      });
      expect(toast.success).not.toHaveBeenCalled();
    });
  });
});
