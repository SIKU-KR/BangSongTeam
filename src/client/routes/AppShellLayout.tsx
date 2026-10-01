import React, { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { SidebarInset, SidebarProvider } from "#components/ui/sidebar";
import { Toaster } from "#components/ui/sonner";
import { TooltipProvider } from "#components/ui/tooltip";
import { BrowserSupportBanner } from "../components/common/BrowserSupportBanner";
import { StorageWarningBanner } from "../components/common/StorageWarningBanner";
import { AppUpdateBanner } from "../components/common/AppUpdateBanner";
import { AppSidebar } from "../components/layout/AppSidebar";
import { AppHeader } from "../components/layout/AppHeader";
import {
  DriveBreadcrumbs,
  DriveProvider,
  NewMenuButton,
  TRASH_PATH,
  getFolder,
  isDrivePath,
  useDrive,
  useFolderIndex,
} from "../features/drive";
import type { AppShellContextValue } from "./appShellContext";
import { SHELL_COPY } from "#copy/shell";
import { COMMON_COPY } from "#copy/common";

const MAIN_CONTENT_ID = "main-content";

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
  if (pathname === TRASH_PATH) return TRASH_META;
  if (pathname.startsWith("/backgrounds")) return BACKGROUNDS_META;
  return DRIVE_META;
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

  const [searchQuery, setSearchQuery] = useState<string>("");

  const meta = metaFor(pathname);
  const onDrive = isDrivePath(pathname);
  const onTrash = drive.isTrashView;
  useFolderIndex();
  const pageTitle =
    onDrive && !onTrash && drive.currentFolderId
      ? (getFolder(drive.currentFolderId)?.name ?? COMMON_COPY.myDrive)
      : meta.title;

  const context: AppShellContextValue = { searchQuery };

  return (
    <SidebarProvider className="h-svh overflow-hidden">
      <a
        href={`#${MAIN_CONTENT_ID}`}
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:ring-3 focus:ring-ring/50 focus:outline-none"
      >
        {SHELL_COPY.skipToContent}
      </a>

      <AppSidebar />

      <SidebarInset
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="min-w-0 overflow-hidden outline-none"
      >
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
    </SidebarProvider>
  );
}
