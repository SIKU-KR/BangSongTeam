import React, { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import type { Deck } from "@repo/shared";
import { ChromeAlertBanner } from "../components/common/ChromeAlertBanner";
import { StorageWarningBanner } from "../components/common/StorageWarningBanner";
import { AppUpdateBanner } from "../components/common/AppUpdateBanner";
import { AppSidebar } from "../components/layout/AppSidebar";
import { AppHeroHeader } from "../components/layout/AppHeroHeader";
import { QuickLyricPasteModal } from "../features/editor";
import { addDeckToPresentation } from "../features/presentation";
import {
  DriveBreadcrumbs,
  DriveProvider,
  NewMenuButton,
  useDrive,
} from "../features/drive";
import type {
  AppShellContextValue,
  SortOrder,
  ViewMode,
} from "./appShellContext";

interface ShellPageMeta {
  title: string;
  placeholder: string;
}

const TRASH_META: ShellPageMeta = {
  title: "휴지통",
  placeholder: "휴지통에서 폴더, 프레젠테이션을 검색해 보세요",
};
const DRIVE_META: ShellPageMeta = {
  title: "내 드라이브",
  placeholder: "폴더, 프레젠테이션, 찬양 가사, 곡을 검색해 보세요",
};
const BACKGROUNDS_META: ShellPageMeta = {
  title: "배경 라이브러리",
  placeholder: "배경 영상, 이미지, 분위기 태그를 검색해 보세요",
};

function metaFor(pathname: string): ShellPageMeta {
  if (pathname === "/presentations/trash") return TRASH_META;
  if (pathname.startsWith("/backgrounds")) return BACKGROUNDS_META;
  return DRIVE_META;
}

function isDrivePath(pathname: string): boolean {
  return (
    pathname === "/presentations" || pathname.startsWith("/presentations/")
  );
}

/**
 * `/presentations`(드라이브), `/lyrics`, `/backgrounds` 가 공유하는 애플리케이션 셸 레이아웃
 * - 좌측 `AppSidebar`(폴더 트리), 상단 `AppHeroHeader`(경로·툴바), 본문 `<Outlet/>`
 * - 검색/뷰모드/정렬 상태와 가사 빠른 입력 모달을 소유하고 컨텍스트로 내려준다
 * - `DriveProvider`가 셸 전체를 감싼다. 사이드바 트리·경로·본문 그리드가 같은
 *   선택·드래그 상태를 공유해야 하기 때문이다.
 */
export function AppShellLayout(): React.JSX.Element {
  return (
    <DriveProvider>
      <AppShellFrame />
    </DriveProvider>
  );
}

function AppShellFrame(): React.JSX.Element {
  const { pathname } = useLocation();
  const drive = useDrive();

  const [isQuickPasteOpen, setIsQuickPasteOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortOrder, setSortOrder] = useState<SortOrder>("recent");

  const meta = metaFor(pathname);
  const onDrive = isDrivePath(pathname);
  const onTrash = pathname === "/presentations/trash";

  // 지금 보고 있는 폴더에 만든다 (드라이브 밖에서는 루트)
  const handleCreateNewPresentation = (): void => {
    drive.createPresentationIn(drive.currentFolderId);
  };

  const handleAddDeckToPresentation = (newDeck: Deck): void => {
    addDeckToPresentation(newDeck);
    setIsQuickPasteOpen(false);
  };

  // 명시적 타입 주석으로 필드 누락이 구조적 타이핑에 묻히지 않게 한다
  const context: AppShellContextValue = {
    searchQuery,
    viewMode,
    sortOrder,
    onOpenQuickPaste: () => setIsQuickPasteOpen(true),
    onCreateNewPresentation: handleCreateNewPresentation,
    onAddDeckToPresentation: handleAddDeckToPresentation,
  };

  return (
    <div className="h-screen w-full bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 flex overflow-hidden">
      <AppSidebar />

      <div className="flex-1 h-full flex flex-col min-w-0 overflow-y-auto overflow-x-hidden">
        {/* Chrome 권장 안내 배너 */}
        <ChromeAlertBanner />

        {/* 저장 실패 경고 (닫을 수 없음) */}
        <StorageWarningBanner />
        <AppUpdateBanner />

        <AppHeroHeader
          title={meta.title}
          searchPlaceholder={meta.placeholder}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          sortOrder={sortOrder}
          onSortOrderChange={setSortOrder}
          itemCountLabel=""
          toolbarStart={
            onTrash ? (
              <span className="px-2 text-base font-bold tracking-tight text-zinc-900 dark:text-white">
                휴지통
              </span>
            ) : onDrive ? (
              <DriveBreadcrumbs />
            ) : undefined
          }
          quickAddSlot={
            onDrive ? (
              <NewMenuButton variant="fab" testId="toolbar-new-btn" />
            ) : undefined
          }
          onQuickAdd={handleCreateNewPresentation}
        />

        {/* ── 메인 본문 영역 ── */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-6 sm:px-8 py-4">
          <Outlet context={context} />
        </main>
      </div>

      {/* 가사 빠른 입력 모달 */}
      <QuickLyricPasteModal
        isOpen={isQuickPasteOpen}
        onClose={() => setIsQuickPasteOpen(false)}
        onAddToSet={handleAddDeckToPresentation}
      />
    </div>
  );
}
