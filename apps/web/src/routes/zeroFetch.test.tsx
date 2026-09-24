import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { MEDIA_URL_PREFIX } from "@repo/shared";
import {
  __loadDocumentsForTests,
  resetPresentationStore,
  SEED_PRESENTATIONS,
  SEED_PRESENTATION_IDS,
} from "../features/presentation";
import { AUTO_CACHE_DELAY_MS } from "../features/offline";
import {
  __resetMediaCachingForTests,
  __waitForMediaCachingForTests,
} from "../lib/offline/mediaCache";
import { resetFakeCacheStorage } from "../test/fakeCacheStorage";
import { signInAsTestUser } from "../test/sessionFixture";
import { withQueryClient } from "../test/queryClientFixture";
import { FullscreenPresentRoute } from "./FullscreenPresentRoute";

/**
 * Zero-Fetch 불변식 (AGENTS.md 6.5, TECH_SPEC 5.4-4).
 *
 * 송출 화면은 API·데이터 요청을 하지 않는다. 문서는 IndexedDB에서 하이드레이션된
 * 메모리 상태에서만 읽는다. 앱 코드가 부르는 fetch 중 허용되는 것은 배경
 * 미디어(`MEDIA_URL_PREFIX`)를 조용히 받아 두는 백그라운드 캐시뿐이다
 * (예배 준비 화면을 대신한다, 2026-09-24). `<video src>` 재생은 브라우저가 가져가며
 * (jsdom에서는 일어나지 않는다), 그쪽은 Service Worker의 CacheFirst가 덮는다.
 */

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
  __loadDocumentsForTests(SEED_PRESENTATIONS);
  resetFakeCacheStorage();
  __resetMediaCachingForTests();

  // 미디어 캐시가 아닌 요청은 그 자리에서 터뜨린다 — 조용히 삼켜지는 fetch를
  // 놓치지 않기 위해서다.
  fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
    const url = urlOf(input);
    if (!url.startsWith(MEDIA_URL_PREFIX)) {
      throw new Error(`송출 중에는 API·데이터 요청을 하면 안 된다: ${url}`);
    }
    return new Response(new ArrayBuffer(8), { status: 200 });
  });
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
  // jsdom의 play()는 Promise를 돌려주지 않는다. 곡 전환 시 VideoLayer가 부른다.
  vi.spyOn(window.HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
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

/** 백그라운드 캐시 지연을 넘기고 큐가 빌 때까지 기다린다 */
async function settleBackgroundCache(): Promise<void> {
  act(() => {
    vi.advanceTimersByTime(AUTO_CACHE_DELAY_MS);
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
    // 세트에 배경이 있으므로 백그라운드 캐시가 실제로 돌았다.
    expect(fetchSpy).toHaveBeenCalled();
    expectOnlyMediaRequests();
  });

  it("앱처럼 서버 캐시 공급자(QueryClient) 안에 있어도 API 요청을 하지 않는다 (M5)", async () => {
    // App은 로그인 뒤 모든 라우트를 QueryClientProvider로 감싼다. 공급자는 스스로
    // 요청하지 않고, 송출 화면은 서버 캐시 훅을 import하지 않는다(ESLint 가드).
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
