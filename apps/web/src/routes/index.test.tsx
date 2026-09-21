import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { HomeRoute } from "./index";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe("HomeRoute (Main Home Entry Screen)", () => {
  it("should render ChromeAlertBanner, title, and M1 cards", () => {
    render(
      <MemoryRouter>
        <HomeRoute />
      </MemoryRouter>,
    );

    // Title & Brand
    expect(screen.getByText(/Worship Slide/i)).toBeInTheDocument();

    // M1 Presentation Card & Button
    expect(screen.getByText("M1 송출 시작하기 (5곡 세트)")).toBeInTheDocument();
    expect(screen.getByTestId("start-present-btn")).toBeInTheDocument();

    // Quick Lyric Paste Card & Button
    expect(screen.getByText("가사 빠른 입력")).toBeInTheDocument();
    expect(screen.getByTestId("open-quick-paste-btn")).toBeInTheDocument();

    // 5-Song Setlist Overview
    expect(screen.getByText("은혜로다")).toBeInTheDocument();
    expect(screen.getByText("주 품에")).toBeInTheDocument();
    expect(screen.getByText("시선")).toBeInTheDocument();
    expect(screen.getByText("꽃들도")).toBeInTheDocument();
    expect(screen.getByText("주의 이름 높이며")).toBeInTheDocument();
  });

  it("should navigate to /present/fullscreen when start presentation button is clicked", () => {
    mockNavigate.mockClear();

    render(
      <MemoryRouter>
        <HomeRoute />
      </MemoryRouter>,
    );

    const startBtn = screen.getByTestId("start-present-btn");
    fireEvent.click(startBtn);

    expect(mockNavigate).toHaveBeenCalledWith("/present/fullscreen");
  });

  it("should open QuickLyricPasteModal when quick lyric button is clicked", () => {
    render(
      <MemoryRouter>
        <HomeRoute />
      </MemoryRouter>,
    );

    // Modal should not be visible initially
    expect(screen.queryByText("빠른 가사 붙여넣기")).not.toBeInTheDocument();

    const openBtn = screen.getByTestId("open-quick-paste-btn");
    fireEvent.click(openBtn);

    // Modal is now open
    expect(screen.getByText("빠른 가사 붙여넣기")).toBeInTheDocument();
  });
});
