import React from "react";
import {
  listPresentations,
  getPresentationById,
} from "../features/presentation";
import {
  __loadDocumentsForTests,
  resetPresentationStore,
} from "../features/presentation/presentationStore";
import {
  __loadFoldersForTests,
  applyServerFolders,
  getFolders,
  resetFolderStore,
} from "../features/drive/folderStore";
import { __setBootPullPendingForTests } from "../lib/sync/bootSync";
import { signInAsTestUser } from "../test/sessionFixture";
import {
  render,
  screen,
  fireEvent,
  act,
  within,
  waitFor,
} from "@testing-library/react";
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockInstance,
} from "vitest";
import type {
  DndContextProps,
  DragEndEvent,
  DragStartEvent,
} from "@dnd-kit/core";
import { MemoryRouter, Routes, Route } from "../test/router";
import { testRouter } from "../test/next/navigation";
import type { Folder } from "#shared";
import { ThemeProvider } from "#components/theme-provider";
import { Toaster } from "#components/ui/sonner";
import { AppShellLayout } from "./AppShellLayout";
import { PresentationsRoute } from "./PresentationsRoute";
import { TrashRoute } from "./TrashRoute";
import { LyricsRoute } from "./LyricsRoute";
import { BackgroundsRoute } from "./BackgroundsRoute";
import * as capabilities from "../lib/browser/capabilities";
import { toast } from "sonner";
import { withQueryClient } from "../test/queryClientFixture";
import { stubMatchMedia } from "../test/matchMedia";
import { BELOW_SM_QUERY } from "#hooks/useMediaQuery";
import { installFakeApi } from "../test/fakeApi";
import { makeBackground } from "../test/backgroundFixture";
import { resetBackgroundCatalogForTests } from "../features/backgrounds/backgroundCatalog";
import { APP_NAME } from "#shared";
import { COMMON_COPY } from "#copy/common";
import { DRIVE_COPY } from "#copy/drive";
import { FOLDER_COPY } from "#copy/folders";
import { PRESENTATION_COPY } from "#copy/presentation";
import { SHELL_COPY } from "#copy/shell";
import { AUTH_COPY, LEGAL_COPY, LEGAL_EFFECTIVE_DATE } from "#copy/auth";
import { SEED_PRESENTATIONS, SEED_USER_ID } from "../test/presentationFixture";
import { authClient } from "../lib/auth/authClient";
import { getSessionState } from "../lib/auth/sessionStore";
import { itemKey, parseItemKey } from "../features/drive/driveModel";
import type { DropTarget } from "../features/drive/driveContext";
import { DRIVE_ROOT_PATH, TRASH_PATH } from "../features/drive/drivePaths";

// better-auth 클라이언트는 만들 때 fetch를 잡아 두어 로그아웃 요청을 가짜 응답으로 바꿀 수 없다.
// better-auth@1.7.12 dist/client/config.mjs (`customFetchImpl: fetch`)
vi.mock("../lib/auth/authClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/auth/authClient")>()),
  authClient: {
    getSession: vi.fn(),
    signIn: { social: vi.fn(), email: vi.fn() },
    signUp: { email: vi.fn() },
    signOut: vi.fn(async () => ({ data: { success: true }, error: null })),
  },
}));

const dnd = vi.hoisted(() => ({
  props: null as DndContextProps | null,
  started: [] as string[],
}));

vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  const { createElement } = await import("react");
  return {
    ...actual,
    DndContext: (props: DndContextProps) => {
      dnd.props = props;
      return createElement(actual.DndContext, {
        ...props,
        onDragStart: (event: DragStartEvent) => {
          dnd.started.push(String(event.active.id));
          props.onDragStart?.(event);
        },
      });
    },
  };
});

function renderShell(initialPath = "/presentations") {
  return render(
    withQueryClient(
      <ThemeProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route layout={AppShellLayout}>
              <Route path="/presentations" element={<PresentationsRoute />} />
              <Route
                path="/presentations/folders/:folderId"
                element={<PresentationsRoute />}
              />
              <Route path="/presentations/trash" element={<TrashRoute />} />
              <Route path="/lyrics" element={<LyricsRoute />} />
              <Route path="/backgrounds" element={<BackgroundsRoute />} />
            </Route>
            <Route
              path="/present/:presentationId/fullscreen"
              element={<div data-testid="fullscreen-stub" />}
            />
            <Route
              path="/editor/:presentationId"
              element={<div data-testid="editor-stub" />}
            />
          </Routes>
        </MemoryRouter>
        <Toaster position="bottom-left" />
      </ThemeProvider>,
    ),
  );
}

const WORSHIP = "a00000000000000000001";
const YOUTH = "b00000000000000000002";
const OUTREACH = "d00000000000000000004";

const H264 = capabilities.BROWSER_CAPABILITIES.find(({ id }) => id === "h264")!;

function folder(
  id: string,
  name: string,
  parentId: string | null = null,
): Folder {
  return {
    id,
    userId: SEED_USER_ID,
    parentId,
    name,
    trashedAt: null,
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-20T00:00:00.000Z",
  };
}

function card(name: string): HTMLElement {
  return screen.getByRole("option", { name: new RegExp(name) });
}

function openTrashFolder(): void {
  act(() => {
    fireEvent.doubleClick(screen.getByTestId("drive-trash-folder"));
  });
}

function startDrag(key: string): void {
  act(() => {
    dnd.props?.onDragStart?.({ active: { id: key } } as DragStartEvent);
  });
}

function dropOn(target: DropTarget): void {
  act(() => {
    dnd.props?.onDragEnd?.({
      over: { data: { current: target } },
    } as unknown as DragEndEvent);
  });
}

function stackRows(): void {
  screen.getAllByRole("option").forEach((option, i) => {
    option.getBoundingClientRect = () =>
      ({
        left: 0,
        right: 800,
        top: i * 50,
        bottom: i * 50 + 48,
      }) as DOMRect;
  });
}

describe("AppShellLayout (드라이브형 홈)", () => {
  beforeEach(() => {
    signInAsTestUser();
    resetPresentationStore();
    resetFolderStore();
    window.localStorage.clear();
    __loadDocumentsForTests(SEED_PRESENTATIONS);
    vi.restoreAllMocks();
  });

  it("폴더와 파일을 한 목록에 보여 주고 최근·템플릿·섹션 구분이 없다", () => {
    __loadFoldersForTests([folder(WORSHIP, "2026 주일 대예배")]);
    renderShell();

    expect(screen.getByText(APP_NAME)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: COMMON_COPY.myDrive }),
    ).toBeInTheDocument();

    const listbox = screen.getByRole("listbox");
    const options = within(listbox).getAllByRole("option");
    expect(options[0]).toHaveAccessibleName("폴더 2026 주일 대예배");
    expect(options).toHaveLength(1 + SEED_PRESENTATIONS.length);

    expect(screen.queryByText("최근")).not.toBeInTheDocument();
    expect(screen.queryByText(/템플릿/)).not.toBeInTheDocument();
    expect(
      screen.queryByText("모든 프레젠테이션 및 템플릿"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("drive-summary")).toHaveTextContent(
      "폴더 1개 · 프레젠테이션 5개",
    );

    expect(within(options[0]).getByTestId("row-icon-folder")).toBeTruthy();
    expect(
      within(card(SEED_PRESENTATIONS[0].title)).getByTestId(
        "row-icon-presentation",
      ),
    ).toBeTruthy();
    expect(
      screen.getAllByRole("columnheader").map((header) => header.textContent),
    ).toEqual([DRIVE_COPY.name, DRIVE_COPY.updatedAt]);
    expect(
      within(card(SEED_PRESENTATIONS[0].title)).queryByText(/슬라이드/),
    ).toBeNull();
  });

  it("첫 링크는 본문으로 건너뛰기이고 main 영역을 가리킨다", () => {
    renderShell();

    const skip = screen.getByRole("link", { name: SHELL_COPY.skipToContent });
    expect(skip).toHaveAttribute("href", "#main-content");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
  });

  it("그리드 보기 없이 목록으로만 보여 준다", () => {
    renderShell();

    expect(screen.queryByTitle("그리드 뷰")).toBeNull();
    expect(screen.queryByTitle("리스트 뷰")).toBeNull();
    expect(screen.getAllByTestId("presentation-row")).toHaveLength(5);

    openTrashFolder();
    expect(screen.queryByTitle("그리드 뷰")).toBeNull();
  });

  it("목록의 편집 버튼은 편집기로 간다", () => {
    renderShell();

    fireEvent.click(screen.getAllByTestId("row-edit-btn")[0]);
    expect(screen.getByTestId("editor-stub")).toBeInTheDocument();
  });

  it("목록의 발표 버튼은 송출 기능을 모두 갖춘 브라우저에서 곧바로 전체화면 송출로 간다", () => {
    vi.spyOn(
      capabilities,
      "getMissingPresentationCapabilities",
    ).mockReturnValue([]);
    renderShell();

    fireEvent.click(screen.getAllByTestId("row-present-btn")[0]);
    expect(screen.getByTestId("fullscreen-stub")).toBeInTheDocument();
  });

  it("전체화면이나 H.264 재생을 지원하지 않으면 빠진 기능을 들어 발표 전에 확인을 받는다", () => {
    vi.spyOn(
      capabilities,
      "getMissingPresentationCapabilities",
    ).mockReturnValue([H264]);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderShell();

    const startBtn = screen.getAllByTestId("row-present-btn")[0];
    fireEvent.click(startBtn);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(
      PRESENTATION_COPY.presentUnreliable(H264.label),
    );
    expect(screen.queryByTestId("fullscreen-stub")).not.toBeInTheDocument();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(startBtn);
    expect(screen.getByTestId("fullscreen-stub")).toBeInTheDocument();
  });

  it("사이드바: 내 드라이브·배경 갤러리만 있고 휴지통은 없다", () => {
    renderShell();

    expect(screen.getByTestId("sidebar-nav-home")).toHaveAttribute(
      "aria-current",
      "page",
    );

    fireEvent.click(screen.getByTestId("sidebar-nav-backgrounds"));
    expect(screen.queryByText("유형: 전체")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: SHELL_COPY.backgroundGallery }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-nav-home")).not.toHaveAttribute(
      "aria-current",
    );

    expect(screen.queryByTestId("sidebar-nav-trash")).toBeNull();
    expect(
      within(
        screen.getByRole("navigation", { name: SHELL_COPY.mainNav }),
      ).queryByText(COMMON_COPY.trash),
    ).toBeNull();

    fireEvent.click(screen.getByTestId("sidebar-nav-home"));
    openTrashFolder();
    expect(
      screen.getByRole("heading", { name: COMMON_COPY.trash }),
    ).toBeInTheDocument();
    expect(screen.getByText(DRIVE_COPY.empty.trashTitle)).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-nav-home")).toHaveAttribute(
      "aria-current",
      "page",
    );

    fireEvent.click(screen.getByTestId("sidebar-nav-home"));
    expect(screen.getAllByTestId("presentation-row")).toHaveLength(5);
  });

  it("로그아웃하지 못하면 알림으로 알리고 계정 카드를 그대로 둔다", async () => {
    renderShell();
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.mocked(authClient.signOut).mockRejectedValueOnce(
      new TypeError("Failed to fetch"),
    );

    fireEvent.click(
      within(screen.getByTestId("account-card")).getByRole("button"),
    );

    expect(
      await screen.findByText(AUTH_COPY.signOutFailed),
    ).toBeInTheDocument();
    expect(getSessionState().status).toBe("authenticated");
    await waitFor(() =>
      expect(
        within(screen.getByTestId("account-card")).getByRole("button"),
      ).toBeEnabled(),
    );
    expect(screen.getByTestId("account-card")).toHaveTextContent(
      SHELL_COPY.signOut,
    );
  });

  it("새로 만들기 → 새 프레젠테이션은 문서를 만들고 편집기로 간다", () => {
    renderShell();

    fireEvent.click(screen.getByTestId("sidebar-create-presentation-btn"));
    act(() => {
      fireEvent.click(screen.getByTestId("new-menu-presentation"));
    });

    expect(screen.getByTestId("editor-stub")).toBeInTheDocument();
    expect(listPresentations()).toHaveLength(6);
  });

  it("폴더 안에서 만든 프레젠테이션은 그 폴더에 들어간다", () => {
    __loadFoldersForTests([folder(WORSHIP, "2026 주일 대예배")]);
    renderShell(`/presentations/folders/${WORSHIP}`);

    fireEvent.click(screen.getByTestId("toolbar-new-btn"));
    act(() => {
      fireEvent.click(screen.getByTestId("new-menu-presentation"));
    });

    const created = listPresentations().at(-1);
    expect(created?.folderId).toBe(WORSHIP);
  });

  it("클릭은 선택, Ctrl·Shift로 여러 개, 더블클릭은 열기", () => {
    renderShell();
    const [first, second, third] = SEED_PRESENTATIONS;
    const options = screen.getAllByRole("option");

    fireEvent.click(options[0]);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("selection-bar")).toHaveTextContent("1개 선택됨");

    fireEvent.click(options[2], { ctrlKey: true });
    expect(screen.getByTestId("selection-bar")).toHaveTextContent("2개 선택됨");

    fireEvent.click(options[0]);
    fireEvent.click(options[3], { shiftKey: true });
    expect(screen.getByTestId("selection-bar")).toHaveTextContent("4개 선택됨");

    fireEvent.click(screen.getByTestId("drive-scroll-area"));
    expect(screen.queryByTestId("selection-bar")).not.toBeInTheDocument();

    act(() => {
      fireEvent.doubleClick(card(first.title));
    });
    expect(screen.getByTestId("editor-stub")).toBeInTheDocument();
    expect(second && third).toBeTruthy();
  });

  it("폴더를 더블클릭하면 들어가고, 경로(브레드크럼)로 돌아온다", () => {
    __loadFoldersForTests([
      folder(WORSHIP, "2026 주일 대예배"),
      folder(YOUTH, "청년부", WORSHIP),
    ]);
    renderShell();

    act(() => {
      fireEvent.doubleClick(card("폴더 2026 주일 대예배"));
    });
    expect(card("폴더 청년부")).toBeInTheDocument();
    expect(screen.queryAllByTestId("presentation-row")).toHaveLength(0);
    expect(screen.getByTestId(`crumb-${WORSHIP}`)).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByTestId("sidebar-nav-home")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      within(
        screen.getByRole("navigation", { name: SHELL_COPY.mainNav }),
      ).queryByText("2026 주일 대예배"),
    ).toBeNull();

    fireEvent.click(screen.getByTestId("crumb-root"));
    expect(screen.getAllByTestId("presentation-row")).toHaveLength(5);
  });

  it("새 폴더를 만들고, 같은 위치의 같은 이름은 거절한다", () => {
    __loadFoldersForTests([folder(WORSHIP, "새 폴더")]);
    renderShell();

    fireEvent.click(screen.getByTestId("sidebar-create-presentation-btn"));
    fireEvent.click(screen.getByTestId("new-menu-folder"));

    const input = screen.getByTestId("drive-name-input");
    expect(input).toHaveValue("새 폴더 (2)");

    fireEvent.change(input, { target: { value: "새 폴더" } });
    expect(
      within(screen.getByTestId("drive-name-dialog")).getByRole("alert"),
    ).toHaveTextContent(FOLDER_COPY.nameTaken);
    expect(screen.getByTestId("drive-name-confirm")).toBeDisabled();

    fireEvent.change(input, { target: { value: "성탄절" } });
    fireEvent.click(screen.getByTestId("drive-name-confirm"));

    expect(
      getFolders()
        .map((f) => f.name)
        .sort(),
    ).toEqual([FOLDER_COPY.newFolder, "성탄절"]);
    expect(card("폴더 성탄절")).toHaveAttribute("aria-selected", "true");
  });

  it("우클릭 메뉴 → 이동으로 다른 폴더에 옮기고, 실행 취소로 되돌린다", async () => {
    __loadFoldersForTests([folder(WORSHIP, "2026 주일 대예배")]);
    renderShell();
    const target = SEED_PRESENTATIONS[1];

    fireEvent.contextMenu(card(target.title));
    fireEvent.click(screen.getByTestId("action-move"));

    const dialog = screen.getByTestId("drive-move-dialog");
    fireEvent.click(within(dialog).getByText("2026 주일 대예배"));
    fireEvent.click(screen.getByTestId("drive-move-confirm"));

    expect(getPresentationById(target.id)?.folderId).toBe(WORSHIP);
    expect(
      screen.queryByRole("option", { name: new RegExp(target.title) }),
    ).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId("drive-toast")).toHaveTextContent(
        "‘2026 주일 대예배’로 옮겼어요",
      ),
    );

    fireEvent.click(
      within(screen.getByTestId("drive-toast")).getByRole("button", {
        name: COMMON_COPY.undo,
      }),
    );
    expect(getPresentationById(target.id)?.folderId ?? null).toBeNull();
  });

  it("드라이브를 떠나면 실행 취소 알림을 닫아 다른 화면에서 되돌리지 않는다", async () => {
    renderShell();
    const target = SEED_PRESENTATIONS[1];

    fireEvent.click(card(target.title));
    act(() => {
      fireEvent.keyDown(document.activeElement ?? window, { key: "Delete" });
    });
    expect(await screen.findByTestId("drive-toast")).toBeInTheDocument();

    act(() => {
      testRouter.push(`/editor/${target.id}`);
    });

    expect(screen.getByTestId("editor-stub")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByTestId("drive-toast")).not.toBeInTheDocument(),
    );
    expect(getPresentationById(target.id)?.trashedAt).not.toBeNull();
  });

  it("폴더를 자기 하위로는 옮길 수 없다 (이동 대화 상자에서 비활성)", () => {
    __loadFoldersForTests([
      folder(WORSHIP, "2026 주일 대예배"),
      folder(YOUTH, "청년부", WORSHIP),
    ]);
    renderShell();

    fireEvent.contextMenu(card("폴더 2026 주일 대예배"));
    fireEvent.click(screen.getByTestId("action-move"));

    const dialog = screen.getByTestId("drive-move-dialog");
    const self = within(dialog).getByTestId(`picker-node-${WORSHIP}`);
    expect(
      within(self).getByRole("button", { name: "2026 주일 대예배" }),
    ).toBeDisabled();
    fireEvent.click(within(dialog).getByTestId("picker-node-root"));
    expect(screen.getByTestId("drive-move-confirm")).toBeDisabled();
  });

  it("Delete로 휴지통에 넣고, 휴지통에서 복원한다", () => {
    renderShell();
    const target = SEED_PRESENTATIONS[2];

    fireEvent.click(card(target.title));
    fireEvent.keyDown(window, { key: "Delete" });

    expect(getPresentationById(target.id)?.trashedAt).toBeTruthy();
    expect(screen.getAllByTestId("presentation-row")).toHaveLength(4);

    openTrashFolder();
    const trashed = card(target.title);
    expect(trashed).toHaveAttribute("data-testid", "presentation-row");
    expect(within(trashed).queryByTestId("row-present-btn")).toBeNull();
    expect(within(trashed).queryByTestId("row-edit-btn")).toBeNull();
    fireEvent.contextMenu(trashed);
    fireEvent.click(screen.getByTestId("action-restore"));

    expect(getPresentationById(target.id)?.trashedAt).toBeNull();
    expect(screen.getByText(DRIVE_COPY.empty.trashTitle)).toBeInTheDocument();
  });

  it("휴지통 항목 우클릭 메뉴 → 영구 삭제 시 대화 상자를 띄운다", () => {
    const trashed = {
      ...SEED_PRESENTATIONS[0],
      title: "성탄절 특별 예배",
      trashedAt: "2026-09-20T12:00:00.000Z",
    };
    __loadDocumentsForTests([trashed, ...SEED_PRESENTATIONS.slice(1)]);
    renderShell("/presentations/trash");

    fireEvent.contextMenu(card(trashed.title));
    fireEvent.click(screen.getByTestId("action-delete-forever"));

    const dialog = screen.getByTestId("drive-confirm-dialog");
    expect(dialog).toHaveTextContent("‘성탄절 특별 예배’를 영구 삭제할까요?");
    expect(dialog).toHaveTextContent(
      DRIVE_COPY.deleteForeverDialog.irreversible,
    );
  });

  it("휴지통에서 항목을 영구 삭제하면 토스트에 항목 제목과 올바른 조사가 표시된다", async () => {
    const fake = installFakeApi({
      "DELETE /api/presentations/*": () => ({
        status: 200,
        body: { ok: true },
      }),
    });
    try {
      const target = {
        ...SEED_PRESENTATIONS[0],
        title: "테스트 프레젠테이션 (사본)",
        trashedAt: "2026-09-20T12:00:00.000Z",
      };
      __loadDocumentsForTests([target, ...SEED_PRESENTATIONS.slice(1)]);
      renderShell("/presentations/trash");

      fireEvent.contextMenu(card("테스트 프레젠테이션 \\(사본\\)"));
      fireEvent.click(screen.getByTestId("action-delete-forever"));

      expect(screen.getByTestId("drive-confirm-dialog")).toBeInTheDocument();
      await act(async () => {
        fireEvent.click(screen.getByTestId("drive-confirm-btn"));
      });

      expect(getPresentationById(target.id)).toBeUndefined();
      await waitFor(() =>
        expect(screen.getByTestId("drive-toast")).toHaveTextContent(
          "‘테스트 프레젠테이션 (사본)’을 영구 삭제했어요",
        ),
      );
    } finally {
      fake.restore();
    }
  });

  it("휴지통에서 받침 없는 항목을 영구 삭제하면 '를' 조사가 표시된다", async () => {
    const fake = installFakeApi({
      "DELETE /api/presentations/*": () => ({
        status: 200,
        body: { ok: true },
      }),
    });
    try {
      const target = {
        ...SEED_PRESENTATIONS[0],
        title: "주일 콘티",
        trashedAt: "2026-09-20T12:00:00.000Z",
      };
      __loadDocumentsForTests([target, ...SEED_PRESENTATIONS.slice(1)]);
      renderShell("/presentations/trash");

      fireEvent.contextMenu(card("주일 콘티"));
      fireEvent.click(screen.getByTestId("action-delete-forever"));

      await act(async () => {
        fireEvent.click(screen.getByTestId("drive-confirm-btn"));
      });

      expect(getPresentationById(target.id)).toBeUndefined();
      await waitFor(() =>
        expect(screen.getByTestId("drive-toast")).toHaveTextContent(
          "‘주일 콘티’를 영구 삭제했어요",
        ),
      );
    } finally {
      fake.restore();
    }
  });

  it("휴지통에서 폴더를 영구 삭제하면 폴더 이름과 조사가 토스트에 표시된다", async () => {
    const fake = installFakeApi({
      "DELETE /api/folders/*": () => ({
        status: 200,
        body: {
          ok: true,
          deletedFolderIds: [WORSHIP],
          deletedPresentationIds: [],
        },
      }),
    });
    try {
      __loadFoldersForTests([
        {
          ...folder(WORSHIP, "2026 주일 대예배"),
          trashedAt: "2026-09-20T12:00:00.000Z",
        },
      ]);
      __loadDocumentsForTests([]);
      renderShell("/presentations/trash");

      fireEvent.contextMenu(card("폴더 2026 주일 대예배"));
      fireEvent.click(screen.getByTestId("action-delete-forever"));

      await act(async () => {
        fireEvent.click(screen.getByTestId("drive-confirm-btn"));
      });

      expect(getFolders().find((f) => f.id === WORSHIP)).toBeUndefined();
      await waitFor(() =>
        expect(screen.getByTestId("drive-toast")).toHaveTextContent(
          "‘2026 주일 대예배’를 영구 삭제했어요",
        ),
      );
    } finally {
      fake.restore();
    }
  });

  it("휴지통의 날짜 칸은 삭제일을 보여 준다", () => {
    const trashed = {
      ...SEED_PRESENTATIONS[0],
      updatedAt: "2026-09-01T12:00:00.000Z",
      trashedAt: "2026-09-20T12:00:00.000Z",
    };
    __loadDocumentsForTests([trashed, ...SEED_PRESENTATIONS.slice(1)]);
    renderShell("/presentations/trash");

    expect(screen.getByText(DRIVE_COPY.deletedAt)).toBeInTheDocument();
    expect(screen.queryByText(DRIVE_COPY.updatedAt)).toBeNull();
    const row = card(trashed.title);
    expect(row).toHaveTextContent("2026. 9. 20.");
    expect(row).not.toHaveTextContent("2026. 9. 1.");
  });

  it("폴더를 휴지통에 넣으면 안의 세트도 함께 가려진다", () => {
    __loadFoldersForTests([folder(WORSHIP, "2026 주일 대예배")]);
    const inside = { ...SEED_PRESENTATIONS[0], folderId: WORSHIP };
    __loadDocumentsForTests([inside, ...SEED_PRESENTATIONS.slice(1)]);
    renderShell();

    fireEvent.contextMenu(card("폴더 2026 주일 대예배"));
    fireEvent.click(screen.getByTestId("action-trash"));

    openTrashFolder();
    expect(screen.getAllByRole("option")).toHaveLength(1);

    fireEvent.click(screen.getByTestId("sidebar-nav-home"));
    fireEvent.change(
      screen.getByPlaceholderText(SHELL_COPY.searchPlaceholder.drive),
      { target: { value: inside.title } },
    );
    expect(
      screen.queryByRole("option", { name: new RegExp(inside.title) }),
    ).toBeNull();
  });

  it("검색은 모든 폴더를 가로질러 찾고 위치를 보여 준다", () => {
    __loadFoldersForTests([folder(WORSHIP, "2026 주일 대예배")]);
    const inside = { ...SEED_PRESENTATIONS[0], folderId: WORSHIP };
    __loadDocumentsForTests([inside, ...SEED_PRESENTATIONS.slice(1)]);
    renderShell();

    fireEvent.change(
      screen.getByPlaceholderText(SHELL_COPY.searchPlaceholder.drive),
      { target: { value: inside.title } },
    );

    const result = card(inside.title);
    expect(result).toHaveTextContent("내 드라이브 › 2026 주일 대예배");
    expect(
      screen.getByRole("columnheader", { name: DRIVE_COPY.location }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("drive-summary")).toHaveTextContent("검색 결과");
  });

  it("폰 폭에서는 드라이브 검색창 안내를 줄여 잘리지 않게 하고, 넓어지면 전체 안내로 돌아온다", () => {
    const media = stubMatchMedia(BELOW_SM_QUERY);
    renderShell();
    const input = screen.getByTestId("shell-search-input");

    expect(input).toHaveAttribute(
      "placeholder",
      SHELL_COPY.searchPlaceholder.driveCompact,
    );

    act(() => media.match());

    expect(input).toHaveAttribute(
      "placeholder",
      SHELL_COPY.searchPlaceholder.drive,
    );
  });

  it("휴지통 검색창 안내는 폰 폭에서도 그대로다", () => {
    stubMatchMedia(BELOW_SM_QUERY);
    renderShell();

    openTrashFolder();

    expect(screen.getByTestId("shell-search-input")).toHaveAttribute(
      "placeholder",
      SHELL_COPY.searchPlaceholder.trash,
    );
  });

  it("배경 갤러리 검색어는 드라이브 검색어와 따로 두고, 제출해야 거른다", async () => {
    resetBackgroundCatalogForTests();
    const sunset = makeBackground(1, { title: "따뜻한 노을" });
    const lake = makeBackground(2, { title: "고요한 호수" });
    const api = installFakeApi({
      "GET /api/backgrounds": () => ({
        body: { backgrounds: [sunset, lake] },
      }),
    });
    try {
      renderShell();
      const input = (): HTMLElement => screen.getByTestId("shell-search-input");
      fireEvent.change(input(), { target: { value: "주일" } });

      fireEvent.click(screen.getByTestId("sidebar-nav-backgrounds"));
      expect(input()).toHaveValue("");
      await screen.findByRole("img", { name: sunset.title });

      fireEvent.change(input(), { target: { value: "호수" } });
      expect(
        screen.getByRole("img", { name: sunset.title }),
      ).toBeInTheDocument();
      expect(
        api.calls.some((call) =>
          call.path.startsWith("/api/backgrounds/search"),
        ),
      ).toBe(false);

      fireEvent.click(screen.getByRole("button", { name: COMMON_COPY.search }));
      expect(
        await screen.findByRole("img", { name: lake.title }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("img", { name: sunset.title }),
      ).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId("sidebar-nav-home"));
      expect(input()).toHaveValue("주일");
    } finally {
      api.restore();
      resetBackgroundCatalogForTests();
    }
  });

  it("없는 폴더 주소는 루트로 보낸다", () => {
    renderShell("/presentations/folders/c00000000000000000009");
    expect(screen.getByTestId(`crumb-root`)).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getAllByTestId("presentation-row")).toHaveLength(5);
  });

  it("휴지통에 있는 폴더 주소는 열 수 있는 가장 가까운 상위 폴더로 보낸다", () => {
    __loadFoldersForTests([
      folder(WORSHIP, "2026"),
      folder(YOUTH, "주일", WORSHIP),
      {
        ...folder(OUTREACH, "청년부", YOUTH),
        trashedAt: "2026-10-01T00:00:00Z",
      },
    ]);
    renderShell(`/presentations/folders/${OUTREACH}`);

    expect(window.location.pathname).toBe(`/presentations/folders/${YOUTH}`);
    expect(screen.getByTestId(`crumb-${YOUTH}`)).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("현재 폴더를 ▾ 메뉴로 휴지통에 보내면 이동이 늦어도 루트가 아니라 상위 폴더로 간다", async () => {
    __loadFoldersForTests([
      folder(WORSHIP, "2026"),
      folder(YOUTH, "주일", WORSHIP),
    ]);
    renderShell(`/presentations/folders/${YOUTH}`);
    const push = testRouter.push;
    vi.spyOn(testRouter, "push").mockImplementation((href) => {
      setTimeout(() => push(href), 0);
    });
    const replace = vi.spyOn(testRouter, "replace");

    fireEvent.click(screen.getByTestId("breadcrumb-menu-btn"));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: DRIVE_COPY.moveToTrash }),
    );

    expect(replace).not.toHaveBeenCalledWith(DRIVE_ROOT_PATH);
    await waitFor(() =>
      expect(screen.getByTestId(`crumb-${WORSHIP}`)).toHaveAttribute(
        "aria-current",
        "page",
      ),
    );
    expect(window.location.pathname).toBe(`/presentations/folders/${WORSHIP}`);
  });

  describe("부팅 동기화가 아직 받지 않은 폴더 주소", () => {
    let notice: MockInstance<typeof toast.info>;

    beforeEach(() => {
      notice = vi.spyOn(toast, "info").mockReturnValue("notice");
    });

    afterEach(() => {
      __setBootPullPendingForTests([]);
    });

    it("폴더를 받는 중이면 모르는 폴더 주소를 루트로 보내지 않고, 받으면 그 폴더를 연다", async () => {
      __setBootPullPendingForTests(["folder"]);
      renderShell(`/presentations/folders/${WORSHIP}`);

      expect(screen.getByTestId("drive-pending")).toBeInTheDocument();
      expect(window.location.pathname).toBe(
        `/presentations/folders/${WORSHIP}`,
      );

      await act(async () => {
        await applyServerFolders([folder(WORSHIP, "2026 주일 대예배")]);
      });

      expect(screen.queryByTestId("drive-pending")).not.toBeInTheDocument();
      expect(screen.getByTestId(`crumb-${WORSHIP}`)).toHaveAttribute(
        "aria-current",
        "page",
      );
      expect(window.location.pathname).toBe(
        `/presentations/folders/${WORSHIP}`,
      );
      expect(notice).not.toHaveBeenCalled();
    });

    it("받기가 끝났는데도 없는 폴더 주소는 루트로 보내고, 그때서야 찾지 못했다고 알린다", async () => {
      __setBootPullPendingForTests(["folder"]);
      renderShell(`/presentations/folders/${WORSHIP}`);

      expect(screen.getByTestId("drive-pending")).toBeInTheDocument();
      expect(notice).not.toHaveBeenCalled();

      act(() => {
        __setBootPullPendingForTests([]);
      });

      expect(screen.getByTestId("crumb-root")).toHaveAttribute(
        "aria-current",
        "page",
      );
      expect(window.location.pathname).toBe("/presentations");
      expect(notice).toHaveBeenCalledTimes(1);
      expect(notice).toHaveBeenCalledWith(
        DRIVE_COPY.toast.folderNotFound,
        expect.anything(),
      );
    });

    it("받는 중이 아니어도 모르는 폴더 주소는 루트로 보내고 찾지 못했다고 알린다", () => {
      renderShell(`/presentations/folders/${WORSHIP}`);

      expect(window.location.pathname).toBe("/presentations");
      expect(notice).toHaveBeenCalledWith(
        DRIVE_COPY.toast.folderNotFound,
        expect.anything(),
      );
    });

    it("휴지통에 있는 폴더는 받는 중이어도 바로 루트로 보낸다", () => {
      __loadFoldersForTests([
        {
          ...folder(WORSHIP, "2026 주일 대예배"),
          trashedAt: "2026-10-01T00:00:00.000Z",
        },
      ]);
      __setBootPullPendingForTests(["folder"]);
      renderShell(`/presentations/folders/${WORSHIP}`);

      expect(screen.queryByTestId("drive-pending")).not.toBeInTheDocument();
      expect(screen.getByTestId("crumb-root")).toHaveAttribute(
        "aria-current",
        "page",
      );
      expect(window.location.pathname).toBe("/presentations");
      expect(notice).not.toHaveBeenCalled();
    });
  });

  it("휴지통은 내 드라이브 루트 맨 위에 고정된 폴더로 보인다", () => {
    __loadFoldersForTests([folder(WORSHIP, "가나다")]);
    renderShell();

    const trashRow = screen.getByTestId("drive-trash-folder");
    expect(trashRow).toHaveAccessibleName(DRIVE_COPY.trashFolder);
    expect(
      trashRow.compareDocumentPosition(screen.getByRole("listbox")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(
      1 + SEED_PRESENTATIONS.length,
    );
    expect(screen.getByTestId("drive-summary")).toHaveTextContent(
      "폴더 1개 · 프레젠테이션 5개",
    );

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    expect(screen.getByTestId("selection-bar")).toHaveTextContent(
      `${1 + SEED_PRESENTATIONS.length}개 선택됨`,
    );
  });

  it("휴지통 폴더는 폴더 안과 검색 결과에는 나오지 않는다", () => {
    __loadFoldersForTests([folder(WORSHIP, "2026 주일 대예배")]);
    renderShell(`/presentations/folders/${WORSHIP}`);
    expect(screen.queryByTestId("drive-trash-folder")).toBeNull();

    fireEvent.click(screen.getByTestId("crumb-root"));
    expect(screen.getByTestId("drive-trash-folder")).toBeInTheDocument();

    fireEvent.change(
      screen.getByPlaceholderText(SHELL_COPY.searchPlaceholder.drive),
      { target: { value: COMMON_COPY.trash } },
    );
    expect(screen.queryByTestId("drive-trash-folder")).toBeNull();
  });

  it("휴지통 폴더는 이름 바꾸기·이동·삭제할 수 없고 열기·비우기만 된다", () => {
    const trashed = {
      ...SEED_PRESENTATIONS[0],
      trashedAt: "2026-09-20T12:00:00.000Z",
    };
    __loadDocumentsForTests([trashed, ...SEED_PRESENTATIONS.slice(1)]);
    renderShell();

    const trashRow = screen.getByTestId("drive-trash-folder");

    fireEvent.contextMenu(trashRow);
    expect(screen.getByTestId("action-open")).toBeInTheDocument();
    expect(screen.getByTestId("action-empty-trash")).toBeEnabled();
    expect(screen.queryByTestId("action-rename")).toBeNull();
    expect(screen.queryByTestId("action-move")).toBeNull();
    expect(screen.queryByTestId("action-trash")).toBeNull();
    expect(screen.queryByTestId("new-menu-folder")).toBeNull();

    fireEvent.click(screen.getByTestId("action-open"));
    expect(
      screen.getByRole("heading", { name: COMMON_COPY.trash }),
    ).toBeInTheDocument();
    expect(card(trashed.title)).toBeInTheDocument();
  });

  it("휴지통의 경로는 내 드라이브 › 휴지통이고 ▾ 메뉴가 없다", () => {
    renderShell("/presentations/trash");

    expect(screen.getByTestId("crumb-trash")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByTestId("crumb-root")).not.toHaveAttribute(
      "aria-current",
    );
    expect(screen.queryByTestId("breadcrumb-menu-btn")).toBeNull();

    fireEvent.click(screen.getByTestId("crumb-root"));
    expect(screen.getByTestId("drive-trash-folder")).toBeInTheDocument();
    expect(screen.getAllByTestId("presentation-row")).toHaveLength(5);
  });

  it("루트가 비어 있어도 휴지통 폴더와 빈 상태가 함께 보인다", () => {
    __loadDocumentsForTests([]);
    renderShell();

    expect(screen.getByTestId("drive-trash-folder")).toBeInTheDocument();
    expect(screen.getByTestId("drive-empty")).toHaveTextContent(
      DRIVE_COPY.empty.rootTitle,
    );
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("헤더 테마 메뉴", () => {
    renderShell();

    const themeBtn = screen.getByTestId("theme-menu-button");
    fireEvent.click(themeBtn);
    expect(screen.getByTestId("theme-menu-dropdown")).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByTestId("theme-option-light"));
    });
    expect(screen.queryByTestId("theme-menu-dropdown")).not.toBeInTheDocument();
    expect(themeBtn).toHaveAccessibleName("테마 설정: 라이트 모드");
  });

  it("열 머리글을 눌러 정렬하고, 같은 머리글을 다시 누르면 방향을 뒤집는다", () => {
    renderShell();

    expect(screen.queryByTestId("drive-sort-dropdown")).toBeNull();
    const columnHeader = (label: string): HTMLElement =>
      screen.getByRole("columnheader", { name: new RegExp(label) });
    expect(columnHeader(DRIVE_COPY.updatedAt)).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    expect(screen.getAllByTestId("presentation-row")[1]).toHaveTextContent(
      "청년부 금요 찬양 집회",
    );

    fireEvent.click(screen.getByTestId("sort-header-name"));
    expect(columnHeader(DRIVE_COPY.name)).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    expect(columnHeader(DRIVE_COPY.updatedAt)).not.toHaveAttribute("aria-sort");
    const byName = screen.getAllByTestId("presentation-row");
    expect(byName[1]).toHaveTextContent("부활절 감사예배 특별 순서");

    fireEvent.click(screen.getByTestId("sort-header-name"));
    expect(columnHeader(DRIVE_COPY.name)).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    const reversed = screen.getAllByTestId("presentation-row");
    expect(reversed.map((row) => row.getAttribute("aria-label"))).toEqual(
      byName.map((row) => row.getAttribute("aria-label")).reverse(),
    );

    fireEvent.click(screen.getByTestId("sort-header-updated"));
    expect(columnHeader(DRIVE_COPY.updatedAt)).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    expect(screen.getAllByTestId("presentation-row")[1]).toHaveTextContent(
      "청년부 금요 찬양 집회",
    );
  });

  it("유형 칩은 폴더·프레젠테이션을 고르고 ✕로 지운다", () => {
    __loadFoldersForTests([folder(WORSHIP, "2026 주일 대예배")]);
    renderShell();

    expect(screen.queryByText(/카테고리/)).toBeNull();
    expect(screen.queryByText(/소유자:/)).toBeNull();

    const typeButton = screen.getByTestId("drive-type-dropdown");
    expect(typeButton).toHaveTextContent(DRIVE_COPY.type);
    expect(screen.queryByTestId("drive-type-clear")).toBeNull();

    fireEvent.click(typeButton);
    const menu = screen.getByTestId("drive-type-menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([DRIVE_COPY.kind.folder, DRIVE_COPY.kind.file]);

    fireEvent.click(screen.getByTestId("type-option-folder"));
    expect(screen.queryByTestId("drive-type-menu")).toBeNull();
    expect(typeButton).toHaveTextContent(DRIVE_COPY.kind.folder);
    expect(screen.queryAllByTestId("presentation-row")).toHaveLength(0);
    expect(within(screen.getByRole("listbox")).getAllByRole("option")).toEqual([
      card("폴더 2026 주일 대예배"),
    ]);
    expect(screen.getByTestId("drive-trash-folder")).toBeInTheDocument();
    expect(screen.getByTestId("drive-summary")).toHaveTextContent(
      "폴더 1개 · 프레젠테이션 0개",
    );

    fireEvent.click(typeButton);
    fireEvent.click(screen.getByTestId("type-option-file"));
    expect(typeButton).toHaveTextContent(DRIVE_COPY.kind.file);
    expect(screen.getAllByTestId("presentation-row")).toHaveLength(
      SEED_PRESENTATIONS.length,
    );
    expect(
      screen.queryByRole("option", { name: /2026 주일 대예배/ }),
    ).toBeNull();
    expect(screen.queryByTestId("drive-trash-folder")).toBeNull();

    fireEvent.click(screen.getByTestId("drive-type-clear"));
    expect(screen.getByTestId("drive-type-dropdown")).toHaveTextContent(
      DRIVE_COPY.type,
    );
    expect(
      within(screen.getByRole("listbox")).getAllByRole("option"),
    ).toHaveLength(1 + SEED_PRESENTATIONS.length);
  });

  it("유형 필터에 맞는 항목이 없으면 필터 안내를 보여 준다", () => {
    renderShell();

    fireEvent.click(screen.getByTestId("drive-type-dropdown"));
    fireEvent.click(screen.getByTestId("type-option-folder"));

    const empty = screen.getByTestId("drive-empty");
    expect(empty).toHaveTextContent(DRIVE_COPY.empty.filteredTitle);
    expect(within(empty).queryByTestId("empty-new-presentation")).toBeNull();
  });

  it("휴지통에서는 유형 칩 대신 안내 배너를 보이고, 머리글로 정렬하지 않는다", () => {
    renderShell();
    act(() => {
      fireEvent.keyDown(window, { key: "Delete" });
    });
    fireEvent.click(screen.getAllByRole("option")[0]);
    fireEvent.keyDown(window, { key: "Delete" });
    openTrashFolder();

    expect(
      screen.getByRole("heading", { name: COMMON_COPY.trash }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("drive-type-dropdown")).toBeNull();
    expect(screen.getByTestId("drive-summary")).toHaveTextContent(
      "영구 삭제하기 전까지",
    );
    expect(screen.getByTestId("empty-trash-btn")).toBeEnabled();
    expect(screen.queryByTestId("sort-header-name")).toBeNull();
    expect(
      screen.getByRole("columnheader", { name: DRIVE_COPY.originalLocation }),
    ).toBeInTheDocument();
  });
});

describe("AppShellLayout (구글 드라이브식 조작)", () => {
  beforeEach(() => {
    signInAsTestUser();
    resetPresentationStore();
    resetFolderStore();
    window.localStorage.clear();
    __loadDocumentsForTests(SEED_PRESENTATIONS);
    vi.restoreAllMocks();
  });

  function selectedCount(): number {
    return screen
      .getAllByRole("option")
      .filter((option) => option.getAttribute("aria-selected") === "true")
      .length;
  }

  function press(key: string, init: Partial<KeyboardEventInit> = {}): void {
    act(() => {
      fireEvent.keyDown(document.activeElement ?? window, { key, ...init });
    });
  }

  it("방향키로 포커스와 선택을 옮기고 Shift·Ctrl·Space·Home·End가 동작한다", () => {
    renderShell();
    const options = screen.getAllByRole("option");

    press("ArrowDown");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[0]).toHaveFocus();
    expect(options[0]).toHaveAttribute("tabindex", "0");
    expect(options[1]).toHaveAttribute("tabindex", "-1");

    press("ArrowDown");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(selectedCount()).toBe(1);

    press("ArrowDown", { shiftKey: true });
    expect(selectedCount()).toBe(2);
    expect(options[2]).toHaveFocus();

    press("ArrowDown", { ctrlKey: true });
    expect(options[3]).toHaveFocus();
    expect(selectedCount()).toBe(2);

    press(" ");
    expect(options[3]).toHaveAttribute("aria-selected", "true");
    expect(selectedCount()).toBe(3);

    press("End");
    expect(options[options.length - 1]).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(selectedCount()).toBe(1);

    press("Home", { shiftKey: true });
    expect(selectedCount()).toBe(options.length);

    press("Escape");
    expect(selectedCount()).toBe(0);
  });

  it("선택된 묶음을 누르면 유지하고(끌기 대비), 떼면 그 항목만 남긴다", () => {
    renderShell();
    const options = screen.getAllByRole("option");

    fireEvent.click(options[0]);
    fireEvent.click(options[2], { ctrlKey: true });
    expect(selectedCount()).toBe(2);

    fireEvent.mouseDown(options[2]);
    expect(selectedCount()).toBe(2);
    fireEvent.click(options[2]);
    expect(selectedCount()).toBe(1);
    expect(options[2]).toHaveAttribute("aria-selected", "true");

    fireEvent.mouseDown(options[4]);
    expect(options[4]).toHaveAttribute("aria-selected", "true");
    expect(selectedCount()).toBe(1);

    fireEvent.click(options[1], { ctrlKey: true, shiftKey: true });
    expect(selectedCount()).toBe(4);
  });

  it("빈 곳에서 끌면 사각형과 겹치는 행을 고른다", () => {
    renderShell();
    const options = screen.getAllByRole("option");
    options.forEach((option, i) => {
      option.getBoundingClientRect = () =>
        ({
          left: 0,
          right: 800,
          top: i * 50,
          bottom: i * 50 + 48,
        }) as DOMRect;
    });
    const area = screen.getByTestId("drive-scroll-area");

    fireEvent.mouseDown(area, { clientX: 820, clientY: 10, button: 0 });
    fireEvent.mouseMove(window, { clientX: 700, clientY: 130 });
    expect(screen.getByTestId("drive-marquee")).toBeInTheDocument();
    expect(selectedCount()).toBe(3);
    expect(options[3]).toHaveAttribute("aria-selected", "false");

    fireEvent.mouseUp(window);
    fireEvent.click(area);
    expect(screen.queryByTestId("drive-marquee")).toBeNull();
    expect(selectedCount()).toBe(3);

    fireEvent.mouseDown(area, {
      clientX: 820,
      clientY: 210,
      button: 0,
      ctrlKey: true,
    });
    fireEvent.mouseMove(window, { clientX: 700, clientY: 230 });
    fireEvent.mouseUp(window);
    fireEvent.click(area);
    expect(selectedCount()).toBe(4);

    fireEvent.click(area);
    expect(selectedCount()).toBe(0);
  });

  it("단축키: Z 이동, Shift+F 새 폴더, Delete 후 Ctrl+Z 실행 취소, / 검색", () => {
    renderShell();
    const options = screen.getAllByRole("option");

    fireEvent.click(options[0]);
    press("z");
    expect(screen.getByRole("dialog")).toHaveTextContent(DRIVE_COPY.move);
    act(() => {
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    });
    expect(screen.queryByRole("dialog")).toBeNull();

    press("F", { shiftKey: true, code: "KeyF" });
    expect(screen.getByRole("dialog")).toHaveTextContent(FOLDER_COPY.newFolder);
    act(() => {
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getAllByRole("option")[0]);
    press("Delete");
    expect(screen.getAllByRole("option")).toHaveLength(
      SEED_PRESENTATIONS.length - 1,
    );
    press("z", { ctrlKey: true, code: "KeyZ" });
    expect(screen.getAllByRole("option")).toHaveLength(
      SEED_PRESENTATIONS.length,
    );
    expect(screen.queryByTestId("drive-toast")).toBeNull();

    act(() => {
      fireEvent.keyDown(document.body, { key: "/" });
    });
    expect(screen.getByTestId("shell-search-input")).toHaveFocus();
  });

  it("우클릭 메뉴는 키보드로 옮겨 다니고 단축키를 보여 준다", async () => {
    renderShell();
    const options = screen.getAllByRole("option");

    fireEvent.contextMenu(options[1]);
    const menu = await screen.findByTestId("drive-menu");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(within(menu).getByTestId("action-rename")).toHaveTextContent("F2");
    const items = within(menu).getAllByRole("menuitem");

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    await waitFor(() => expect(items[0]).toHaveFocus());
    fireEvent.keyDown(items[0], { key: "ArrowUp" });
    await waitFor(() => expect(items[items.length - 1]).toHaveFocus());
    fireEvent.keyDown(items[items.length - 1], { key: "Home" });
    await waitFor(() => expect(items[0]).toHaveFocus());
    fireEvent.keyDown(items[0], { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("drive-menu")).toBeNull());
  });
});

describe("AppShellLayout (끌어 옮기기와 선택 범위)", () => {
  beforeEach(() => {
    signInAsTestUser();
    resetPresentationStore();
    resetFolderStore();
    window.localStorage.clear();
    __loadDocumentsForTests(SEED_PRESENTATIONS);
    vi.restoreAllMocks();
  });

  it("끌어서 폴더로 옮긴 뒤에는 선택을 풀어, 사라진 항목이 다음 끌기에 딸려 가지 않는다", () => {
    __loadFoldersForTests([
      folder(WORSHIP, "2026 주일 대예배"),
      folder(YOUTH, "청년부"),
    ]);
    renderShell();
    const [moved, second, third] = SEED_PRESENTATIONS;

    fireEvent.mouseDown(card(moved.title));
    startDrag(itemKey("file", moved.id));
    dropOn({ kind: "folder", folderId: WORSHIP });
    expect(getPresentationById(moved.id)?.folderId).toBe(WORSHIP);
    expect(screen.queryByTestId("selection-bar")).not.toBeInTheDocument();

    fireEvent.click(card(second.title), { ctrlKey: true });
    fireEvent.click(card(third.title), { ctrlKey: true });
    expect(screen.getByTestId("selection-bar")).toHaveTextContent("2개 선택됨");
    startDrag(itemKey("file", second.id));
    dropOn({ kind: "folder", folderId: YOUTH });

    expect(getPresentationById(moved.id)?.folderId).toBe(WORSHIP);
    expect(getPresentationById(second.id)?.folderId).toBe(YOUTH);
    expect(getPresentationById(third.id)?.folderId).toBe(YOUTH);
  });

  it("검색으로 가려진 선택 항목은 끌 때 함께 옮기지 않고, 옮긴 뒤에는 선택을 푼다", () => {
    __loadFoldersForTests([folder(WORSHIP, "2026 주일 대예배")]);
    renderShell();
    const [hidden, found] = SEED_PRESENTATIONS;

    fireEvent.click(card(hidden.title));
    fireEvent.click(card(found.title), { ctrlKey: true });
    fireEvent.change(screen.getByTestId("shell-search-input"), {
      target: { value: found.title },
    });
    expect(
      screen.queryByRole("option", { name: new RegExp(hidden.title) }),
    ).toBeNull();
    expect(screen.getByTestId("selection-bar")).toHaveTextContent("1개 선택됨");

    startDrag(itemKey("file", found.id));
    dropOn({ kind: "folder", folderId: WORSHIP });

    expect(getPresentationById(found.id)?.folderId).toBe(WORSHIP);
    expect(getPresentationById(hidden.id)?.folderId ?? null).toBeNull();
    expect(screen.queryByTestId("selection-bar")).not.toBeInTheDocument();
  });

  it("검색어를 바꿔 가려진 항목은 선택에서도 빠져, 휴지통으로 끌어도 함께 버리지 않는다", () => {
    renderShell();
    const [hidden, found] = SEED_PRESENTATIONS;

    fireEvent.click(card(hidden.title));
    fireEvent.click(card(found.title), { ctrlKey: true });
    fireEvent.change(screen.getByTestId("shell-search-input"), {
      target: { value: found.title },
    });
    startDrag(itemKey("file", found.id));
    dropOn({ kind: "trash" });

    expect(getPresentationById(found.id)?.trashedAt).toBeTruthy();
    expect(getPresentationById(hidden.id)?.trashedAt ?? null).toBeNull();
  });

  it("사본을 만들면 새로 보이게 된 사본이 선택에서 빠지지 않고 선택된 채 남는다", () => {
    renderShell();
    const before = new Set(listPresentations().map((doc) => doc.id));

    fireEvent.contextMenu(card(SEED_PRESENTATIONS[0].title));
    fireEvent.click(screen.getByTestId("action-duplicate"));

    const [copy] = listPresentations().filter((doc) => !before.has(doc.id));
    expect(copy).toBeDefined();
    expect(screen.getByTestId("selection-bar")).toHaveTextContent("1개 선택됨");
    expect(
      screen.getByRole("option", {
        name: `${DRIVE_COPY.kind.file} ${copy?.title}`,
      }),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("새 폴더를 만들면 만든 폴더가 선택된 채 남는다", () => {
    renderShell();

    fireEvent.click(screen.getByTestId("sidebar-create-presentation-btn"));
    fireEvent.click(screen.getByTestId("new-menu-folder"));
    fireEvent.change(screen.getByTestId("drive-name-input"), {
      target: { value: "성탄절" },
    });
    fireEvent.click(screen.getByTestId("drive-name-confirm"));

    expect(card("폴더 성탄절")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("selection-bar")).toHaveTextContent("1개 선택됨");
  });

  it("검색창에 글자를 친 채 빈 곳을 끌어 고르면 검색창에서 벗어나, Delete가 고른 항목을 휴지통에 보낸다", () => {
    renderShell();
    const input = screen.getByTestId("shell-search-input");
    input.focus();
    fireEvent.change(input, { target: { value: "예배" } });
    stackRows();
    const listed = screen.getAllByRole("option");
    expect(listed.length).toBeGreaterThanOrEqual(2);
    const picked = listed
      .slice(0, 2)
      .map((option) => parseItemKey(option.dataset.itemKey ?? "").id);
    const area = screen.getByTestId("drive-scroll-area");

    fireEvent.mouseDown(area, { clientX: 820, clientY: 10, button: 0 });
    fireEvent.mouseMove(window, { clientX: 700, clientY: 70 });
    fireEvent.mouseUp(window);
    fireEvent.click(area);
    expect(input).not.toHaveFocus();
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Delete",
    });

    for (const id of picked) {
      expect(getPresentationById(id)?.trashedAt).toBeTruthy();
    }
    expect(input).toHaveValue("예배");
  });
});

describe("AppShellLayout (터치)", () => {
  beforeEach(() => {
    signInAsTestUser();
    resetPresentationStore();
    resetFolderStore();
    window.localStorage.clear();
    __loadDocumentsForTests(SEED_PRESENTATIONS);
    vi.restoreAllMocks();
    dnd.started.length = 0;
  });

  afterEach(async () => {
    vi.useRealTimers();
    await new Promise((resolve) => setTimeout(resolve, 60));
  });

  function longPress(target: HTMLElement): void {
    fireEvent.touchStart(target, { touches: [{ clientX: 50, clientY: 50 }] });
    act(() => {
      vi.advanceTimersByTime(500);
    });
  }

  function touchRoll(target: HTMLElement): void {
    const touch = { isPrimary: true, pointerType: "touch", clientY: 100 };
    fireEvent.pointerDown(target, { ...touch, button: 0, clientX: 100 });
    fireEvent.pointerMove(document, { ...touch, clientX: 108 });
    fireEvent.pointerUp(document, { ...touch, clientX: 108 });
  }

  it("행을 길게 누르면 그 행의 메뉴가 열리고 행이 선택된다", () => {
    renderShell();
    vi.useFakeTimers();
    const row = card(SEED_PRESENTATIONS[0].title);

    longPress(row);

    const menu = screen.getByTestId("drive-menu");
    expect(within(menu).getByTestId("action-open")).toBeInTheDocument();
    expect(within(menu).getByTestId("action-trash")).toBeInTheDocument();
    expect(row).toHaveAttribute("aria-selected", "true");
  });

  it("앞서 우클릭으로 만든 메뉴가 아니라 길게 누른 행의 메뉴를 보여 준다", async () => {
    renderShell();
    const [first, second, third] = SEED_PRESENTATIONS;
    const [firstRow, secondRow, thirdRow] = [first, second, third].map((doc) =>
      card(doc.title),
    );
    fireEvent.click(firstRow);
    fireEvent.click(secondRow, { ctrlKey: true });
    fireEvent.contextMenu(firstRow);
    expect(screen.queryByTestId("action-open")).not.toBeInTheDocument();
    fireEvent.keyDown(await screen.findByTestId("drive-menu"), {
      key: "Escape",
    });
    await waitFor(() => expect(screen.queryByTestId("drive-menu")).toBeNull());

    vi.useFakeTimers();
    longPress(thirdRow);

    expect(
      within(screen.getByTestId("drive-menu")).getByTestId("action-open"),
    ).toBeInTheDocument();
    expect(thirdRow).toHaveAttribute("aria-selected", "true");
    expect(firstRow).toHaveAttribute("aria-selected", "false");
  });

  it("검색 결과의 빈 곳을 길게 눌러도 메뉴를 열지 않는다", () => {
    renderShell();
    fireEvent.change(screen.getByTestId("shell-search-input"), {
      target: { value: SEED_PRESENTATIONS[0].title },
    });
    vi.useFakeTimers();

    longPress(screen.getByTestId("drive-scroll-area"));

    expect(screen.queryByTestId("drive-menu")).not.toBeInTheDocument();
  });

  it("⋮ 메뉴 항목을 터치로 누를 때 손가락이 굴러도 끌기로 가로채이지 않고 항목이 실행된다", async () => {
    renderShell();
    const before = listPresentations().length;
    fireEvent.click(
      within(card(SEED_PRESENTATIONS[0].title)).getByTestId("item-more-btn"),
    );
    const duplicate = await screen.findByTestId("action-duplicate");

    touchRoll(duplicate);
    fireEvent.click(duplicate);

    expect(dnd.started).toEqual([]);
    expect(listPresentations()).toHaveLength(before + 1);
  });

  it("⋮ 메뉴 항목을 길게 눌러도 그 위에 새로 만들기 메뉴가 겹쳐 열리거나 행 선택이 풀리지 않는다", async () => {
    renderShell();
    const row = card(SEED_PRESENTATIONS[0].title);
    fireEvent.click(within(row).getByTestId("item-more-btn"));
    const duplicate = await screen.findByTestId("action-duplicate");
    vi.useFakeTimers();

    longPress(duplicate);

    expect(screen.getAllByTestId("drive-menu")).toHaveLength(1);
    expect(screen.queryByTestId("new-menu-folder")).not.toBeInTheDocument();
    expect(row).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("selection-bar")).toHaveTextContent("1개 선택됨");
  });

  it("행의 편집 버튼도 터치로 누를 때 손가락이 굴러도 눌린다", () => {
    renderShell();
    const edit = within(card(SEED_PRESENTATIONS[0].title)).getByTestId(
      "row-edit-btn",
    );

    touchRoll(edit);
    fireEvent.click(edit);

    expect(dnd.started).toEqual([]);
    expect(screen.getByTestId("editor-stub")).toBeInTheDocument();
  });

  it("행 본문에서 손가락이 굴러 시작한 끌기는 그대로 시작한다", () => {
    renderShell();
    const target = SEED_PRESENTATIONS[0];

    touchRoll(card(target.title));

    expect(dnd.started).toEqual([itemKey("file", target.id)]);
  });
});

describe("AppShellLayout (검색어)", () => {
  beforeEach(() => {
    signInAsTestUser();
    resetPresentationStore();
    resetFolderStore();
    window.localStorage.clear();
    __loadDocumentsForTests(SEED_PRESENTATIONS);
    vi.restoreAllMocks();
  });

  const searchInput = (): HTMLElement =>
    screen.getByTestId("shell-search-input");

  it("검색 결과에서 폴더를 열면 검색어를 비우고 그 폴더의 내용을 보여 준다", () => {
    __loadFoldersForTests([folder(WORSHIP, "주일 대예배")]);
    const inside = { ...SEED_PRESENTATIONS[0], folderId: WORSHIP };
    __loadDocumentsForTests([inside, ...SEED_PRESENTATIONS.slice(1)]);
    renderShell();
    fireEvent.change(searchInput(), { target: { value: "주일" } });
    expect(screen.getByTestId("drive-summary")).toHaveTextContent("검색 결과");

    act(() => {
      fireEvent.doubleClick(card("폴더 주일 대예배"));
    });

    expect(window.location.pathname).toBe(`/presentations/folders/${WORSHIP}`);
    expect(searchInput()).toHaveValue("");
    expect(screen.getByTestId("drive-summary")).not.toHaveTextContent(
      "검색 결과",
    );
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveAccessibleName(
      `${DRIVE_COPY.kind.file} ${inside.title}`,
    );
  });

  it("드라이브 안에서 위치가 바뀌면 검색어를 비우고 돌아와도 되살리지 않는다", () => {
    __loadFoldersForTests([folder(WORSHIP, "주일 대예배")]);
    renderShell();
    fireEvent.change(searchInput(), { target: { value: "예배" } });

    act(() => {
      testRouter.push(TRASH_PATH);
    });
    expect(searchInput()).toHaveValue("");

    act(() => {
      testRouter.push(DRIVE_ROOT_PATH);
    });
    expect(searchInput()).toHaveValue("");
    expect(screen.getByTestId("drive-summary")).not.toHaveTextContent(
      "검색 결과",
    );
  });

  it("배경 갤러리를 거쳐 드라이브의 다른 위치로 오면 이전 위치의 검색어를 되살리지 않는다", async () => {
    resetBackgroundCatalogForTests();
    const sunset = makeBackground(1, { title: "따뜻한 노을" });
    const api = installFakeApi({
      "GET /api/backgrounds": () => ({ body: { backgrounds: [sunset] } }),
    });
    try {
      __loadFoldersForTests([folder(WORSHIP, "주일 대예배")]);
      renderShell();
      fireEvent.change(searchInput(), { target: { value: "예배" } });
      fireEvent.click(screen.getByTestId("sidebar-nav-backgrounds"));
      await screen.findByRole("img", { name: sunset.title });

      act(() => {
        testRouter.push(`/presentations/folders/${WORSHIP}`);
      });

      expect(searchInput()).toHaveValue("");
      expect(screen.getByTestId("drive-summary")).not.toHaveTextContent(
        "검색 결과",
      );
    } finally {
      api.restore();
      resetBackgroundCatalogForTests();
    }
  });

  it("같은 위치에서 검색어를 바꾸는 동안에는 비우지 않는다", () => {
    renderShell();

    fireEvent.change(searchInput(), { target: { value: "예" } });
    fireEvent.change(searchInput(), { target: { value: "예배" } });

    expect(searchInput()).toHaveValue("예배");
    expect(screen.getByTestId("drive-summary")).toHaveTextContent("검색 결과");
  });

  it.each([
    [
      "더블클릭해",
      async (row: HTMLElement): Promise<void> => {
        act(() => {
          fireEvent.doubleClick(row);
        });
      },
    ],
    [
      "⋮ 메뉴로 열어",
      async (row: HTMLElement): Promise<void> => {
        fireEvent.click(within(row).getByTestId("item-more-btn"));
        fireEvent.click(await screen.findByTestId("action-open"));
      },
    ],
  ])(
    "검색 결과에서 지금 열린 폴더를 %s도 검색을 끝내고 그 폴더의 내용을 보여 준다",
    async (_, openRow) => {
      __loadFoldersForTests([folder(WORSHIP, "주일 대예배")]);
      const inside = { ...SEED_PRESENTATIONS[0], folderId: WORSHIP };
      __loadDocumentsForTests([inside, ...SEED_PRESENTATIONS.slice(1)]);
      renderShell(`/presentations/folders/${WORSHIP}`);
      fireEvent.change(searchInput(), { target: { value: "주일" } });
      expect(screen.getByTestId("drive-summary")).toHaveTextContent(
        "검색 결과",
      );

      await openRow(card("폴더 주일 대예배"));

      expect(window.location.pathname).toBe(
        `/presentations/folders/${WORSHIP}`,
      );
      expect(searchInput()).toHaveValue("");
      expect(screen.getByTestId("drive-summary")).not.toHaveTextContent(
        "검색 결과",
      );
      const options = screen.getAllByRole("option");
      expect(options).toHaveLength(1);
      expect(options[0]).toHaveAccessibleName(
        `${DRIVE_COPY.kind.file} ${inside.title}`,
      );
    },
  );

  it.each([
    ["내 드라이브", (): HTMLElement => screen.getByTestId("sidebar-nav-home")],
    [
      "앱 이름",
      (): HTMLElement =>
        screen.getByRole("button", { name: new RegExp(APP_NAME) }),
    ],
  ])(
    "루트에서 검색하는 중에 사이드바의 %s 버튼을 누르면 검색을 끝내고 루트의 내용을 보여 준다",
    (_, sidebarButton) => {
      renderShell();
      fireEvent.change(searchInput(), { target: { value: "주일" } });
      expect(screen.getByTestId("drive-summary")).toHaveTextContent(
        "검색 결과",
      );

      fireEvent.click(sidebarButton());

      expect(window.location.pathname).toBe(DRIVE_ROOT_PATH);
      expect(searchInput()).toHaveValue("");
      expect(screen.getByTestId("drive-summary")).not.toHaveTextContent(
        "검색 결과",
      );
      expect(screen.getByTestId("drive-trash-folder")).toBeInTheDocument();
    },
  );

  interface ShellCommit {
    input: string;
    summary: string;
    driveRendered: boolean;
  }

  function renderRecordingCommits(): ShellCommit[] {
    const commits: ShellCommit[] = [];
    let driveRendered = false;
    render(
      withQueryClient(
        <ThemeProvider>
          <React.Profiler
            id="shell"
            onRender={() => {
              commits.push({
                input:
                  screen.queryByTestId<HTMLInputElement>("shell-search-input")
                    ?.value ?? "",
                summary:
                  screen.queryByTestId("drive-summary")?.textContent ?? "",
                driveRendered,
              });
              driveRendered = false;
            }}
          >
            <MemoryRouter initialEntries={[DRIVE_ROOT_PATH]}>
              <Routes>
                <Route layout={AppShellLayout}>
                  <Route
                    path={DRIVE_ROOT_PATH}
                    element={
                      <React.Profiler
                        id="drive"
                        onRender={() => {
                          driveRendered = true;
                        }}
                      >
                        <PresentationsRoute />
                      </React.Profiler>
                    }
                  />
                </Route>
              </Routes>
            </MemoryRouter>
          </React.Profiler>
        </ThemeProvider>,
      ),
    );
    commits.length = 0;
    return commits;
  }

  it("검색어를 치면 입력창을 먼저 고치고, 그 커밋에서는 드라이브 목록을 다시 그리지 않는다", () => {
    const commits = renderRecordingCommits();

    fireEvent.change(searchInput(), { target: { value: "주일" } });

    const typed = commits.find((commit) => commit.input === "주일");
    expect(typed).toMatchObject({ driveRendered: false });
    expect(screen.getByTestId("drive-summary")).toHaveTextContent("검색 결과");
  });

  it("검색어를 지우면 늦은 검색 결과를 한 번 더 그리지 않고 곧바로 폴더 내용을 보여 준다", () => {
    const commits = renderRecordingCommits();
    fireEvent.change(searchInput(), { target: { value: "주일" } });
    commits.length = 0;

    fireEvent.change(searchInput(), { target: { value: "  " } });

    expect(commits.length).toBeGreaterThan(0);
    expect(commits.some((commit) => commit.summary.includes("검색 결과"))).toBe(
      false,
    );
  });
});

describe("AppShellLayout (빈 곳과 휴지통 폴더의 메뉴)", () => {
  beforeEach(() => {
    signInAsTestUser();
    resetPresentationStore();
    resetFolderStore();
    window.localStorage.clear();
    __loadDocumentsForTests(SEED_PRESENTATIONS);
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await new Promise((resolve) => setTimeout(resolve, 60));
  });

  function longPress(target: HTMLElement): void {
    vi.useFakeTimers();
    fireEvent.touchStart(target, { touches: [{ clientX: 50, clientY: 50 }] });
    act(() => {
      vi.advanceTimersByTime(500);
    });
  }

  const openers = [
    [
      "우클릭으로",
      (target: HTMLElement): void => {
        fireEvent.contextMenu(target);
      },
    ],
    ["길게 눌러", longPress],
  ] as const;

  it.each(openers)(
    "루트의 빈 곳에서 %s 연 메뉴는 선택을 풀고 새로 만들기 항목을 보여 준다",
    (_, openMenu) => {
      renderShell();
      fireEvent.click(card(SEED_PRESENTATIONS[0].title));
      expect(screen.getByTestId("selection-bar")).toHaveTextContent(
        "1개 선택됨",
      );

      openMenu(screen.getByTestId("drive-scroll-area"));

      const menu = screen.getByTestId("drive-menu");
      expect(within(menu).getByTestId("new-menu-folder")).toBeInTheDocument();
      expect(within(menu).queryByTestId("action-open")).toBeNull();
      expect(screen.queryByTestId("selection-bar")).not.toBeInTheDocument();
    },
  );

  it.each(openers)(
    "휴지통의 빈 곳에서는 %s도 메뉴를 열지 않는다",
    (_, openMenu) => {
      __loadDocumentsForTests([
        { ...SEED_PRESENTATIONS[0], trashedAt: "2026-09-20T12:00:00.000Z" },
        ...SEED_PRESENTATIONS.slice(1),
      ]);
      renderShell(TRASH_PATH);
      expect(card(SEED_PRESENTATIONS[0].title)).toBeInTheDocument();

      openMenu(screen.getByTestId("drive-scroll-area"));

      expect(screen.queryByTestId("drive-menu")).not.toBeInTheDocument();
    },
  );

  it("고정된 휴지통 폴더를 길게 누르면 열기·비우기 메뉴를 보여 준다", () => {
    __loadDocumentsForTests([
      { ...SEED_PRESENTATIONS[0], trashedAt: "2026-09-20T12:00:00.000Z" },
      ...SEED_PRESENTATIONS.slice(1),
    ]);
    renderShell();

    longPress(screen.getByTestId("drive-trash-folder"));

    const menu = screen.getByTestId("drive-menu");
    expect(within(menu).getByTestId("action-open")).toBeInTheDocument();
    expect(within(menu).getByTestId("action-empty-trash")).toBeEnabled();
    expect(within(menu).queryByTestId("new-menu-folder")).toBeNull();
  });
});

describe("AppShellLayout (안내 배너)", () => {
  beforeEach(() => {
    signInAsTestUser();
    resetPresentationStore();
    resetFolderStore();
    window.localStorage.clear();
    __loadDocumentsForTests(SEED_PRESENTATIONS);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("약관이 바뀌기 전에는 드라이브 위에 바뀐다는 안내를 띄우고, 시행일부터는 띄우지 않는다", () => {
    const effectiveAt = new Date(`${LEGAL_EFFECTIVE_DATE}T00:00:00+09:00`);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(effectiveAt.getTime() - 12 * 60 * 60_000));
    const { unmount } = renderShell();

    expect(screen.getByTestId("legal-change-notice")).toHaveTextContent(
      LEGAL_COPY.change.title(LEGAL_EFFECTIVE_DATE),
    );
    unmount();

    vi.setSystemTime(effectiveAt);
    renderShell();

    expect(screen.queryByTestId("legal-change-notice")).toBeNull();
  });
});
