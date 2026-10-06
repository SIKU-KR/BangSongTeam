import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { EditorHeader } from "./EditorHeader";
import { EDITOR_COPY } from "#copy/editor";
import { BACKGROUND_COPY } from "#copy/backgrounds";
import { DRIVE_ROOT_PATH } from "../drive/drivePaths";

function renderHeader(
  props?: Partial<React.ComponentProps<typeof EditorHeader>>,
) {
  const defaultProps = {
    title: "테스트 프레젠테이션",
    onUpdateTitle: vi.fn(),
    onPresent: vi.fn(),
    totalSongs: 1,
    onNewPresentation: vi.fn(),
    onOpenLyricModal: vi.fn(),
    canUndo: false,
    canRedo: false,
    readOnly: false,
    backPath: DRIVE_ROOT_PATH,
    mediaProgress: null,
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

  it("새 가사 입력 항목은 메뉴를 닫고 onOpenLyricModal을 부른다", () => {
    const onOpenLyricModal = vi.fn();
    renderHeader({ onOpenLyricModal });

    fireEvent.click(screen.getByTestId("header-file-menu-btn"));
    fireEvent.click(screen.getByTestId("header-file-menu-lyric-btn"));

    expect(onOpenLyricModal).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByTestId("header-file-menu-dropdown"),
    ).not.toBeInTheDocument();
  });

  it("단축키 안내가 ESC 키와 바깥 클릭으로 닫힌다", async () => {
    renderHeader();
    const shortcutsButton = screen.getByTestId("header-shortcuts-btn");

    fireEvent.click(shortcutsButton);
    expect(
      screen.getByText(EDITOR_COPY.header.presentShortcuts),
    ).toBeInTheDocument();

    fireEvent.keyDown(screen.getByTestId("header-shortcuts-popover"), {
      key: "Escape",
    });
    await waitFor(() =>
      expect(
        screen.queryByText(EDITOR_COPY.header.presentShortcuts),
      ).not.toBeInTheDocument(),
    );

    fireEvent.click(shortcutsButton);
    expect(
      screen.getByText(EDITOR_COPY.header.presentShortcuts),
    ).toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    fireEvent.mouseDown(document.body);
    fireEvent.pointerUp(document.body);
    fireEvent.mouseUp(document.body);
    fireEvent.click(document.body);
    await waitFor(() =>
      expect(
        screen.queryByText(EDITOR_COPY.header.presentShortcuts),
      ).not.toBeInTheDocument(),
    );
  });

  it("단축키 안내에 PRD 송출 단축키와 번호 이동 규칙을 모두 보여 준다", () => {
    renderHeader();
    fireEvent.click(screen.getByTestId("header-shortcuts-btn"));
    const popover = screen.getByTestId("header-shortcuts-popover");

    for (const text of [
      "→ ↓ / Space / PageDown",
      "← ↑ / PageUp",
      "B / .",
      "Backspace",
      "Esc",
      "송출 종료",
      "3초 동안 입력이 없으면 입력한 번호가 지워져요.",
      "없는 번호는 무시해요.",
      "입력 중인 번호는 청중 화면에 보이지 않아요.",
    ]) {
      expect(popover).toHaveTextContent(text);
    }
  });

  it("단축키 안내에 편집 단축키 표를 송출 단축키보다 먼저 보여 준다", () => {
    renderHeader();
    fireEvent.click(screen.getByTestId("header-shortcuts-btn"));

    const popover = screen.getByTestId("header-shortcuts-popover");
    expect(popover).toHaveTextContent(EDITOR_COPY.header.editorShortcuts);
    expect(popover).toHaveTextContent("Ctrl/⌘+M");
    expect(popover).toHaveTextContent("가사 편집");
    expect(
      popover.textContent!.indexOf(EDITOR_COPY.header.editorShortcuts),
    ).toBeLessThan(
      popover.textContent!.indexOf(EDITOR_COPY.header.presentShortcuts),
    );
  });

  it("곡·슬라이드 번호는 헤더가 아니라 캔버스 상태 표시줄에 둔다", () => {
    renderHeader();
    expect(screen.getByTestId("editor-header")).not.toHaveTextContent("곡 1/");
  });

  it("배경 저장 중이면 저장된 수를 보여 준다", () => {
    renderHeader({
      mediaProgress: { readyCount: 1, totalCount: 2, failure: null },
    });

    expect(screen.getByTestId("header-media-progress")).toHaveTextContent(
      BACKGROUND_COPY.prepare.editorStatus(1, 2),
    );
    expect(screen.queryByTestId("header-media-quota")).not.toBeInTheDocument();
  });

  it("저장 공간이 부족해 멈췄으면 진행 대신 저장 공간 부족을 알린다", () => {
    renderHeader({
      mediaProgress: { readyCount: 0, totalCount: 2, failure: "quota" },
    });

    const badge = screen.getByTestId("header-media-quota");
    expect(badge).toHaveTextContent(BACKGROUND_COPY.prepare.editorQuota);
    expect(badge).toHaveAttribute(
      "title",
      BACKGROUND_COPY.prepare.failed.quota,
    );
    expect(
      screen.queryByTestId("header-media-progress"),
    ).not.toBeInTheDocument();
  });
});
