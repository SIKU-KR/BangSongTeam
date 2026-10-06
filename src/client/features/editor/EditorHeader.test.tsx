import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "#components/ui/tooltip";
import { EditorHeader } from "./EditorHeader";
import { EDITOR_COPY } from "#copy/editor";
import { BACKGROUND_COPY } from "#copy/backgrounds";
import { COMMON_COPY } from "#copy/common";
import { DRIVE_ROOT_PATH } from "../drive/drivePaths";
import {
  recordSyncFailure,
  resetSyncStatus,
  setSyncStatus,
} from "../../lib/sync/syncStatus";
import {
  clearPersistenceError,
  reportPersistenceError,
} from "../../lib/storage/persistenceStatus";

const syncRecovery = vi.hoisted(() => ({ retrySyncNow: vi.fn() }));

vi.mock("../../lib/sync/syncRecovery", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../lib/sync/syncRecovery")>();
  return { ...actual, ...syncRecovery };
});

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
      <TooltipProvider>
        <EditorHeader {...defaultProps} {...props} />
      </TooltipProvider>
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
      mediaProgress: {
        readyCount: 1,
        totalCount: 2,
        failure: null,
        retrying: false,
        retry: vi.fn(),
      },
    });

    const badge = screen.getByTestId("header-media-progress");
    expect(badge).toHaveTextContent(BACKGROUND_COPY.prepare.editorStatus(1, 2));
    expect(badge).toHaveAttribute("data-state", "downloading");
    expect(
      screen.queryByTestId("header-media-failure"),
    ).not.toBeInTheDocument();
  });

  it("받다 실패해 곧 다시 받을 예정이면 저장 중과 구분해 보여 준다", () => {
    renderHeader({
      mediaProgress: {
        readyCount: 1,
        totalCount: 2,
        failure: null,
        retrying: true,
        retry: vi.fn(),
      },
    });

    const badge = screen.getByTestId("header-media-progress");
    expect(badge).toHaveTextContent(
      BACKGROUND_COPY.prepare.editorRetrying(1, 2),
    );
    expect(badge).toHaveAttribute("data-state", "retrying");
  });

  it("다시 받기를 멈춘 실패면 저장 실패를 알리고, 누르면 안내와 다시 시도를 보여 준다", async () => {
    const retry = vi.fn();
    renderHeader({
      mediaProgress: {
        readyCount: 1,
        totalCount: 2,
        failure: "network",
        retrying: false,
        retry,
      },
    });

    const trigger = screen.getByTestId("header-media-failure");
    expect(trigger).toHaveTextContent(BACKGROUND_COPY.prepare.editorFailed);

    fireEvent.click(trigger);
    const popover = await screen.findByTestId("header-media-failure-popover");
    expect(popover).toHaveTextContent(BACKGROUND_COPY.prepare.failed.network);

    fireEvent.click(screen.getByTestId("header-media-failure-retry"));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("저장 공간이 부족해 멈췄으면 진행 대신 저장 공간 부족을 알리고, 누르면 안내와 다시 시도를 보여 준다", async () => {
    const retry = vi.fn();
    renderHeader({
      mediaProgress: {
        readyCount: 0,
        totalCount: 2,
        failure: "quota",
        retrying: false,
        retry,
      },
    });

    const trigger = screen.getByTestId("header-media-failure");
    expect(trigger).toHaveTextContent(BACKGROUND_COPY.prepare.editorQuota);
    expect(
      screen.queryByTestId("header-media-progress"),
    ).not.toBeInTheDocument();

    fireEvent.click(trigger);
    const popover = await screen.findByTestId("header-media-failure-popover");
    expect(popover).toHaveTextContent(BACKGROUND_COPY.prepare.failed.quota);

    fireEvent.click(screen.getByTestId("header-media-failure-retry"));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  describe("동기화 상태", () => {
    beforeEach(() => {
      resetSyncStatus();
      clearPersistenceError();
      syncRecovery.retrySyncNow.mockClear();
    });

    afterEach(() => {
      cleanup();
      vi.useRealTimers();
      resetSyncStatus();
      clearPersistenceError();
    });

    it("아직 동기화하지 않았으면 툴팁에 그 사실을 보여 준다", async () => {
      renderHeader();

      act(() => screen.getByTestId("save-status").focus());

      expect(await screen.findByTestId("save-status-detail")).toHaveTextContent(
        EDITOR_COPY.syncStatus.notSyncedYet,
      );
    });

    it("툴팁에 마지막으로 동기화한 시각을 보여 준다", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 9, 6, 14, 5));
      setSyncStatus("presentation", "synced");
      const time = new Intl.DateTimeFormat("ko-KR", {
        hour: "numeric",
        minute: "2-digit",
      }).format(Date.now());
      renderHeader();

      act(() => screen.getByTestId("save-status").focus());

      expect(await screen.findByTestId("save-status-detail")).toHaveTextContent(
        EDITOR_COPY.syncStatus.lastSynced(time),
      );
    });

    it.each(["synced", "syncing", "idle"] as const)(
      "%s 상태에서는 다시 시도를 보여 주지 않는다",
      (status) => {
        setSyncStatus("presentation", status);
        renderHeader();

        expect(
          screen.queryByTestId("save-status-retry"),
        ).not.toBeInTheDocument();
      },
    );

    it("오프라인이면 다시 시도를 보여 주고, 누르면 곧바로 다시 동기화한다", () => {
      setSyncStatus("presentation", "offline");
      renderHeader();

      expect(screen.getByTestId("save-status")).toHaveTextContent(
        EDITOR_COPY.syncStatus.offline,
      );
      const retry = screen.getByTestId("save-status-retry");
      expect(retry).toHaveAccessibleName(COMMON_COPY.retry);

      fireEvent.click(retry);

      expect(syncRecovery.retrySyncNow).toHaveBeenCalledTimes(1);
    });

    it("동기화 실패면 다시 시도를 보여 준다", () => {
      recordSyncFailure({
        id: "doc",
        kind: "presentation",
        message: "거절",
        failedAt: 1,
      });
      renderHeader();

      expect(screen.getByTestId("save-status")).toHaveTextContent(
        EDITOR_COPY.syncStatus.syncFailed,
      );
      expect(screen.getByTestId("save-status-retry")).toBeInTheDocument();
    });

    it("기기 저장이 실패했으면 동기화 다시 시도를 보여 주지 않는다", () => {
      setSyncStatus("presentation", "offline");
      reportPersistenceError(new Error("disk"));
      renderHeader();

      expect(screen.getByTestId("save-status")).toHaveTextContent(
        EDITOR_COPY.syncStatus.saveFailed,
      );
      expect(screen.queryByTestId("save-status-retry")).not.toBeInTheDocument();
    });
  });
});
