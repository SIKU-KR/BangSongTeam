import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AppShellLayout } from "./AppShellLayout";
import { PresentationsRoute } from "./PresentationsRoute";
import { LyricsRoute } from "./LyricsRoute";
import { BackgroundsRoute } from "./BackgroundsRoute";
import {
  resetPresentationStore,
  listPresentations,
} from "../features/presentation";
import * as chromeChecker from "../components/common/ChromeAlertBanner";

/**
 * 전역 `vi.mock("react-router-dom", ... useNavigate)` 는 쓰지 않는다.
 * 사이드바가 실제 navigate(path)로 <Outlet/>을 전환하므로 목이 있으면
 * 탭 전환 자체가 일어나지 않는다. 대신 스텁 라우트로 이동을 관측한다.
 */
function renderShell(initialPath = "/presentations") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<AppShellLayout />}>
          <Route path="/presentations" element={<PresentationsRoute />} />
          <Route path="/lyrics" element={<LyricsRoute />} />
          <Route path="/backgrounds" element={<BackgroundsRoute />} />
        </Route>
        <Route
          path="/present/:presentationId/fullscreen"
          element={<div data-testid="fullscreen-stub" />}
        />
        <Route
          path="/editor/:presentationId"
          element={<div data-testid="editor-stub" />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AppShellLayout (공유 셸 + 중첩 라우트)", () => {
  beforeEach(() => {
    resetPresentationStore();
    vi.restoreAllMocks();
  });

  it("should render ChromeAlertBanner, sidebar, and presentation card without global header", () => {
    renderShell();

    // Sidebar Title & Brand
    expect(screen.getByText("Worship Studio")).toBeInTheDocument();

    // Recommendation shelf should not be present
    expect(screen.queryByText("추천 및 빠른 시작")).not.toBeInTheDocument();

    // Header buttons should be completely removed
    expect(screen.queryByTestId("start-present-btn")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("open-quick-paste-btn"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("create-presentation-btn"),
    ).not.toBeInTheDocument();

    // Home should show the presentation card and the create card
    expect(screen.getByTestId("presentation-card")).toBeInTheDocument();
    expect(screen.getByText("2026 주일 3부 예배")).toBeInTheDocument();
    expect(screen.getByText("5곡 세트")).toBeInTheDocument();
    expect(screen.getByText("23 슬라이드")).toBeInTheDocument();
    expect(screen.getByText("새 프레젠테이션 생성")).toBeInTheDocument();
  });

  it("should navigate to the presentation's fullscreen route when card present button is clicked in Chrome", () => {
    vi.spyOn(chromeChecker, "isGoogleChromeBrowser").mockReturnValue(true);

    renderShell();

    fireEvent.click(screen.getByTestId("card-present-btn"));

    expect(screen.getByTestId("fullscreen-stub")).toBeInTheDocument();
  });

  it("should prompt confirm dialog when card present button is clicked in non-Chrome browser", () => {
    vi.spyOn(chromeChecker, "isGoogleChromeBrowser").mockReturnValue(false);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    renderShell();

    const startBtn = screen.getByTestId("card-present-btn");
    fireEvent.click(startBtn);

    // Should prompt confirm and NOT navigate if cancelled
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("fullscreen-stub")).not.toBeInTheDocument();

    // If confirmed:
    confirmSpy.mockReturnValue(true);
    fireEvent.click(startBtn);
    expect(screen.getByTestId("fullscreen-stub")).toBeInTheDocument();
  });

  it("should open QuickLyricPasteModal from song library and add new song into active presentation upon submission", () => {
    renderShell();

    // Initially 5 songs in presentation
    expect(screen.getByText("5곡 세트")).toBeInTheDocument();

    // Navigate to Song Library via sidebar
    fireEvent.click(screen.getByTestId("sidebar-nav-songs"));

    // Open modal from Song Library
    fireEvent.click(screen.getByTestId("my-songs-quick-paste-btn"));
    expect(screen.getByText("빠른 가사 붙여넣기")).toBeInTheDocument();

    // Fill form
    const titleInput = screen.getByLabelText(/곡 제목/);
    const lyricsInput = screen.getByLabelText(/가사 원문/);

    act(() => {
      fireEvent.change(titleInput, {
        target: { value: "아침 안개 눈 앞 가리듯" },
      });
      fireEvent.change(lyricsInput, {
        target: {
          value:
            "아침 안개 눈 앞 가리듯\n나의 눈물 앞 가릴 때\n\n임마누엘 주 찬양하리",
        },
      });
    });

    // Click "세트에 추가"
    const addBtn = screen.getByRole("button", { name: "세트에 추가" });
    act(() => {
      fireEvent.click(addBtn);
    });

    // Modal closed
    expect(screen.queryByText("빠른 가사 붙여넣기")).not.toBeInTheDocument();

    // Return to the dashboard to see the updated presentation
    fireEvent.click(screen.getByTestId("sidebar-nav-home"));

    // Presentation updated to 6 songs
    expect(screen.getByText("6곡 세트")).toBeInTheDocument();
  });

  it("should render updated sidebar navigation items without '내 프레젠테이션 보관함'", () => {
    renderShell();

    expect(screen.getByTestId("sidebar-nav-home")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-nav-songs")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-nav-backgrounds")).toBeInTheDocument();

    expect(
      screen.queryByText("내 프레젠테이션 보관함"),
    ).not.toBeInTheDocument();

    expect(
      screen.getByTestId("sidebar-create-presentation-btn"),
    ).toBeInTheDocument();
  });

  it("should navigate to song library and background library via sidebar", () => {
    renderShell();

    // 1. 곡 라이브러리 클릭
    fireEvent.click(screen.getByTestId("sidebar-nav-songs"));
    expect(screen.getByText("내가 등록한 곡")).toBeInTheDocument();
    expect(screen.getByText("유저가 등록한 곡")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "곡 라이브러리" }),
    ).toBeInTheDocument();

    // 2. 배경 라이브러리 클릭
    fireEvent.click(screen.getByTestId("sidebar-nav-backgrounds"));
    expect(screen.getByText("내가 등록한 배경")).toBeInTheDocument();
    expect(screen.getByText("유저가 등록한 배경")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "배경 라이브러리" }),
    ).toBeInTheDocument();

    // 3. 홈 클릭
    fireEvent.click(screen.getByTestId("sidebar-nav-home"));
    expect(screen.getByTestId("presentation-card")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "모든 프로젝트" }),
    ).toBeInTheDocument();
  });

  it("경로 기반 활성 상태가 사이드바에 aria-current로 반영된다", () => {
    renderShell("/lyrics");

    expect(screen.getByTestId("sidebar-nav-songs")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByTestId("sidebar-nav-home")).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("시드 문서 5개가 모두 목록에 나타난다", () => {
    renderShell();

    for (const presentation of listPresentations()) {
      expect(screen.getAllByText(presentation.title).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("5개 프로젝트")).toBeInTheDocument();
  });

  it("사이드바 CTA는 새 문서를 만들고 /editor/:presentationId 로 이동한다", () => {
    renderShell();

    act(() => {
      fireEvent.click(screen.getByTestId("sidebar-create-presentation-btn"));
    });

    expect(screen.getByTestId("editor-stub")).toBeInTheDocument();
    expect(listPresentations()).toHaveLength(6);
  });

  it("카드를 클릭하면 해당 문서의 에디터로 이동한다", () => {
    renderShell();

    act(() => {
      // 썸네일과 카드 제목 두 곳에 나타나므로 첫 번째(카드 본체)를 클릭
      fireEvent.click(screen.getAllByText("수요 성령기도회")[0]);
    });

    expect(screen.getByTestId("editor-stub")).toBeInTheDocument();
  });

  it("should render theme menu button at the bottom of the sidebar and toggle theme options", () => {
    renderShell();

    const themeBtn = screen.getByTestId("theme-menu-button");
    expect(themeBtn).toBeInTheDocument();

    fireEvent.click(themeBtn);
    expect(screen.getByTestId("theme-menu-dropdown")).toBeInTheDocument();
    expect(screen.getByTestId("theme-option-light")).toBeInTheDocument();
    expect(screen.getByTestId("theme-option-dark")).toBeInTheDocument();
    expect(screen.getByTestId("theme-option-system")).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByTestId("theme-option-light"));
    });

    expect(screen.queryByTestId("theme-menu-dropdown")).not.toBeInTheDocument();
    expect(screen.getByText("라이트 모드")).toBeInTheDocument();
  });
});
