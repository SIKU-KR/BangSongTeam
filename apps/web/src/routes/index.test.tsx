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

  it("should render ChromeAlertBanner, sidebar, and presentation card without global header", () => {
    render(
      <MemoryRouter>
        <HomeRoute />
      </MemoryRouter>,
    );

    // Sidebar Title & Brand
    expect(screen.getByText("Worship Studio")).toBeInTheDocument();

    // Recommendation shelf should not be present
    expect(screen.queryByText("추천 및 빠른 시작")).not.toBeInTheDocument();

    // Header buttons should be completely removed
    expect(screen.queryByTestId("start-present-btn")).not.toBeInTheDocument();
    expect(screen.queryByTestId("open-quick-paste-btn")).not.toBeInTheDocument();
    expect(screen.queryByTestId("create-presentation-btn")).not.toBeInTheDocument();

    // Home should show single unit presentation card and create card
    expect(screen.getByTestId("presentation-card")).toBeInTheDocument();
    expect(screen.getByText("2026 주일 3부 예배")).toBeInTheDocument();
    expect(screen.getByText("5곡 세트")).toBeInTheDocument();
    expect(screen.getByText("23 슬라이드")).toBeInTheDocument();
    expect(screen.getByText("새 프레젠테이션 생성")).toBeInTheDocument();
  });

  it("should navigate to /present/fullscreen when card present button is clicked in Chrome", () => {
    vi.spyOn(chromeChecker, "isGoogleChromeBrowser").mockReturnValue(true);

    render(
      <MemoryRouter>
        <HomeRoute />
      </MemoryRouter>,
    );

    const startBtn = screen.getByTestId("card-present-btn");
    fireEvent.click(startBtn);

    expect(mockNavigate).toHaveBeenCalledWith("/present/fullscreen");
  });

  it("should prompt confirm dialog when card present button is clicked in non-Chrome browser", () => {
    vi.spyOn(chromeChecker, "isGoogleChromeBrowser").mockReturnValue(false);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(
      <MemoryRouter>
        <HomeRoute />
      </MemoryRouter>,
    );

    const startBtn = screen.getByTestId("card-present-btn");
    fireEvent.click(startBtn);

    // Should prompt confirm and NOT navigate if cancelled
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();

    // If confirmed:
    confirmSpy.mockReturnValue(true);
    fireEvent.click(startBtn);
    expect(mockNavigate).toHaveBeenCalledWith("/present/fullscreen");
  });

  it("should open QuickLyricPasteModal from song library and add new song into active setlist upon submission", () => {
    render(
      <MemoryRouter>
        <HomeRoute />
      </MemoryRouter>,
    );

    // Initially 5 songs in setlist
    expect(screen.getByText("5곡 세트")).toBeInTheDocument();

    // Navigate to Song Library via sidebar
    const songsNavBtn = screen.getByTestId("sidebar-nav-songs");
    fireEvent.click(songsNavBtn);

    // Open modal from Song Library
    const openBtn = screen.getByTestId("my-songs-quick-paste-btn");
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

    // Return to Home tab to see updated setlist
    const homeNavBtn = screen.getByTestId("sidebar-nav-home");
    fireEvent.click(homeNavBtn);

    // Setlist updated to 6 songs and new slide count displayed
    expect(screen.getByText("6곡 세트")).toBeInTheDocument();
  });

  it("should render updated sidebar navigation items without '내 콘티 보관함'", () => {
    render(
      <MemoryRouter>
        <HomeRoute />
      </MemoryRouter>,
    );

    // 사이드바 메뉴 확인
    expect(screen.getByTestId("sidebar-nav-home")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-nav-songs")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-nav-backgrounds")).toBeInTheDocument();

    // '내 콘티 보관함'은 완전히 제거되어 화면에 없어야 함
    expect(screen.queryByText("내 콘티 보관함")).not.toBeInTheDocument();

    expect(
      screen.getByTestId("sidebar-create-presentation-btn"),
    ).toBeInTheDocument();
  });

  it("should navigate to song library and background library via sidebar", () => {
    render(
      <MemoryRouter>
        <HomeRoute />
      </MemoryRouter>,
    );

    // 1. 곡 라이브러리 클릭
    const songsNavBtn = screen.getByTestId("sidebar-nav-songs");
    fireEvent.click(songsNavBtn);

    // 곡 라이브러리의 2단락 ("내가 등록한 곡", "유저가 등록한 곡") 표시 확인
    expect(screen.getByText("내가 등록한 곡")).toBeInTheDocument();
    expect(screen.getByText("유저가 등록한 곡")).toBeInTheDocument();

    // 2. 배경 라이브러리 클릭
    const backgroundsNavBtn = screen.getByTestId("sidebar-nav-backgrounds");
    fireEvent.click(backgroundsNavBtn);

    // 배경 라이브러리의 2단락 ("내가 등록한 배경", "유저가 등록한 배경") 표시 확인
    expect(screen.getByText("내가 등록한 배경")).toBeInTheDocument();
    expect(screen.getByText("유저가 등록한 배경")).toBeInTheDocument();

    // 3. 홈 클릭
    const homeNavBtn = screen.getByTestId("sidebar-nav-home");
    fireEvent.click(homeNavBtn);

    // 홈의 프레젠테이션 카드 복귀 확인
    expect(screen.getByTestId("presentation-card")).toBeInTheDocument();
  });
});
