import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import {
  PROJECTION_CHANNEL_NAME,
  type BroadcastMessage,
} from "@repo/shared";
import {
  __loadDocumentsForTests,
  resetPresentationStore,
  SEED_PRESENTATIONS,
  SEED_PRESENTATION_IDS,
} from "../features/presentation";
import { signInAsTestUser } from "../test/sessionFixture";
import { FullscreenPresentRoute } from "./FullscreenPresentRoute";

const DOC_ID = SEED_PRESENTATION_IDS[0];
const SET = SEED_PRESENTATIONS[0];

function renderAudience() {
  return render(
    <MemoryRouter initialEntries={[`/present/${DOC_ID}/fullscreen?audience=1`]}>
      <Routes>
        <Route
          path="/present/:presentationId/fullscreen"
          element={<FullscreenPresentRoute />}
        />
        <Route
          path="/presentations"
          element={<div data-testid="presentations-stub" />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

let controller: BroadcastChannel;

/** 조작 창 역할로 메시지를 보내고 수신이 반영될 때까지 기다린다 */
async function postFromController(message: BroadcastMessage): Promise<void> {
  await act(async () => {
    controller.postMessage(message);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function dispatchKey(key: string): void {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key, code: key, bubbles: true }),
  );
}

beforeEach(() => {
  signInAsTestUser();
  resetPresentationStore();
  __loadDocumentsForTests(SEED_PRESENTATIONS);
  controller = new BroadcastChannel(PROJECTION_CHANNEL_NAME);
});

afterEach(() => {
  controller.close();
  vi.restoreAllMocks();
});

describe("FullscreenPresentRoute — 청중 모드 (?audience=1)", () => {
  it("마운트하면 조작 창에 AUDIENCE_MOUNTED를 알린다", async () => {
    const received: string[] = [];
    controller.onmessage = (event) => received.push(event.data?.type);

    renderAudience();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(received).toContain("AUDIENCE_MOUNTED");
  });

  it("SYNC_SNAPSHOT을 받으면 그 위치로 복원한다", async () => {
    renderAudience();

    const targetLines = SET.items[1].deck!.slides[1].lines;
    await postFromController({
      type: "SYNC_SNAPSHOT",
      timestamp: Date.now(),
      payload: {
        presentationId: DOC_ID,
        currentSongIndex: 1,
        currentSlideIndex: 1,
        isBlackout: false,
        isLyricsHidden: false,
      },
    });

    for (const line of targetLines) {
      expect(screen.getAllByText(line).length).toBeGreaterThan(0);
    }
  });

  it("NAVIGATE_SLIDE를 따라 슬라이드를 옮긴다", async () => {
    renderAudience();

    await postFromController({
      type: "NAVIGATE_SLIDE",
      timestamp: Date.now(),
      payload: { songIndex: 0, slideIndex: 2 },
    });

    // 후렴은 같은 줄이 한 슬라이드에 두 번 나오기도 한다.
    for (const line of SET.items[0].deck!.slides[2].lines) {
      expect(screen.getAllByText(line).length).toBeGreaterThan(0);
    }
  });

  it("범위를 벗어난 인덱스가 와도 빈 화면이 되지 않는다", async () => {
    renderAudience();

    await postFromController({
      type: "NAVIGATE_SLIDE",
      timestamp: Date.now(),
      payload: { songIndex: 999, slideIndex: 999 },
    });

    const lastSong = SET.items[SET.items.length - 1].deck!;
    const lastSlide = lastSong.slides[lastSong.slides.length - 1];
    expect(screen.getAllByText(lastSlide.lines[0]).length).toBeGreaterThan(0);
  });

  it("SET_BLACKOUT과 SET_LYRICS_HIDDEN을 반영한다", async () => {
    renderAudience();
    const firstLine = SET.items[0].deck!.slides[0].lines[0];

    await postFromController({
      type: "SET_LYRICS_HIDDEN",
      timestamp: Date.now(),
      payload: { isLyricsHidden: true },
    });

    expect(screen.getAllByText(firstLine).length).toBeGreaterThan(0);

    await postFromController({
      type: "SET_BLACKOUT",
      timestamp: Date.now(),
      payload: { isBlackout: true },
    });

    // 블랙아웃은 오버레이 불투명도 1로 나타난다.
    const overlay = screen.getByTestId("overlay-layer");
    expect(overlay).toHaveStyle({ opacity: "1" });
  });

  it("청중 창의 키보드 입력은 무시한다 (조작은 조작 창에서만)", async () => {
    renderAudience();
    const firstLine = SET.items[0].deck!.slides[0].lines[0];

    act(() => {
      dispatchKey("ArrowRight");
    });

    // 여전히 첫 슬라이드여야 한다.
    expect(screen.getAllByText(firstLine).length).toBeGreaterThan(0);
  });

  it("전체화면이 아니면 프로젝터 이동 안내를 띄운다", async () => {
    renderAudience();

    expect(
      await screen.findByTestId("audience-fullscreen-hint"),
    ).toBeInTheDocument();
  });

  it("전체화면이 풀려도 라우트를 떠나지 않는다", async () => {
    renderAudience();

    await act(async () => {
      document.dispatchEvent(new Event("fullscreenchange"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(
      screen.queryByTestId("presentations-stub"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("fullscreen-present-route")).toBeInTheDocument();
  });

  it("종료 버튼이 대시보드 이동 대신 창을 닫는다", async () => {
    const closeSpy = vi.spyOn(window, "close").mockImplementation(() => {});
    renderAudience();

    fireEvent.click(screen.getByTestId("exit-present-btn"));

    await waitFor(() => expect(closeSpy).toHaveBeenCalled());
    expect(
      screen.queryByTestId("presentations-stub"),
    ).not.toBeInTheDocument();
  });
});
