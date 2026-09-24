import React from "react";
import {
  __loadDocumentsForTests,
  SEED_PRESENTATIONS,
  resetPresentationStore,
  listPresentations,
  getPresentationById,
} from "../features/presentation";
import {
  __loadFoldersForTests,
  getFolders,
  resetFolderStore,
} from "../features/drive";
import { signInAsTestUser } from "../test/sessionFixture";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { Folder } from "#shared";
import { SEED_USER_ID } from "../features/presentation";
import { AppShellLayout } from "./AppShellLayout";
import { PresentationsRoute } from "./PresentationsRoute";
import { TrashRoute } from "./TrashRoute";
import { LyricsRoute } from "./LyricsRoute";
import { BackgroundsRoute } from "./BackgroundsRoute";
import * as chromeChecker from "../components/common/ChromeAlertBanner";
import { withQueryClient } from "../test/queryClientFixture";

function renderShell(initialPath = "/presentations") {
  return render(
    withQueryClient(
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route element={<AppShellLayout />}>
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
      </MemoryRouter>,
    ),
  );
}

const WORSHIP = "a00000000000000000001";
const YOUTH = "b00000000000000000002";

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

    expect(screen.getByText("Worship Studio")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "내 드라이브" }),
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

    expect(screen.getByText("23 슬라이드")).toBeInTheDocument();
    expect(screen.getAllByText("5곡 세트").length).toBeGreaterThan(0);
  });

  it("카드의 발표 버튼은 Chrome에서 곧바로 전체화면 송출로 간다", () => {
    vi.spyOn(chromeChecker, "isGoogleChromeBrowser").mockReturnValue(true);
    renderShell();

    fireEvent.click(screen.getAllByTestId("card-present-btn")[0]);
    expect(screen.getByTestId("fullscreen-stub")).toBeInTheDocument();
  });

  it("Chrome이 아니면 발표 전에 확인을 받는다", () => {
    vi.spyOn(chromeChecker, "isGoogleChromeBrowser").mockReturnValue(false);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderShell();

    const startBtn = screen.getAllByTestId("card-present-btn")[0];
    fireEvent.click(startBtn);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("fullscreen-stub")).not.toBeInTheDocument();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(startBtn);
    expect(screen.getByTestId("fullscreen-stub")).toBeInTheDocument();
  });

  it("사이드바: 내 드라이브·휴지통·배경 라이브러리, aria-current", () => {
    renderShell();

    expect(screen.getByTestId("sidebar-nav-home")).toHaveAttribute(
      "aria-current",
      "page",
    );

    fireEvent.click(screen.getByTestId("sidebar-nav-backgrounds"));
    expect(screen.getByText("내가 올린 배경")).toBeInTheDocument();
    expect(screen.queryByText("유형: 전체")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "배경 라이브러리" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-nav-home")).not.toHaveAttribute(
      "aria-current",
    );

    fireEvent.click(screen.getByTestId("sidebar-nav-trash"));
    expect(screen.getByRole("heading", { name: "휴지통" })).toBeInTheDocument();
    expect(screen.getByText("휴지통이 비어 있습니다")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("sidebar-nav-home"));
    expect(screen.getAllByTestId("presentation-card")).toHaveLength(5);
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

    fireEvent.click(screen.getByTestId("drive-view"));
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
    expect(screen.queryAllByTestId("presentation-card")).toHaveLength(0);
    expect(screen.getByTestId(`crumb-${WORSHIP}`)).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      within(screen.getByTestId("sidebar-folder-tree")).getByText(
        "2026 주일 대예배",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("crumb-root"));
    expect(screen.getAllByTestId("presentation-card")).toHaveLength(5);
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
    ).toHaveTextContent("같은 위치에 같은 이름의 폴더가 있습니다");
    expect(screen.getByTestId("drive-name-confirm")).toBeDisabled();

    fireEvent.change(input, { target: { value: "성탄절" } });
    fireEvent.click(screen.getByTestId("drive-name-confirm"));

    expect(
      getFolders()
        .map((f) => f.name)
        .sort(),
    ).toEqual(["새 폴더", "성탄절"]);
    expect(card("폴더 성탄절")).toHaveAttribute("aria-selected", "true");
  });

  it("우클릭 메뉴 → 이동으로 다른 폴더에 옮기고, 실행취소로 되돌린다", () => {
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
    expect(screen.getByTestId("drive-toast")).toHaveTextContent(
      "‘2026 주일 대예배’로 옮겼습니다",
    );

    fireEvent.click(screen.getByTestId("drive-toast-action"));
    expect(getPresentationById(target.id)?.folderId ?? null).toBeNull();
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
    expect(screen.getAllByTestId("presentation-card")).toHaveLength(4);

    fireEvent.click(screen.getByTestId("sidebar-nav-trash"));
    const trashed = card(target.title);
    fireEvent.contextMenu(trashed);
    fireEvent.click(screen.getByTestId("action-restore"));

    expect(getPresentationById(target.id)?.trashedAt).toBeNull();
    expect(screen.getByText("휴지통이 비어 있습니다")).toBeInTheDocument();
  });

  it("폴더를 휴지통에 넣으면 안의 세트도 함께 가려진다", () => {
    __loadFoldersForTests([folder(WORSHIP, "2026 주일 대예배")]);
    const inside = { ...SEED_PRESENTATIONS[0], folderId: WORSHIP };
    __loadDocumentsForTests([inside, ...SEED_PRESENTATIONS.slice(1)]);
    renderShell();

    fireEvent.contextMenu(card("폴더 2026 주일 대예배"));
    fireEvent.click(screen.getByTestId("action-trash"));

    fireEvent.click(screen.getByTestId("sidebar-nav-trash"));
    expect(screen.getAllByRole("option")).toHaveLength(1);

    fireEvent.click(screen.getByTestId("sidebar-nav-home"));
    fireEvent.change(
      screen.getByPlaceholderText(/폴더, 프레젠테이션, 찬양 가사/),
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
      screen.getByPlaceholderText(/폴더, 프레젠테이션, 찬양 가사/),
      { target: { value: inside.title } },
    );

    const result = card(inside.title);
    expect(result).toHaveTextContent("내 드라이브 › 2026 주일 대예배");
    expect(screen.getByTestId("drive-summary")).toHaveTextContent("검색 결과");
  });

  it("없거나 휴지통에 있는 폴더 주소는 루트로 보낸다", () => {
    renderShell("/presentations/folders/c00000000000000000009");
    expect(screen.getByTestId(`crumb-root`)).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getAllByTestId("presentation-card")).toHaveLength(5);
  });

  it("사이드바 테마 메뉴", () => {
    renderShell();

    const themeBtn = screen.getByTestId("theme-menu-button");
    fireEvent.click(themeBtn);
    expect(screen.getByTestId("theme-menu-dropdown")).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByTestId("theme-option-light"));
    });
    expect(screen.queryByTestId("theme-menu-dropdown")).not.toBeInTheDocument();
    expect(screen.getByText("라이트 모드")).toBeInTheDocument();
  });
});
