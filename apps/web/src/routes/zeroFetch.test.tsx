import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import {
  __loadDocumentsForTests,
  resetPresentationStore,
  SEED_PRESENTATIONS,
  SEED_PRESENTATION_IDS,
} from "../features/presentation";
import { signInAsTestUser } from "../test/sessionFixture";
import { withQueryClient } from "../test/queryClientFixture";
import { FullscreenPresentRoute } from "./FullscreenPresentRoute";
import { PresenterControlRoute } from "./PresenterControlRoute";

/**
 * Zero-Fetch 불변식 (AGENTS.md 6, TECH_SPEC 5.4-4).
 *
 * "송출 화면 실행 중에 외부 네트워크 fetch를 호출하는 행위"는 금지 사항으로
 * 문서에만 적혀 있었고 강제하는 장치가 없었다. 여기서 테스트로 고정한다.
 *
 * 이 테스트가 막는 것은 **앱 코드가 직접 부르는 fetch**다. 배경 영상은
 * `<video src>`로 브라우저가 가져가며(jsdom에서는 일어나지 않는다), 그쪽은
 * Service Worker의 CacheFirst가 덮는다.
 */

const DOC_ID = SEED_PRESENTATION_IDS[0];

function dispatchKey(key: string): void {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key, code: key, bubbles: true }),
  );
}

let fetchSpy: ReturnType<typeof vi.fn>;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  signInAsTestUser();
  resetPresentationStore();
  __loadDocumentsForTests(SEED_PRESENTATIONS);

  // 호출되면 그 자리에서 터뜨린다 — 조용히 삼켜지는 fetch를 놓치지 않기 위해서다.
  fetchSpy = vi.fn(() => {
    throw new Error("송출 중에는 네트워크 요청을 하면 안 된다");
  });
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function renderFullscreen(search = "") {
  return render(
    <MemoryRouter initialEntries={[`/present/${DOC_ID}/fullscreen${search}`]}>
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

function renderControl() {
  return render(
    <MemoryRouter initialEntries={[`/present/${DOC_ID}/control`]}>
      <Routes>
        <Route
          path="/present/:presentationId/control"
          element={<PresenterControlRoute />}
        />
        <Route path="/presentations" element={<div />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("송출 라우트 Zero-Fetch 불변식", () => {
  it("단독 전체화면 송출은 조작 내내 fetch를 부르지 않는다", () => {
    renderFullscreen();

    act(() => {
      dispatchKey("ArrowRight");
      dispatchKey("ArrowRight");
      dispatchKey("b");
      dispatchKey("h");
      dispatchKey("ArrowLeft");
      dispatchKey("2");
      dispatchKey(".");
      dispatchKey("1");
      dispatchKey("Enter");
    });

    expect(screen.getByTestId("fullscreen-present-route")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("청중 창도 fetch를 부르지 않는다", () => {
    renderFullscreen("?audience=1");

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("발표자 조작 창도 fetch를 부르지 않는다", () => {
    renderControl();

    act(() => {
      dispatchKey("ArrowRight");
      dispatchKey("b");
    });
    fireEvent.click(screen.getByTestId("presenter-next-btn"));
    fireEvent.click(screen.getByTestId("presenter-lyrics-btn"));
    fireEvent.click(screen.getByTestId("presenter-jump-slide-1-1"));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("앱처럼 서버 캐시 공급자(QueryClient) 안에 있어도 fetch를 부르지 않는다 (M5)", () => {
    // App은 로그인 뒤 모든 라우트를 QueryClientProvider로 감싼다. 공급자는 스스로
    // 요청하지 않고, 송출 화면은 서버 캐시 훅을 import하지 않는다(ESLint 가드).
    render(
      withQueryClient(
        <MemoryRouter initialEntries={[`/present/${DOC_ID}/control`]}>
          <Routes>
            <Route
              path="/present/:presentationId/control"
              element={<PresenterControlRoute />}
            />
          </Routes>
        </MemoryRouter>,
      ),
    );
    act(() => {
      dispatchKey("ArrowRight");
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
