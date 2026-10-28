import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { API_ERRORS, MAX_PRESENTATION_TITLE_LENGTH } from "#shared";
import { MemoryRouter } from "../../test/router";
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
  __resetPersistenceStatusForTests,
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

  it("제목 입력 칸은 프레젠테이션 제목 한도까지만 받는다", () => {
    renderHeader();

    fireEvent.click(screen.getByTestId("header-title-btn"));

    expect(
      screen.getByRole("textbox", { name: EDITOR_COPY.header.titleLabel }),
    ).toHaveProperty("maxLength", MAX_PRESENTATION_TITLE_LENGTH);
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

  it("배경 저장 중 표시는 좁은 화면에서 아이콘과 저장된 수만 보이고 전체 안내는 읽어 준다", () => {
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
    expect(
      within(badge).getByText(BACKGROUND_COPY.prepare.editorStatus(1, 2)),
    ).toHaveClass("max-md:sr-only");
    expect(
      within(badge).getByText(BACKGROUND_COPY.prepare.editorProgress(1, 2)),
    ).toHaveClass("md:hidden");
  });

  it("다시 받기를 멈춘 실패의 글자는 좁은 화면에서 감추되 버튼 이름으로 남긴다", () => {
    renderHeader({
      mediaProgress: {
        readyCount: 1,
        totalCount: 2,
        failure: "network",
        retrying: false,
        retry: vi.fn(),
      },
    });

    const trigger = screen.getByTestId("header-media-failure");
    expect(trigger).toHaveAccessibleName(BACKGROUND_COPY.prepare.editorFailed);
    expect(
      within(trigger).getByText(BACKGROUND_COPY.prepare.editorFailed),
    ).toHaveClass("max-md:sr-only");
  });

  it("단축키 안내와 테마 전환은 좁은 화면에서 숨기고 sm부터 보인다", () => {
    renderHeader();

    const secondary = screen.getByTestId("header-secondary-controls");
    expect(secondary).toHaveClass("hidden", "sm:flex");
    expect(secondary).toContainElement(
      screen.getByTestId("header-shortcuts-btn"),
    );
    expect(secondary).toContainElement(screen.getByTestId("theme-menu-button"));
  });

  it("공유와 슬라이드쇼 발표는 좁은 화면에서 글자를 감추되 버튼 이름으로 남긴다", () => {
    renderHeader({ onShare: vi.fn() });

    const share = screen.getByTestId("header-share-btn");
    expect(share).toHaveAccessibleName(COMMON_COPY.share);
    expect(within(share).getByText(COMMON_COPY.share)).toHaveClass(
      "max-md:sr-only",
    );
    const present = screen.getByTestId("header-present-btn");
    expect(present).toHaveAccessibleName(EDITOR_COPY.slide.present);
    expect(within(present).getByText(EDITOR_COPY.slide.present)).toHaveClass(
      "max-md:sr-only",
    );
  });

  it("공유 버튼은 360px 미만에서 숨기고, 그 폭에서는 파일 메뉴의 공유 항목이 대신한다", () => {
    const onShare = vi.fn();
    renderHeader({ onShare });

    expect(screen.getByTestId("header-share-btn")).toHaveClass("max-xs:hidden");

    fireEvent.click(screen.getByTestId("header-file-menu-btn"));
    const item = screen.getByTestId("header-file-menu-share-btn");
    expect(item).toHaveClass("xs:hidden");
    expect(item).toHaveTextContent(COMMON_COPY.share);

    fireEvent.click(item);

    expect(onShare).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByTestId("header-file-menu-dropdown"),
    ).not.toBeInTheDocument();
  });

  it("공유할 수 없는 화면은 파일 메뉴에도 공유 항목이 없다", () => {
    renderHeader({ onShare: undefined });

    fireEvent.click(screen.getByTestId("header-file-menu-btn"));

    expect(screen.getByTestId("header-file-menu-dropdown")).toBeInTheDocument();
    expect(
      screen.queryByTestId("header-file-menu-share-btn"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("header-share-btn")).not.toBeInTheDocument();
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
      __resetPersistenceStatusForTests();
      syncRecovery.retrySyncNow.mockClear();
    });

    afterEach(() => {
      cleanup();
      vi.useRealTimers();
      resetSyncStatus();
      __resetPersistenceStatusForTests();
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

    it("오늘 동기화한 것이 아니면 툴팁에 날짜도 보여 준다", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 9, 3, 14, 5));
      setSyncStatus("presentation", "synced");
      const time = new Intl.DateTimeFormat("ko-KR", {
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(Date.now());
      vi.setSystemTime(new Date(2026, 9, 4, 9, 0));
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

    it("동기화 실패를 누르면 상관 ID를 고를 수 있는 문의 코드로 보여 준다", async () => {
      recordSyncFailure({
        id: "doc",
        kind: "presentation",
        status: 500,
        message: "거절",
        failedAt: 1,
        requestId: "4bf92f3577b34da6a3ce929d0e0e4736",
      });
      renderHeader();

      fireEvent.click(screen.getByTestId("save-status"));

      const code = await screen.findByTestId("save-status-failure-code");
      expect(code).toHaveTextContent(
        EDITOR_COPY.syncStatus.failureCode("4bf92f35"),
      );
      expect(code).toHaveClass("select-text");
    });

    it("문의 코드 복사 버튼으로 문의 코드를 복사한다", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });
      recordSyncFailure({
        id: "doc",
        kind: "presentation",
        status: 500,
        message: "거절",
        failedAt: 1,
        requestId: "4bf92f3577b34da6a3ce929d0e0e4736",
      });
      renderHeader();

      try {
        fireEvent.click(screen.getByTestId("save-status"));
        fireEvent.click(
          await screen.findByRole("button", {
            name: EDITOR_COPY.syncStatus.copyFailureCode,
          }),
        );

        expect(writeText).toHaveBeenCalledWith("4bf92f35");
        expect(
          await screen.findByRole("button", {
            name: EDITOR_COPY.syncStatus.failureCodeCopied,
          }),
        ).toBeInTheDocument();
      } finally {
        Object.defineProperty(navigator, "clipboard", {
          value: undefined,
          configurable: true,
        });
      }
    });

    it("동기화 실패는 좁은 화면에서도 보이고, 다른 상태는 좁은 화면에서 숨긴다", () => {
      setSyncStatus("presentation", "synced");
      const { unmount } = renderHeader();
      expect(screen.getByTestId("save-status-bar")).toHaveClass(
        "hidden",
        "md:inline-flex",
      );
      unmount();

      recordSyncFailure({
        id: "doc",
        kind: "presentation",
        message: "거절",
        failedAt: 1,
      });
      renderHeader();
      expect(screen.getByTestId("save-status-bar")).not.toHaveClass("hidden");
    });

    it("동기화 실패의 저장 상태는 좁은 화면에서 줄어들지 않고 아이콘만 보이며 이름은 남는다", () => {
      recordSyncFailure({
        id: "doc",
        kind: "presentation",
        message: "거절",
        failedAt: 1,
      });
      renderHeader();

      const trigger = screen.getByTestId("save-status");
      expect(trigger).toHaveAccessibleName(EDITOR_COPY.syncStatus.syncFailed);
      expect(
        within(trigger).getByText(EDITOR_COPY.syncStatus.syncFailed),
      ).toHaveClass("max-md:sr-only");
      expect(trigger).not.toHaveClass("min-w-0");
      expect(trigger).not.toHaveClass("shrink");
      expect(screen.getByTestId("save-status-bar")).toHaveClass(
        "max-md:shrink-0",
      );
    });

    it("실패한 항목의 제목과 이유를 보여 주고 오류 원문은 보여 주지 않는다", async () => {
      const reason = API_ERRORS.presentation.songTooLarge("긴 곡");
      recordSyncFailure({
        id: "doc",
        title: "주일 1부",
        kind: "presentation",
        message: "ZodError: title too long",
        reason,
        failedAt: 1,
      });
      renderHeader();

      fireEvent.click(screen.getByTestId("save-status"));

      const failure = await screen.findByTestId("save-status-failure");
      expect(failure).toHaveTextContent("‘주일 1부’를 올리지 못했어요");
      expect(failure).toHaveTextContent(reason);
      expect(screen.getByTestId("save-status-detail")).not.toHaveTextContent(
        "ZodError",
      );
    });

    it("이유가 없는 실패는 실패한 항목의 제목만 보여 준다", async () => {
      recordSyncFailure({
        id: "doc",
        title: "주일 1부",
        kind: "presentation",
        message: "Unexpected token <",
        failedAt: 1,
      });
      renderHeader();

      fireEvent.click(screen.getByTestId("save-status"));

      const failure = await screen.findByTestId("save-status-failure");
      expect(failure.textContent).toBe(
        EDITOR_COPY.syncStatus.failedItem("주일 1부"),
      );
      expect(screen.getByTestId("save-status-detail")).not.toHaveTextContent(
        "Unexpected token",
      );
    });

    it("항목 없이 받기가 실패해도 그 요청의 문의 코드를 보여 준다", async () => {
      setSyncStatus(
        "presentation",
        "error",
        "0af7651916cd43dd8448eb211c80319c",
      );
      renderHeader();

      fireEvent.click(screen.getByTestId("save-status"));

      expect(
        await screen.findByTestId("save-status-failure-code"),
      ).toHaveTextContent(EDITOR_COPY.syncStatus.failureCode("0af76519"));
    });

    it("상관 ID가 없거나 실패 상태가 아니면 문의 코드를 보여 주지 않는다", async () => {
      recordSyncFailure({
        id: "doc",
        kind: "presentation",
        message: "거절",
        failedAt: 1,
      });
      renderHeader();

      fireEvent.click(screen.getByTestId("save-status"));

      expect(await screen.findByTestId("save-status-detail")).toBeVisible();
      expect(
        screen.queryByTestId("save-status-failure-code"),
      ).not.toBeInTheDocument();
    });

    it("곡 보관함만 저장하지 못하면 동기화 상태와 다시 시도를 그대로 보여 준다", () => {
      setSyncStatus("presentation", "error");
      reportPersistenceError(new Error("disk"), "deck:hydrate");
      renderHeader();

      expect(screen.getByTestId("save-status")).toHaveTextContent(
        EDITOR_COPY.syncStatus.syncFailed,
      );
      expect(screen.getByTestId("save-status-retry")).toBeInTheDocument();
    });

    it("세트를 저장하지 못해도 동기화가 멈췄으면 다시 시도를 보여 준다", () => {
      setSyncStatus("presentation", "offline");
      reportPersistenceError(new Error("disk"), "presentation");
      renderHeader();

      expect(screen.getByTestId("save-status")).toHaveTextContent(
        EDITOR_COPY.syncStatus.saveFailed,
      );
      fireEvent.click(screen.getByTestId("save-status-retry"));
      expect(syncRecovery.retrySyncNow).toHaveBeenCalledOnce();
    });

    it("세트를 저장하지 못한 채 동기화도 실패하면 실패한 항목과 문의 코드를 보여 준다", async () => {
      recordSyncFailure({
        id: "doc",
        title: "주일 1부",
        kind: "presentation",
        message: "거절",
        failedAt: 1,
        requestId: "0af7651916cd43dd8448eb211c80319c",
      });
      reportPersistenceError(new Error("disk"), "presentation:hydrate");
      renderHeader();

      expect(screen.getByTestId("save-status")).toHaveTextContent(
        EDITOR_COPY.syncStatus.saveFailed,
      );
      fireEvent.click(screen.getByTestId("save-status"));

      expect(
        await screen.findByTestId("save-status-failure"),
      ).toHaveTextContent(EDITOR_COPY.syncStatus.failedItem("주일 1부"));
      expect(screen.getByTestId("save-status-failure-code")).toHaveTextContent(
        EDITOR_COPY.syncStatus.failureCode("0af76519"),
      );
      expect(screen.getByTestId("save-status-retry")).toBeInTheDocument();
    });
  });
});
