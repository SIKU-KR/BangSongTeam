import React, { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { SidebarInset, SidebarProvider } from "#components/ui/sidebar";
import { Toaster } from "#components/ui/sonner";
import { TooltipProvider } from "#components/ui/tooltip";
import type { Deck } from "#shared";
import { BrowserSupportBanner } from "../components/common/BrowserSupportBanner";
import { StorageWarningBanner } from "../components/common/StorageWarningBanner";
import { AppUpdateBanner } from "../components/common/AppUpdateBanner";
import { AppSidebar } from "../components/layout/AppSidebar";
import { AppHeader } from "../components/layout/AppHeader";
import { QuickLyricPasteModal } from "../features/editor/QuickLyricPasteModal";
import { addDeckToPresentation } from "../features/presentation";
import {
  DEFAULT_SORT_ORDER,
  DriveBreadcrumbs,
  DriveProvider,
  NewMenuButton,
  getFolder,
  useDrive,
  useFolderIndex,
} from "../features/drive";
import type {
  AppShellContextValue,
  DriveTypeFilter,
  SortOrder,
} from "./appShellContext";
import { SHELL_COPY } from "#copy/shell";
import { COMMON_COPY } from "#copy/common";

interface ShellPageMeta {
  title: string;
  placeholder: string;
}

const TRASH_META: ShellPageMeta = {
  title: COMMON_COPY.trash,
  placeholder: SHELL_COPY.searchPlaceholder.trash,
};
const DRIVE_META: ShellPageMeta = {
  title: COMMON_COPY.myDrive,
  placeholder: SHELL_COPY.searchPlaceholder.drive,
};
const BACKGROUNDS_META: ShellPageMeta = {
  title: SHELL_COPY.backgroundGallery,
  placeholder: SHELL_COPY.searchPlaceholder.backgrounds,
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
 * 사이드바, 헤더 및 공통 툴바를 제공하는 셸 레이아웃.
 * 툴팁 Provider는 Base UI 툴팁이 메인 청크에 들어가지 않도록 앱 루트 대신 여기에 둔다.
 */
export function AppShellLayout(): React.JSX.Element {
  return (
    <TooltipProvider>
      <DriveProvider>
        <AppShellFrame />
      </DriveProvider>
    </TooltipProvider>
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
      ? (getFolder(drive.currentFolderId)?.name ?? COMMON_COPY.myDrive)
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
    <SidebarProvider className="h-svh overflow-hidden">
      <AppSidebar />

      <SidebarInset className="min-w-0 overflow-hidden">
        <BrowserSupportBanner />
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
              <div className="md:hidden">
                <NewMenuButton variant="fab" testId="toolbar-new-btn" />
              </div>
            ) : undefined
          }
        />

        {onDrive ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <Outlet context={context} />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:px-6">
            <Outlet context={context} />
          </div>
        )}
      </SidebarInset>

      <Toaster position="bottom-left" />

      <QuickLyricPasteModal
        isOpen={isQuickPasteOpen}
        onClose={() => setIsQuickPasteOpen(false)}
        onAddToSet={handleAddDeckToPresentation}
      />
    </SidebarProvider>
  );
}
