import React, { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import type { Deck } from "#shared";
import { ChromeAlertBanner } from "../components/common/ChromeAlertBanner";
import { StorageWarningBanner } from "../components/common/StorageWarningBanner";
import { AppUpdateBanner } from "../components/common/AppUpdateBanner";
import { AppSidebar } from "../components/layout/AppSidebar";
import { AppHeader } from "../components/layout/AppHeader";
import { QuickLyricPasteModal } from "../features/editor";
import { addDeckToPresentation } from "../features/presentation";
import {
  DEFAULT_SORT_ORDER,
  DriveBreadcrumbs,
  DriveProvider,
  NewMenuButton,
  ROOT_LABEL,
  getFolder,
  useDrive,
  useFolderIndex,
} from "../features/drive";
import type {
  AppShellContextValue,
  DriveTypeFilter,
  SortOrder,
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
  title: "배경 갤러리",
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

/** 사이드바, 헤더 및 공통 툴바를 제공하는 셸 레이아웃 */
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
  const [sortOrder, setSortOrder] = useState<SortOrder>(DEFAULT_SORT_ORDER);
  const [typeFilter, setTypeFilter] = useState<DriveTypeFilter>("all");

  const meta = metaFor(pathname);
  const onDrive = isDrivePath(pathname);
  const onTrash = pathname === "/presentations/trash";
  useFolderIndex();
  const pageTitle =
    onDrive && !onTrash && drive.currentFolderId
      ? (getFolder(drive.currentFolderId)?.name ?? ROOT_LABEL)
      : meta.title;

  const handleCreateNewPresentation = (): void => {
    drive.createPresentationIn(drive.currentFolderId);
  };

  const handleAddDeckToPresentation = (newDeck: Deck): void => {
    addDeckToPresentation(newDeck);
    setIsQuickPasteOpen(false);
  };

  const context: AppShellContextValue = {
    searchQuery,
    sortOrder,
    typeFilter,
    onSortOrderChange: setSortOrder,
    onTypeFilterChange: setTypeFilter,
    onOpenQuickPaste: () => setIsQuickPasteOpen(true),
    onCreateNewPresentation: handleCreateNewPresentation,
    onAddDeckToPresentation: handleAddDeckToPresentation,
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <AppSidebar />

      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <ChromeAlertBanner />
        <StorageWarningBanner />
        <AppUpdateBanner />

        <AppHeader
          title={pageTitle}
          searchPlaceholder={meta.placeholder}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          titleSlot={onDrive ? <DriveBreadcrumbs /> : undefined}
          actions={
            onDrive ? (
              <div className="lg:hidden">
                <NewMenuButton variant="fab" testId="toolbar-new-btn" />
              </div>
            ) : undefined
          }
        />

        {onDrive ? (
          <main className="flex min-h-0 flex-1 flex-col">
            <Outlet context={context} />
          </main>
        ) : (
          <main className="min-h-0 flex-1 overflow-y-auto">
            <div className="p-4 sm:px-6">
              <Outlet context={context} />
            </div>
          </main>
        )}
      </div>

      <QuickLyricPasteModal
        isOpen={isQuickPasteOpen}
        onClose={() => setIsQuickPasteOpen(false)}
        onAddToSet={handleAddDeckToPresentation}
      />
    </div>
  );
}
