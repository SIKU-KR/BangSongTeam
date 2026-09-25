import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { EditorHeader } from "./EditorHeader";

function renderHeader(
  props?: Partial<React.ComponentProps<typeof EditorHeader>>,
) {
  const defaultProps = {
    title: "테스트 프레젠테이션",
    onUpdateTitle: vi.fn(),
    onPresent: vi.fn(),
    currentSongIndex: 0,
    totalSongs: 1,
    currentSlideNumber: 1,
    totalSlideCount: 2,
    onNewPresentation: vi.fn(),
    onOpenLyricModal: vi.fn(),
    onLoadSampleSongs: vi.fn(),
  };

  return render(
    <MemoryRouter>
      <EditorHeader {...defaultProps} {...props} />
    </MemoryRouter>,
  );
}

describe("EditorHeader", () => {
  it("파일 버튼 클릭으로 메뉴를 열고 다시 클릭하면 닫는다", () => {
    renderHeader();
    const fileButton = screen.getByTestId("header-file-menu-btn");

    expect(
      screen.queryByTestId("header-file-menu-dropdown"),
    ).not.toBeInTheDocument();
    fireEvent.click(fileButton);
    expect(screen.getByTestId("header-file-menu-dropdown")).toBeInTheDocument();
    fireEvent.click(fileButton);
    expect(
      screen.queryByTestId("header-file-menu-dropdown"),
    ).not.toBeInTheDocument();
  });

  it("파일 메뉴가 열린 상태에서 ESC 키를 누르면 닫힌다", () => {
    renderHeader();
    const fileButton = screen.getByTestId("header-file-menu-btn");

    fireEvent.click(fileButton);
    expect(screen.getByTestId("header-file-menu-dropdown")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      screen.queryByTestId("header-file-menu-dropdown"),
    ).not.toBeInTheDocument();
  });

  it("파일 메뉴가 열린 상태에서 바깥 영역을 클릭하면 닫힌다", () => {
    renderHeader();
    const fileButton = screen.getByTestId("header-file-menu-btn");

    fireEvent.click(fileButton);
    expect(screen.getByTestId("header-file-menu-dropdown")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(
      screen.queryByTestId("header-file-menu-dropdown"),
    ).not.toBeInTheDocument();
  });

  it("단축키 안내가 ESC 키와 바깥 클릭으로 닫힌다", () => {
    renderHeader();
    const shortcutsButton = screen.getByTestId("header-shortcuts-btn");

    fireEvent.click(shortcutsButton);
    expect(screen.getByText("발표 송출 단축키")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("발표 송출 단축키")).not.toBeInTheDocument();

    fireEvent.click(shortcutsButton);
    expect(screen.getByText("발표 송출 단축키")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByText("발표 송출 단축키")).not.toBeInTheDocument();
  });

  it("단축키 안내에 PRD 송출 단축키와 번호 이동 규칙을 모두 보여 준다", () => {
    renderHeader();
    fireEvent.click(screen.getByTestId("header-shortcuts-btn"));
    const popover = screen.getByTestId("header-shortcuts-popover");

    for (const text of [
      "→ / Space / PageDown",
      "← / PageUp",
      "Backspace",
      "Esc",
      "전체화면 해제 (송출 종료)",
      "3초 동안 입력이 없으면 입력한 번호가 지워집니다.",
      "없는 번호는 무시합니다.",
      "입력 중인 번호는 청중 화면에 표시되지 않습니다.",
    ]) {
      expect(popover).toHaveTextContent(text);
    }
  });
});
