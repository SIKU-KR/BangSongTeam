import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { EditorRoute } from "./EditorRoute";
import { resetActiveSetlist } from "../features/presentation";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe("EditorRoute (Canva / MiriCanvas Presentation Editor)", () => {
  beforeEach(() => {
    resetActiveSetlist();
    mockNavigate.mockClear();
    vi.restoreAllMocks();
  });

  it("should render editor header, stage canvas, property panel, sidebar, and filmstrip", () => {
    render(
      <MemoryRouter>
        <EditorRoute />
      </MemoryRouter>,
    );

    // Header & Title
    expect(screen.getByTestId("editor-header")).toBeInTheDocument();
    expect(screen.getByText("2026 주일 3부 예배")).toBeInTheDocument();

    // Stage canvas
    expect(screen.getByTestId("editor-stage-canvas")).toBeInTheDocument();
    expect(
      screen.getByText("16:9 와이드스크린 (1920 × 1080)"),
    ).toBeInTheDocument();

    // Sidebar & Songs
    expect(screen.getByTestId("editor-sidebar")).toBeInTheDocument();
    expect(screen.getAllByText("은혜로다")[0]).toBeInTheDocument();

    // Properties panel
    expect(screen.getByTestId("song-property-panel")).toBeInTheDocument();
    expect(screen.getByText("슬라이드 디자인 & 속성")).toBeInTheDocument();

    // Filmstrip
    expect(screen.getByTestId("slide-filmstrip")).toBeInTheDocument();
  });

  it("should navigate to /present/fullscreen when present button is clicked", () => {
    render(
      <MemoryRouter>
        <EditorRoute />
      </MemoryRouter>,
    );

    const presentBtn = screen.getByTestId("header-present-btn");
    fireEvent.click(presentBtn);

    expect(mockNavigate).toHaveBeenCalledWith("/present/fullscreen");
  });

  it("should switch active slide when clicking slide in filmstrip", () => {
    render(
      <MemoryRouter>
        <EditorRoute />
      </MemoryRouter>,
    );

    const secondSlideStrip = screen.getByTestId("slide-strip-item-1");
    fireEvent.click(secondSlideStrip);

    // Text of second slide of 은혜로다 should now be in the canvas/property panel
    expect(
      screen.getByDisplayValue(/주의 사랑을 주의 선하심을/),
    ).toBeInTheDocument();
  });

  it("should update slide lines when edited in property panel", () => {
    render(
      <MemoryRouter>
        <EditorRoute />
      </MemoryRouter>,
    );

    const textarea = screen.getByPlaceholderText(/슬라이드 가사를 입력하세요/);
    act(() => {
      fireEvent.change(textarea, {
        target: { value: "수정된 첫 번째 가사\n수정된 두 번째 가사" },
      });
    });

    expect(screen.getAllByText("수정된 첫 번째 가사")[0]).toBeInTheDocument();
    expect(screen.getAllByText("수정된 두 번째 가사")[0]).toBeInTheDocument();
  });

  it("should toggle blackout test and lyrics hidden test", () => {
    render(
      <MemoryRouter>
        <EditorRoute />
      </MemoryRouter>,
    );

    const blackoutBtn = screen.getByTestId("test-blackout-btn");
    fireEvent.click(blackoutBtn);
    expect(screen.getByText("암전(B) 해제")).toBeInTheDocument();

    const lyricsBtn = screen.getByTestId("test-lyrics-btn");
    fireEvent.click(lyricsBtn);
    expect(screen.getByText("가사숨김(H) 해제")).toBeInTheDocument();
  });

  it("should update typography and 3x3 position when controls are changed", () => {
    render(
      <MemoryRouter>
        <EditorRoute />
      </MemoryRouter>,
    );

    // Click 3x3 anchor bottom-center
    const bottomCenterAnchor = screen.getByTestId("grid-anchor-bottom-center");
    fireEvent.click(bottomCenterAnchor);

    // Overlay slider to 75%
    const opacitySlider = screen.getByLabelText("검정 오버레이 불투명도");
    act(() => {
      fireEvent.change(opacitySlider, { target: { value: "75" } });
    });
    expect(screen.getByText("75%")).toBeInTheDocument();
  });

  it("should add a new slide when clicking add slide in filmstrip", () => {
    render(
      <MemoryRouter>
        <EditorRoute />
      </MemoryRouter>,
    );

    const addSlideBtn = screen.getByTestId("add-slide-filmstrip-btn");
    fireEvent.click(addSlideBtn);

    // 은혜로다 initially has 5 slides, now should have 6
    expect(screen.getByTestId("slide-strip-item-5")).toBeInTheDocument();
  });

  it("should trigger undo and redo in header", () => {
    render(
      <MemoryRouter>
        <EditorRoute />
      </MemoryRouter>,
    );

    const undoBtn = screen.getByTestId("header-undo-btn");
    const redoBtn = screen.getByTestId("header-redo-btn");

    // Initially can't undo/redo
    expect(undoBtn).toBeDisabled();
    expect(redoBtn).toBeDisabled();

    // Modify title
    const titleBtn = screen.getByTitle("클릭하여 제목 수정");
    fireEvent.click(titleBtn);
    const input = screen.getByDisplayValue("2026 주일 3부 예배");
    fireEvent.change(input, { target: { value: "새로운 예배 제목" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Now undo is enabled
    expect(screen.getByText("새로운 예배 제목")).toBeInTheDocument();
    expect(undoBtn).not.toBeDisabled();

    // Click undo
    fireEvent.click(undoBtn);
    expect(screen.getByText("2026 주일 3부 예배")).toBeInTheDocument();
    expect(redoBtn).not.toBeDisabled();

    // Click redo
    fireEvent.click(redoBtn);
    expect(screen.getByText("새로운 예배 제목")).toBeInTheDocument();
  });

  it("should collapse and expand filmstrip", () => {
    render(
      <MemoryRouter>
        <EditorRoute />
      </MemoryRouter>,
    );

    const collapseBtn = screen.getByTestId("collapse-filmstrip-btn");
    fireEvent.click(collapseBtn);

    expect(screen.getByTestId("slide-filmstrip-collapsed")).toBeInTheDocument();

    const expandBtn = screen.getByTestId("expand-filmstrip-btn");
    fireEvent.click(expandBtn);

    expect(screen.getByTestId("slide-filmstrip")).toBeInTheDocument();
  });

  it("should support canvas zoom controls", () => {
    render(
      <MemoryRouter>
        <EditorRoute />
      </MemoryRouter>,
    );

    expect(screen.getByText("100%")).toBeInTheDocument();

    const zoomInBtn = screen.getByTitle("캔버스 확대");
    fireEvent.click(zoomInBtn);
    expect(screen.getByText("115%")).toBeInTheDocument();

    const zoomOutBtn = screen.getByTitle("캔버스 축소");
    fireEvent.click(zoomOutBtn);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });
});
