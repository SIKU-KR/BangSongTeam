import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { PROJECTION_CHANNEL_NAME } from "@repo/shared";
import {
  __loadDocumentsForTests,
  resetPresentationStore,
  SEED_PRESENTATIONS,
  SEED_PRESENTATION_IDS,
} from "../features/presentation";
import { signInAsTestUser } from "../test/sessionFixture";
import { PresenterControlRoute } from "./PresenterControlRoute";

const DOC_ID = SEED_PRESENTATION_IDS[0];
const SET = SEED_PRESENTATIONS[0];

function renderControl(path = `/present/${DOC_ID}/control`) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/present/:presentationId/control"
          element={<PresenterControlRoute />}
        />
        <Route
          path="/presentations"
          element={<div data-testid="presentations-stub" />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

/** 송출 창 역할 채널 */
let audience: BroadcastChannel;
let received: Record<string, unknown>[];

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function dispatchKey(key: string): void {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key, code: key, bubbles: true }),
  );
}

const openSpy = vi.fn();
const originalOpen = window.open;

beforeEach(() => {
  signInAsTestUser();
  resetPresentationStore();
  __loadDocumentsForTests(SEED_PRESENTATIONS);
  received = [];
  audience = new BroadcastChannel(PROJECTION_CHANNEL_NAME);
  audience.onmessage = (event) => received.push(event.data);
  openSpy.mockReset().mockReturnValue({ close: vi.fn() } as unknown as Window);
  window.open = openSpy as unknown as typeof window.open;
});

afterEach(() => {
  audience.close();
  window.open = originalOpen;
  vi.restoreAllMocks();
});

function messagesOfType(type: string): Record<string, unknown>[] {
  return received.filter((message) => message?.type === type);
}

describe("PresenterControlRoute", () => {
  it("현재·다음 슬라이드와 곡 점프 패널을 보여 준다", async () => {
    renderControl();

    expect(screen.getByTestId("presenter-current-stage")).toBeInTheDocument();
    expect(screen.getByTestId("presenter-next-stage")).toBeInTheDocument();
    expect(screen.getAllByTestId("presenter-jump-song")).toHaveLength(
      SET.items.length,
    );
  });

  it("다음 버튼을 누르면 NAVIGATE_SLIDE를 보낸다", async () => {
    renderControl();

    fireEvent.click(screen.getByTestId("presenter-next-btn"));
    await flush();

    const navigations = messagesOfType("NAVIGATE_SLIDE");
    expect(navigations.at(-1)).toMatchObject({
      payload: { songIndex: 0, slideIndex: 1 },
    });
  });

  it("키보드 방향키도 같은 경로로 동작한다", async () => {
    renderControl();

    act(() => dispatchKey("ArrowRight"));
    await flush();

    expect(messagesOfType("NAVIGATE_SLIDE").at(-1)).toMatchObject({
      payload: { songIndex: 0, slideIndex: 1 },
    });
  });

  it("블랙아웃·가사 숨기기 토글을 방송한다", async () => {
    renderControl();

    fireEvent.click(screen.getByTestId("presenter-blackout-btn"));
    fireEvent.click(screen.getByTestId("presenter-lyrics-btn"));
    await flush();

    expect(messagesOfType("SET_BLACKOUT").at(-1)).toMatchObject({
      payload: { isBlackout: true },
    });
    expect(messagesOfType("SET_LYRICS_HIDDEN").at(-1)).toMatchObject({
      payload: { isLyricsHidden: true },
    });
    expect(screen.getByTestId("presenter-blackout-btn")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("점프 패널 클릭으로 곡과 슬라이드를 옮긴다", async () => {
    renderControl();

    fireEvent.click(screen.getByTestId("presenter-jump-slide-1-1"));
    await flush();

    expect(messagesOfType("NAVIGATE_SLIDE").at(-1)).toMatchObject({
      payload: { songIndex: 1, slideIndex: 1 },
    });
  });

  it("송출 창이 마운트되면 즉시 현재 상태 스냅샷을 회신한다", async () => {
    renderControl();

    // 먼저 상태를 바꿔 둔다 — 늦게 열린 창도 지금 위치를 받아야 한다.
    fireEvent.click(screen.getByTestId("presenter-next-btn"));
    fireEvent.click(screen.getByTestId("presenter-blackout-btn"));
    await flush();

    await act(async () => {
      audience.postMessage({
        type: "AUDIENCE_MOUNTED",
        timestamp: Date.now(),
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const snapshot = messagesOfType("SYNC_SNAPSHOT").at(-1);
    expect(snapshot).toMatchObject({
      payload: {
        presentationId: DOC_ID,
        currentSongIndex: 0,
        currentSlideIndex: 1,
        isBlackout: true,
        isLyricsHidden: false,
      },
    });
  });

  it("숫자 버퍼를 조작 창에만 표시한다", async () => {
    renderControl();

    act(() => {
      dispatchKey("2");
      dispatchKey(".");
      dispatchKey("1");
    });

    expect(screen.getByTestId("presenter-buffer")).toHaveTextContent("2.1");
  });

  it("없는 번호를 입력하면 조작 창에 알림을 띄운다", async () => {
    renderControl();

    act(() => {
      dispatchKey("9");
      dispatchKey("9");
      dispatchKey("Enter");
    });

    expect(screen.getByTestId("presenter-invalid-jump")).toBeInTheDocument();
  });

  it("송출 창 열기 버튼이 청중 모드 창을 연다", async () => {
    renderControl();

    fireEvent.click(screen.getByTestId("presenter-open-audience-btn"));

    await waitFor(() => expect(openSpy).toHaveBeenCalled());
    expect(openSpy.mock.calls[0][0]).toBe(
      `/present/${DOC_ID}/fullscreen?audience=1`,
    );
    expect(openSpy.mock.calls[0][1]).toBe("WorshipAudienceWindow");
  });

  it("Esc로는 종료하지 않는다 (종료는 버튼으로만)", async () => {
    renderControl();

    act(() => dispatchKey("Escape"));
    await flush();

    expect(screen.getByTestId("presenter-control-route")).toBeInTheDocument();
    expect(
      screen.queryByTestId("presentations-stub"),
    ).not.toBeInTheDocument();
  });

  it("종료 버튼이 청중 창을 닫고 대시보드로 돌아간다", async () => {
    const close = vi.fn();
    openSpy.mockReturnValue({ close } as unknown as Window);
    renderControl();

    fireEvent.click(screen.getByTestId("presenter-open-audience-btn"));
    await waitFor(() => expect(openSpy).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId("presenter-exit-btn"));

    expect(close).toHaveBeenCalled();
    expect(
      await screen.findByTestId("presentations-stub"),
    ).toBeInTheDocument();
  });

  it("송출 창 연결 상태를 보여 준다", async () => {
    renderControl();

    expect(screen.getByTestId("presenter-peer-state")).toHaveAttribute(
      "data-state",
      "disconnected",
    );

    await act(async () => {
      audience.postMessage({
        type: "AUDIENCE_MOUNTED",
        timestamp: Date.now(),
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.getByTestId("presenter-peer-state")).toHaveAttribute(
      "data-state",
      "connected",
    );
  });

  it("없는 세트는 대시보드로 되돌린다", async () => {
    renderControl("/present/99999999-9999-4999-8999-999999999999/control");

    expect(
      await screen.findByTestId("presentations-stub"),
    ).toBeInTheDocument();
  });
});
