import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PencilIcon, Trash2Icon } from "lucide-react";
import type { MenuAction } from "#components/common/ActionMenu";
import { TooltipProvider } from "#components/ui/tooltip";
import { DriveToolbar } from "./DriveToolbar";

const ACTIONS: MenuAction[] = [
  {
    key: "open",
    label: "편집기에서 열기",
    onSelect: vi.fn(),
    testId: "action-open",
  },
  {
    key: "rename",
    label: "이름 바꾸기",
    icon: PencilIcon,
    onSelect: vi.fn(),
    testId: "action-rename",
  },
  {
    key: "trash",
    label: "휴지통으로 옮기기",
    icon: Trash2Icon,
    danger: true,
    onSelect: vi.fn(),
    testId: "action-trash",
  },
];

function renderSelectionToolbar(): void {
  render(
    <TooltipProvider>
      <DriveToolbar
        mode="drive"
        selectionCount={1}
        selectionActions={ACTIONS}
        onClearSelection={vi.fn()}
        summary=""
        typeFilter="all"
        onTypeFilterChange={vi.fn()}
        canEmptyTrash={false}
        onEmptyTrash={vi.fn()}
      />
    </TooltipProvider>,
  );
}

describe("DriveToolbar 선택 막대", () => {
  it("열기를 뺀 작업만 막대에 아이콘으로 놓는다", () => {
    renderSelectionToolbar();

    const actions = screen.getByTestId("selection-actions");
    expect(actions).toContainElement(screen.getByTestId("bar-action-rename"));
    expect(actions).toContainElement(screen.getByTestId("bar-action-trash"));
    expect(screen.queryByTestId("bar-action-open")).not.toBeInTheDocument();
  });

  it("작업 줄만 가로로 스크롤하고, 선택 해제와 작업 더보기는 그 밖에 두어 좁은 화면에서도 보이게 한다", () => {
    renderSelectionToolbar();

    const actions = screen.getByTestId("selection-actions");
    expect(actions).toHaveClass("overflow-x-auto");
    expect(actions).not.toContainElement(screen.getByTestId("selection-clear"));
    expect(actions).not.toContainElement(screen.getByTestId("selection-more"));
    expect(screen.getByTestId("selection-bar")).not.toHaveClass(
      "overflow-x-auto",
    );
  });
});
