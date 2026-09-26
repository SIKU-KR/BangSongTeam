import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { MEDIA_URL_PREFIX } from "#shared";
import {
  __loadDocumentsForTests,
  resetPresentationStore,
  SEED_PRESENTATIONS,
  SEED_PRESENTATION_IDS,
} from "../features/presentation";
import { PROJECTION_BACKLOG_DELAY_MS } from "../features/offline";
import {
  __resetMediaCachingForTests,
  __waitForMediaCachingForTests,
} from "../lib/offline/mediaCache";
import { resetFakeCacheStorage } from "../test/fakeCacheStorage";
import {
  TEST_SERVICE_BACKGROUNDS,
  withBackgrounds,
} from "../test/backgroundFixture";
import {
  resetBackgroundCatalogForTests,
  setBackgroundCatalogForTests,
} from "../features/backgrounds/backgroundCatalog";
import { signInAsTestUser } from "../test/sessionFixture";
import { withQueryClient } from "../test/queryClientFixture";
import { FullscreenPresentRoute } from "./FullscreenPresentRoute";

const DOC_ID = SEED_PRESENTATION_IDS[0];

function dispatchKey(key: string): void {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key, code: key, bubbles: true }),
  );
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.pathname;
  return input.url;
}

let fetchSpy: ReturnType<typeof vi.fn>;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  signInAsTestUser();
  resetPresentationStore();
  setBackgroundCatalogForTests(TEST_SERVICE_BACKGROUNDS, false, "local");
  __loadDocumentsForTests(
    SEED_PRESENTATIONS.map((presentation) =>
      withBackgrounds(
        presentation,
        TEST_SERVICE_BACKGROUNDS.map((bg) => bg.id),
      ),
    ),
  );
  resetFakeCacheStorage();
  __resetMediaCachingForTests();

  fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
    const url = urlOf(input);
    if (!url.startsWith(MEDIA_URL_PREFIX)) {
      throw new Error(`송출 중에는 API·데이터 요청을 하면 안 된다: ${url}`);
    }
    return new Response(new ArrayBuffer(8), { status: 200 });
  });
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
  vi.spyOn(window.HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
  resetBackgroundCatalogForTests();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function renderFullscreen() {
  return render(
    <MemoryRouter initialEntries={[`/present/${DOC_ID}/fullscreen`]}>
      <Routes>
        <Route
          path="/present/:presentationId/fullscreen"
          element={<FullscreenPresentRoute />}
        />
        <Route path="/presentations" element={<div />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function settleBackgroundCache(): Promise<void> {
  act(() => {
    vi.advanceTimersByTime(PROJECTION_BACKLOG_DELAY_MS);
  });
  vi.useRealTimers();
  await __waitForMediaCachingForTests();
}

function expectOnlyMediaRequests(): void {
  for (const [input] of fetchSpy.mock.calls) {
    expect(urlOf(input as RequestInfo | URL)).toMatch(
      new RegExp(`^${MEDIA_URL_PREFIX}`),
    );
  }
}

describe("송출 라우트 Zero-Fetch 불변식", () => {
  it("단독 전체화면 송출은 조작 내내 배경 미디어 캐시 말고는 fetch를 부르지 않는다", async () => {
    renderFullscreen();

    act(() => {
      dispatchKey("ArrowRight");
      dispatchKey("ArrowRight");
      dispatchKey("b");
      dispatchKey("h");
      dispatchKey("ArrowLeft");
      dispatchKey("1");
      dispatchKey("2");
      dispatchKey("Enter");
    });
    await settleBackgroundCache();

    expect(screen.getByTestId("fullscreen-present-route")).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalled();
    expectOnlyMediaRequests();
  });

  it("앱처럼 서버 캐시 공급자(QueryClient) 안에 있어도 API 요청을 하지 않는다", async () => {
    render(
      withQueryClient(
        <MemoryRouter initialEntries={[`/present/${DOC_ID}/fullscreen`]}>
          <Routes>
            <Route
              path="/present/:presentationId/fullscreen"
              element={<FullscreenPresentRoute />}
            />
          </Routes>
        </MemoryRouter>,
      ),
    );
    act(() => {
      dispatchKey("ArrowRight");
    });
    await settleBackgroundCache();

    expectOnlyMediaRequests();
  });

  it("오프라인이면 fetch를 하나도 부르지 않는다", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

    renderFullscreen();
    act(() => {
      dispatchKey("ArrowRight");
    });
    await settleBackgroundCache();

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
