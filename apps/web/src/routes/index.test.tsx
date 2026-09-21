import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { HomeRoute } from "./index";
import { resetActiveSetlist } from "../features/presentation";
import * as chromeChecker from "../components/common/ChromeAlertBanner";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe("HomeRoute (Main Home Entry Screen)", () => {
  beforeEach(() => {
    resetActiveSetlist();
    mockNavigate.mockClear();
    vi.restoreAllMocks();
  });

  it("should render ChromeAlertBanner, title, and action buttons without recommendation shelf", () => {
    render(
      <MemoryRouter>
        <HomeRoute />
      </MemoryRouter>,
    );

    // Title & Brand
    expect(screen.getByText(/Worship Slide/i)).toBeInTheDocument();

    // Recommendation shelf should be completely removed
    expect(screen.queryByText("추천 및 빠른 시작")).not.toBeInTheDocument();

    // Start Presentation button in global header
    expect(screen.getByTestId("start-present-btn")).toBeInTheDocument();
    expect(screen.getByText("송출 시작하기")).toBeInTheDocument();

    // Quick Lyric Paste Button
    expect(screen.getByText("가사 빠른 입력")).toBeInTheDocument();
    expect(screen.getByTestId("open-quick-paste-btn")).toBeInTheDocument();

    // 5-Song Setlist Overview
    expect(screen.getByText("은혜로다")).toBeInTheDocument();
    expect(screen.getByText("주 품에")).toBeInTheDocument();
    expect(screen.getByText("시선")).toBeInTheDocument();
    expect(screen.getByText("꽃들도")).toBeInTheDocument();
    expect(screen.getByText("주의 이름 높이며")).toBeInTheDocument();
  });

  it("should navigate to /present/fullscreen when start presentation button is clicked in Chrome", () => {
    vi.spyOn(chromeChecker, "isGoogleChromeBrowser").mockReturnValue(true);

    render(
      <MemoryRouter>
        <HomeRoute />
      </MemoryRouter>,
    );

    const startBtn = screen.getByTestId("start-present-btn");
    fireEvent.click(startBtn);

    expect(mockNavigate).toHaveBeenCalledWith("/present/fullscreen");
  });

  it("should prompt confirm dialog when start presentation button is clicked in non-Chrome browser", () => {
    vi.spyOn(chromeChecker, "isGoogleChromeBrowser").mockReturnValue(false);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(
      <MemoryRouter>
        <HomeRoute />
      </MemoryRouter>,
    );

    const startBtn = screen.getByTestId("start-present-btn");
    fireEvent.click(startBtn);

    // Should prompt confirm and NOT navigate if cancelled
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();

    // If confirmed:
    confirmSpy.mockReturnValue(true);
    fireEvent.click(startBtn);
    expect(mockNavigate).toHaveBeenCalledWith("/present/fullscreen");
  });

  it("should open QuickLyricPasteModal and add new song into active setlist upon submission", () => {
    render(
      <MemoryRouter>
        <HomeRoute />
      </MemoryRouter>,
    );

    // Initially 5 songs
    expect(screen.getByText(/5곡 준비 완료/)).toBeInTheDocument();

    // Open modal
    const openBtn = screen.getByTestId("open-quick-paste-btn");
    fireEvent.click(openBtn);
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

    // Setlist updated to 6 songs and new title displayed!
    expect(screen.getByText(/6곡 준비 완료/)).toBeInTheDocument();
    expect(screen.getByText("아침 안개 눈 앞 가리듯")).toBeInTheDocument();
  });

  it("should render Canva sidebar navigation items and offline badge", () => {
    render(
      <MemoryRouter>
        <HomeRoute />
      </MemoryRouter>,
    );

    expect(screen.getByText("홈 (대시보드)")).toBeInTheDocument();
    expect(screen.getByText("내 콘티 보관함")).toBeInTheDocument();
    expect(screen.getByText("찬양 곡 라이브러리")).toBeInTheDocument();
    expect(screen.getByText("모션 배경 루프 (10종)")).toBeInTheDocument();
    expect(
      screen.getByTestId("sidebar-create-presentation-btn"),
    ).toBeInTheDocument();
  });

  it("should switch between grid view and list view with 16:9 thumbnails", () => {
    render(
      <MemoryRouter>
        <HomeRoute />
      </MemoryRouter>,
    );

    // Click list view button
    const listViewBtn = screen.getByTitle("목록 뷰 (16:9 미니 프리뷰)");
    fireEvent.click(listViewBtn);

    // List view should show 16:9 badge inside thumbnails
    expect(screen.getAllByText("16:9").length).toBeGreaterThan(0);

    // Switch back to grid view
    const gridViewBtn = screen.getByTitle("그리드 뷰 (16:9 슬라이드 카드)");
    fireEvent.click(gridViewBtn);

    expect(screen.getAllByTestId("presentation-card").length).toBeGreaterThan(
      0,
    );
  });
});
