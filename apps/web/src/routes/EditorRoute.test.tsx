import React from "react";
import {
  __loadDocumentsForTests,
  SEED_PRESENTATIONS,
} from "../features/presentation";
import { signInAsTestUser } from "../test/sessionFixture";
import { withQueryClient } from "../test/queryClientFixture";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { EditorRoute } from "./EditorRoute";
import {
  resetPresentationStore,
  SEED_PRESENTATION_IDS,
} from "../features/presentation";

const DOC_ID = SEED_PRESENTATION_IDS[0];

function renderEditor(path = `/editor/${DOC_ID}`) {
  return render(
    withQueryClient(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/editor/:presentationId" element={<EditorRoute />} />
          <Route
            path="/presentations"
            element={<div data-testid="presentations-stub" />}
          />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

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
    signInAsTestUser();
    resetPresentationStore();
    __loadDocumentsForTests(SEED_PRESENTATIONS);
    mockNavigate.mockClear();
    vi.restoreAllMocks();
  });

  it("should render editor header, stage canvas, property panel, sidebar, and filmstrip", () => {
    renderEditor();

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

  it("should navigate to the worship preparation screen when present button is clicked", () => {
    renderEditor();

    const presentBtn = screen.getByTestId("header-present-btn");
    fireEvent.click(presentBtn);

    expect(mockNavigate).toHaveBeenCalledWith(`/present/${DOC_ID}/ready`);
  });

  it("should switch active slide when clicking slide in filmstrip", () => {
    renderEditor();

    const secondSlideStrip = screen.getByTestId("slide-strip-item-1");
    fireEvent.click(secondSlideStrip);

    // Text of second slide of 은혜로다 should now be in the canvas/property panel
    expect(
      screen.getByDisplayValue(/주의 사랑을 주의 선하심을/),
    ).toBeInTheDocument();
  });

  it("should update slide lines when edited in property panel", () => {
    renderEditor();

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
    renderEditor();

    const blackoutBtn = screen.getByTestId("test-blackout-btn");
    fireEvent.click(blackoutBtn);
    expect(screen.getByText("암전(B) 해제")).toBeInTheDocument();

    const lyricsBtn = screen.getByTestId("test-lyrics-btn");
    fireEvent.click(lyricsBtn);
    expect(screen.getByText("가사숨김(H) 해제")).toBeInTheDocument();
  });

  it("should update typography and 3x3 position when controls are changed", () => {
    renderEditor();

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
    renderEditor();

    const addSlideBtn = screen.getByTestId("add-slide-filmstrip-btn");
    fireEvent.click(addSlideBtn);

    // 은혜로다 initially has 5 slides, now should have 6
    expect(screen.getByTestId("slide-strip-item-5")).toBeInTheDocument();
  });

  it("should trigger undo and redo in header", () => {
    renderEditor();

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
    renderEditor();

    const collapseBtn = screen.getByTestId("collapse-filmstrip-btn");
    fireEvent.click(collapseBtn);

    expect(screen.getByTestId("slide-filmstrip-collapsed")).toBeInTheDocument();

    const expandBtn = screen.getByTestId("expand-filmstrip-btn");
    fireEvent.click(expandBtn);

    expect(screen.getByTestId("slide-filmstrip")).toBeInTheDocument();
  });

  it("should support canvas zoom controls", () => {
    renderEditor();

    expect(screen.getByText("100%")).toBeInTheDocument();

    const zoomInBtn = screen.getByTitle("캔버스 확대");
    fireEvent.click(zoomInBtn);
    expect(screen.getByText("115%")).toBeInTheDocument();

    const zoomOutBtn = screen.getByTitle("캔버스 축소");
    fireEvent.click(zoomOutBtn);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("should support keyboard navigation shortcuts (Space, ArrowRight, ArrowLeft)", () => {
    renderEditor();

    // Initial slide: 은혜로다 slide 1
    expect(screen.getAllByText(/1 \/ 5/)[0]).toBeInTheDocument();

    // Press ArrowRight -> moves to slide 2
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getAllByText(/2 \/ 5/)[0]).toBeInTheDocument();

    // Press Space -> moves to slide 3
    fireEvent.keyDown(window, { key: " " });
    expect(screen.getAllByText(/3 \/ 5/)[0]).toBeInTheDocument();

    // Press ArrowLeft -> moves back to slide 2
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getAllByText(/2 \/ 5/)[0]).toBeInTheDocument();
  });

  it("should collapse and expand song property panel", () => {
    renderEditor();

    const collapseBtn = screen.getByTestId("collapse-property-panel-btn");
    fireEvent.click(collapseBtn);

    expect(
      screen.getByTestId("song-property-panel-collapsed"),
    ).toBeInTheDocument();

    const expandBtn = screen.getByTestId("expand-property-panel-btn");
    fireEvent.click(expandBtn);

    expect(screen.getByTestId("song-property-panel")).toBeInTheDocument();
  });

  it("should open file menu and handle actions in EditorHeader", () => {
    renderEditor();

    const fileMenuBtn = screen.getByTestId("header-file-menu-btn");
    fireEvent.click(fileMenuBtn);

    expect(screen.getByText("새 프레젠테이션")).toBeInTheDocument();
    expect(screen.getByText("기본 5곡 세트 불러오기")).toBeInTheDocument();
  });

  it("should maintain correct active slide index when deleting an earlier slide", () => {
    renderEditor();

    // Select slide 3 (index 2)
    const slide3 = screen.getByTestId("slide-strip-item-2");
    fireEvent.click(slide3);
    expect(screen.getAllByText(/3 \/ 5/)[0]).toBeInTheDocument();

    // Delete slide 1 (index 0)
    const deleteSlide0Btn = screen.getByTestId("delete-slide-btn-0");
    fireEvent.click(deleteSlide0Btn);

    // Previously slide index was 2, after deleting index 0 it should now be index 1 (slide 2 of 4)
    expect(screen.getAllByText(/2 \/ 4/)[0]).toBeInTheDocument();
  });

  it("존재하지 않는 presentationId 는 /presentations 로 리다이렉트된다", () => {
    renderEditor("/editor/99999999-9999-4999-8999-999999999999");

    expect(screen.getByTestId("presentations-stub")).toBeInTheDocument();
    expect(screen.queryByTestId("editor-route")).not.toBeInTheDocument();
  });

  it("다른 시드 문서를 id로 직접 열 수 있다", () => {
    renderEditor(`/editor/${SEED_PRESENTATION_IDS[3]}`);

    expect(screen.getByTestId("editor-route")).toBeInTheDocument();
    expect(screen.getByText("수요 성령기도회")).toBeInTheDocument();
  });

  it("?song= 파라미터로 진입하면 해당 곡이 선택된다", () => {
    renderEditor(`/editor/${DOC_ID}?song=2`);

    // 3번째 곡 '시선'
    expect(screen.getByTestId("editor-header")).toHaveTextContent("곡 3/5");
    expect(screen.getAllByText("시선").length).toBeGreaterThan(0);
  });

  it("뒤로가기 버튼은 /presentations 로 이동한다", () => {
    renderEditor();

    fireEvent.click(screen.getByTestId("header-back-btn"));

    expect(mockNavigate).toHaveBeenCalledWith("/presentations");
  });

  it("파일 메뉴의 새 프레젠테이션은 새 문서 URL로 이동한다", () => {
    renderEditor();

    act(() => {
      fireEvent.click(screen.getByTestId("header-file-menu-btn"));
    });
    act(() => {
      fireEvent.click(screen.getByText("새 프레젠테이션"));
    });

    expect(mockNavigate).toHaveBeenCalledWith(
      expect.stringMatching(/^\/editor\/[0-9a-f-]{36}$/),
    );
  });

  /**
   * 빈 편집기 화면은 처음 쓰는 봉사자가 가장 먼저 만나는 화면인데 테스트가 하나도
   * 없었다. 그 사이 '기본 5곡 세트 불러오기' 버튼이 곡을 넣는 게 아니라 세트를
   * **비우고** 있었는데도 아무도 눈치채지 못했다.
   */
  describe("빈 편집기 화면", () => {
    const EMPTY_DOC = {
      ...SEED_PRESENTATIONS[0],
      id: "1f000000-0000-4000-8000-0000000000ff",
      title: "빈 세트",
      items: [],
    };

    function renderEmptyEditor() {
      resetPresentationStore();
      __loadDocumentsForTests([EMPTY_DOC]);
      return renderEditor(`/editor/${EMPTY_DOC.id}`);
    }

    it("곡이 없으면 안내와 두 버튼을 보여 준다", () => {
      renderEmptyEditor();

      expect(
        screen.getByText("등록된 찬양 곡 또는 슬라이드가 없습니다"),
      ).toBeInTheDocument();
      expect(screen.getByText("기본 5곡 세트 불러오기")).toBeInTheDocument();
      expect(
        screen.getByText("가사 붙여넣기로 새 곡 추가"),
      ).toBeInTheDocument();
    });

    it("'기본 5곡 세트 불러오기'가 라벨대로 5곡을 채운다", () => {
      renderEmptyEditor();

      act(() => {
        fireEvent.click(screen.getByText("기본 5곡 세트 불러오기"));
      });

      // 라벨과 반대로 세트를 비우던 버그의 회귀 방지선이다.
      expect(
        screen.queryByText("등록된 찬양 곡 또는 슬라이드가 없습니다"),
      ).not.toBeInTheDocument();
      expect(screen.getAllByText("은혜로다").length).toBeGreaterThan(0);
      // 5곡이 실제로 들어왔는지 (첫 곡의 슬라이드 스트립이 살아난다)
      expect(screen.getByTestId("slide-filmstrip")).toBeInTheDocument();
    });
  });
});
