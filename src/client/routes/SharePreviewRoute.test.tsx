import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "../test/router";
import type { PresentationDocument } from "#shared";
import { signOutForTests } from "../test/sessionFixture";
import { withQueryClient } from "../test/queryClientFixture";
import { installFakeApi, type FakeApi } from "../test/fakeApi";
import {
  getPresentationById,
  resetPresentationStore,
} from "../features/presentation/presentationStore";
import {
  resetBackgroundCatalogForTests,
  setBackgroundCatalogForTests,
} from "../features/backgrounds/backgroundCatalog";
import { AUTO_CACHE_DELAY_MS } from "../features/offline/useBackgroundAutoCache";
import { __resetMediaCachingForTests } from "../lib/offline/mediaCache";
import { resetFakeCacheStorage } from "../test/fakeCacheStorage";
import {
  installServiceWorker,
  removeServiceWorker,
} from "../test/serviceWorkerFixture";
import {
  TEST_SERVICE_BACKGROUNDS,
  withBackgrounds,
} from "../test/backgroundFixture";
import { SharePreviewRoute } from "./SharePreviewRoute";
import { API_ERRORS } from "#shared";
import { SEED_PRESENTATIONS } from "../test/presentationFixture";

const OWNER = "0000000000000000owner";

function renderAt(path: string) {
  return render(
    withQueryClient(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/s/:token" element={<SharePreviewRoute />} />
          <Route path="/" element={<p data-testid="root-probe" />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

describe("SharePreviewRoute (로그인하지 않은 /s/:token)", () => {
  let api: FakeApi | null = null;
  const shared = {
    ...SEED_PRESENTATIONS[0],
    userId: OWNER,
    folderId: null,
    access: { ownerName: "인도자" },
  } as PresentationDocument;

  beforeEach(() => {
    signOutForTests();
    resetPresentationStore();
  });

  afterEach(() => api?.restore());

  it("로그인 없이 보기 전용 편집기로 연다", async () => {
    api = installFakeApi({
      "GET /api/share/*": () => ({ body: { document: shared } }),
    });
    renderAt("/s/tok-first");

    expect(await screen.findByTestId("read-only-banner")).toHaveTextContent(
      "로그인하고 사본을 만들어 주세요",
    );
    expect(screen.getByTestId("header-shared-badge")).toHaveTextContent(
      "인도자님이 공유",
    );
    expect(screen.queryByTestId("header-back-btn")).not.toBeInTheDocument();
    expect(screen.queryByTestId("header-share-btn")).not.toBeInTheDocument();
    expect(getPresentationById(shared.id)?.access).toEqual({
      ownerName: "인도자",
    });
    expect(api.calls.some((call) => call.path.endsWith("/join"))).toBe(false);
  });

  it("사본 만들기를 누르면 로그인 화면을 띄우고, 돌아가면 다시 세트를 본다", async () => {
    api = installFakeApi({
      "GET /api/share/*": () => ({ body: { document: shared } }),
    });
    renderAt("/s/tok-first");

    fireEvent.click(await screen.findByTestId("make-copy-btn"));

    expect(await screen.findByTestId("login-description")).toHaveTextContent(
      "사본을 내 드라이브에 만들어",
    );
    expect(screen.queryByTestId("editor-route")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("login-cancel-btn"));

    await waitFor(() =>
      expect(screen.getByTestId("editor-route")).toBeInTheDocument(),
    );
  });

  it("만료된 링크는 안내를 보여 준다", async () => {
    api = installFakeApi({
      "GET /api/share/*": () => ({
        status: 404,
        body: { error: API_ERRORS.share.linkUnavailable },
      }),
    });
    renderAt("/s/expired");

    expect(await screen.findByTestId("share-link-error")).toHaveTextContent(
      API_ERRORS.share.linkUnavailable,
    );
  });

  describe("손님이 본 프레젠테이션의 배경", () => {
    const backgrounds = TEST_SERVICE_BACKGROUNDS.slice(0, 3);
    const withVideos = {
      ...shared,
      ...withBackgrounds(
        SEED_PRESENTATIONS[0],
        backgrounds.map((bg) => bg.id),
      ),
      userId: OWNER,
      folderId: null,
      access: { ownerName: "인도자" },
    } as PresentationDocument;

    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      resetFakeCacheStorage();
      __resetMediaCachingForTests();
      installServiceWorker({ controlled: true });
      setBackgroundCatalogForTests(TEST_SERVICE_BACKGROUNDS);
      vi.spyOn(window.HTMLMediaElement.prototype, "play").mockResolvedValue();
      vi.spyOn(window.HTMLMediaElement.prototype, "pause").mockReturnValue();
      vi.spyOn(window.HTMLMediaElement.prototype, "load").mockReturnValue();
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
      removeServiceWorker();
      resetBackgroundCatalogForTests();
      __resetMediaCachingForTests();
    });

    it("영상은 통째로 받지 않고 스트리밍하며, 포스터만 담고 헤더에 저장 진행을 띄우지 않는다", async () => {
      api = installFakeApi({
        "GET /api/share/*": () => ({ body: { document: withVideos } }),
        "GET /api/backgrounds": () => ({
          body: { backgrounds: TEST_SERVICE_BACKGROUNDS },
        }),
      });
      renderAt("/s/tok-first");
      await screen.findByTestId("read-only-banner");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(AUTO_CACHE_DELAY_MS);
      });

      const mediaPaths = api.calls
        .map((call) => call.path)
        .filter((path) => path.startsWith("/api/media/"));
      expect(
        mediaPaths.some((path) => path.startsWith("/api/media/loops/")),
      ).toBe(false);
      expect(
        mediaPaths.some((path) => path.startsWith("/api/media/posters/")),
      ).toBe(true);
      expect(screen.getByTestId("video-slot-a")).toHaveAttribute(
        "src",
        backgrounds[0].mediaUrl,
      );
      expect(screen.queryByTestId("header-media-progress")).toBeNull();
      expect(screen.queryByTestId("header-media-failure")).toBeNull();
    });
  });
});
