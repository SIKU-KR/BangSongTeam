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

describe("EditorRoute (PowerPoint식 프레젠테이션 편집기)", () => {
  beforeEach(() => {
    signInAsTestUser();
    resetPresentationStore();
    __loadDocumentsForTests(SEED_PRESENTATIONS);
    mockNavigate.mockClear();
    vi.restoreAllMocks();
  });

  it("should render editor header, stage canvas, property panel, and slide thumbnail pane", () => {
    renderEditor();

    // Header & Title
    expect(screen.getByTestId("editor-header")).toBeInTheDocument();
    expect(screen.getByText("2026 주일 3부 예배")).toBeInTheDocument();

    // Stage canvas
    expect(screen.getByTestId("editor-stage-canvas")).toBeInTheDocument();
    expect(
      screen.getByText("16:9 와이드스크린 (1920 × 1080)"),
    ).toBeInTheDocument();

    // PPT식 좌측 썸네일 창 & 곡 구역
    expect(screen.getByTestId("slide-thumbnail-pane")).toBeInTheDocument();
    expect(screen.getByTestId("song-section-0")).toHaveTextContent("은혜로다");

    // Properties panel
    expect(screen.getByTestId("song-property-panel")).toBeInTheDocument();
    expect(screen.getByText("슬라이드 디자인 & 속성")).toBeInTheDocument();

    // 하단 슬라이드 스트립은 없다
    expect(screen.queryByTestId("slide-filmstrip")).not.toBeInTheDocument();
  });

  it("should go straight to fullscreen projection when present button is clicked", () => {
    renderEditor();

    const presentBtn = screen.getByTestId("header-present-btn");
    fireEvent.click(presentBtn);

    expect(mockNavigate).toHaveBeenCalledWith(`/present/${DOC_ID}/fullscreen`);
  });

  it("should switch active slide when clicking a slide thumbnail", () => {
    renderEditor();

    fireEvent.click(screen.getByTestId("slide-thumb-1"));

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

  it("should add a new slide after the current slide", () => {
    renderEditor();

    // 세트 전체 23장
    expect(screen.queryByTestId("slide-thumb-23")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("add-slide-btn"));

    // 24장이 되고, 새 슬라이드(1곡 2번째)가 선택된다
    expect(screen.getByTestId("slide-thumb-23")).toBeInTheDocument();
    expect(screen.getByTestId("song-section-0")).toHaveTextContent("6장");
    expect(screen.getByTestId("editor-header")).toHaveTextContent(
      "슬라이드 2/24",
    );
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

    // Initial slide: 세트 전체 23장 중 1번
    expect(screen.getByText("1 / 23")).toBeInTheDocument();

    // Press ArrowRight -> moves to slide 2
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("2 / 23")).toBeInTheDocument();

    // Press Space -> moves to slide 3
    fireEvent.keyDown(window, { key: " " });
    expect(screen.getByText("3 / 23")).toBeInTheDocument();

    // Press ArrowLeft -> moves back to slide 2
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByText("2 / 23")).toBeInTheDocument();
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
    fireEvent.click(screen.getByTestId("slide-thumb-2"));
    expect(screen.getByText("3 / 23")).toBeInTheDocument();

    // Delete slide 1 (index 0)
    fireEvent.click(screen.getByTestId("delete-slide-btn-0"));

    // 같은 슬라이드가 계속 선택된 채로 번호만 당겨진다 (3 → 2, 전체 22장)
    expect(screen.getByText("2 / 22")).toBeInTheDocument();
    expect(screen.getByDisplayValue(/은혜로다 주의 은혜/)).toBeInTheDocument();
  });

  it("존재하지 않는 presentationId 는 /presentations 로 리다이렉트된다", () => {
    renderEditor("/editor/999999999999999999999");

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

    // 3번째 곡 '시선' — 1곡 5장 + 2곡 4장 다음이므로 10번 슬라이드
    expect(screen.getByTestId("editor-header")).toHaveTextContent("곡 3/5");
    expect(screen.getByTestId("editor-header")).toHaveTextContent(
      "슬라이드 10/23",
    );
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
      expect.stringMatching(/^\/editor\/[A-Za-z0-9_-]{21}$/),
    );
  });

  describe("PPT식 썸네일 창 & 연속 슬라이드 번호", () => {
    it("번호는 곡이 바뀌어도 1로 돌아가지 않고 이어진다", () => {
      renderEditor();

      // 1곡(은혜로다) 5장 → 2곡(주 품에) 첫 장은 6번
      expect(screen.getByTestId("slide-thumb-4")).toHaveTextContent("5");
      expect(screen.getByTestId("slide-thumb-5")).toHaveTextContent("6");
      expect(screen.getByTestId("slide-thumb-22")).toHaveTextContent("23");

      fireEvent.click(screen.getByTestId("slide-thumb-5"));

      const header = screen.getByTestId("editor-header");
      expect(header).toHaveTextContent("곡 2/5");
      expect(header).toHaveTextContent("슬라이드 6/23");
      expect(screen.getByText("6 / 23")).toBeInTheDocument();
      expect(screen.getByDisplayValue(/주 품에 품으소서/)).toBeInTheDocument();
    });

    it("방향키로 곡 경계를 넘어도 번호가 이어진다", () => {
      renderEditor();

      fireEvent.click(screen.getByTestId("slide-thumb-4"));
      expect(screen.getByText("5 / 23")).toBeInTheDocument();

      fireEvent.keyDown(window, { key: "ArrowRight" });
      expect(screen.getByText("6 / 23")).toBeInTheDocument();
      expect(screen.getByTestId("editor-header")).toHaveTextContent("곡 2/5");

      fireEvent.keyDown(window, { key: "ArrowLeft" });
      expect(screen.getByText("5 / 23")).toBeInTheDocument();
      expect(screen.getByTestId("editor-header")).toHaveTextContent("곡 1/5");
    });

    it("캔버스 이전/다음 버튼은 곡이 아니라 세트의 처음/끝에서만 꺼진다", () => {
      renderEditor();

      expect(screen.getByTestId("canvas-prev-btn")).toBeDisabled();

      // 1곡의 마지막 장에서도 다음 버튼이 켜져 있다
      fireEvent.click(screen.getByTestId("slide-thumb-4"));
      const nextBtn = screen.getByTestId("canvas-next-btn");
      expect(nextBtn).not.toBeDisabled();
      fireEvent.click(nextBtn);
      expect(screen.getByText("6 / 23")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("slide-thumb-22"));
      expect(screen.getByTestId("canvas-next-btn")).toBeDisabled();
    });

    it("구역 헤더를 누르면 그 곡의 첫 슬라이드가 선택된다", () => {
      renderEditor();

      fireEvent.click(screen.getByTestId("song-section-title-2"));

      expect(screen.getByTestId("editor-header")).toHaveTextContent(
        "슬라이드 10/23",
      );
    });

    it("구역 메뉴로 곡을 아래로 옮기면 선택도 따라간다", () => {
      renderEditor();

      fireEvent.click(screen.getByTestId("song-section-menu-btn-0"));
      fireEvent.click(screen.getByRole("menuitem", { name: "아래로 이동" }));

      expect(screen.getByTestId("song-section-0")).toHaveTextContent("주 품에");
      expect(screen.getByTestId("song-section-1")).toHaveTextContent(
        "은혜로다",
      );
      // 은혜로다가 2번째 곡이 되었고 (주 품에 4장 다음) 5번 슬라이드부터 시작
      const header = screen.getByTestId("editor-header");
      expect(header).toHaveTextContent("곡 2/5");
      expect(header).toHaveTextContent("슬라이드 5/23");
      expect(screen.queryByTestId("song-section-menu")).not.toBeInTheDocument();
    });

    it("구역 메뉴로 곡을 복제·삭제할 수 있다", () => {
      renderEditor();

      fireEvent.click(screen.getByTestId("song-section-menu-btn-0"));
      fireEvent.click(screen.getByRole("menuitem", { name: "곡 복제" }));

      expect(screen.getByTestId("song-section-1")).toHaveTextContent(
        "은혜로다 (사본)",
      );
      expect(screen.getByTestId("editor-header")).toHaveTextContent("곡 2/6");

      fireEvent.click(screen.getByTestId("song-section-menu-btn-1"));
      fireEvent.click(screen.getByRole("menuitem", { name: "곡 삭제" }));

      expect(screen.queryByText("은혜로다 (사본)")).not.toBeInTheDocument();
      expect(screen.getByTestId("editor-header")).toHaveTextContent("곡 2/5");
    });

    it("우클릭으로 구역 메뉴가 열리고 Esc로 닫힌다", () => {
      renderEditor();

      fireEvent.contextMenu(screen.getByTestId("song-section-3"));
      expect(screen.getByTestId("song-section-menu")).toBeInTheDocument();

      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByTestId("song-section-menu")).not.toBeInTheDocument();
    });

    it("구역을 접으면 그 곡의 썸네일만 숨고 번호는 그대로다", () => {
      renderEditor();

      fireEvent.click(screen.getByTestId("song-section-toggle-1"));

      // 2곡(6~9번) 숨김, 3곡 첫 장은 여전히 10번
      expect(screen.queryByTestId("slide-thumb-5")).not.toBeInTheDocument();
      expect(screen.getByTestId("slide-thumb-9")).toHaveTextContent("10");

      fireEvent.click(screen.getByTestId("song-section-toggle-1"));
      expect(screen.getByTestId("slide-thumb-5")).toBeInTheDocument();
    });

    it("다른 곡의 슬라이드를 지워도 현재 선택은 그대로다", () => {
      renderEditor();

      fireEvent.click(screen.getByTestId("slide-thumb-1"));
      // 2곡의 첫 슬라이드(6번) 삭제
      fireEvent.click(screen.getByTestId("delete-slide-btn-5"));

      expect(screen.getByText("2 / 22")).toBeInTheDocument();
      expect(screen.getByTestId("editor-header")).toHaveTextContent("곡 1/5");
    });

    it("우측 패널의 테마 프리셋이 현재 곡 스타일에 적용된다", () => {
      renderEditor();

      expect(screen.getByText("40%")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("style-preset-2"));

      // 선샤인 웜: Gmarket Sans · 오버레이 50%
      expect(screen.getByDisplayValue("Gmarket Sans")).toBeInTheDocument();
      expect(screen.getByText("50%")).toBeInTheDocument();
    });
  });

  /**
   * 빈 편집기 화면은 처음 쓰는 봉사자가 가장 먼저 만나는 화면인데 테스트가 하나도
   * 없었다. 그 사이 '기본 5곡 세트 불러오기' 버튼이 곡을 넣는 게 아니라 세트를
   * **비우고** 있었는데도 아무도 눈치채지 못했다.
   */
  describe("빈 편집기 화면", () => {
    const EMPTY_DOC = {
      ...SEED_PRESENTATIONS[0],
      id: "1f00000000000000000ff",
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
      // 5곡이 실제로 들어왔는지 (썸네일 창에 5개 구역이 생긴다)
      expect(screen.getByTestId("slide-thumb-0")).toBeInTheDocument();
      expect(screen.getByTestId("song-section-4")).toBeInTheDocument();
    });
  });
});
