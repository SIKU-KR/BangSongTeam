import React, { useMemo, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { SidebarInset, SidebarProvider } from "#components/ui/sidebar";
import { Toaster } from "#components/ui/sonner";
import { TooltipProvider } from "#components/ui/tooltip";
import { BrowserSupportBanner } from "../components/common/BrowserSupportBanner";
import { StorageWarningBanner } from "../components/common/StorageWarningBanner";
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
import { BACKGROUND_COPY } from "#copy/backgrounds";
import { SHELL_COPY } from "#copy/shell";
import { COMMON_COPY } from "#copy/common";

const MAIN_CONTENT_ID = "main-content";

interface ShellPageMeta {
  title: string;
  placeholder: string | readonly string[];
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
  placeholder: BACKGROUND_COPY.searchPlaceholders,
};

function metaFor(pathname: string): ShellPageMeta {
  if (pathname === TRASH_PATH) return TRASH_META;
  if (pathname.startsWith("/backgrounds")) return BACKGROUNDS_META;
  return DRIVE_META;
}

/**
 * 사이드바, 헤더 및 공통 툴바를 제공하는 셸 레이아웃.
 * 툴팁 Provider는 Base UI 툴팁이 메인 청크에 들어가지 않도록 앱 루트 대신 여기에 둔다.
 *
 * 배경 갤러리의 헤더 검색어는 드라이브·휴지통 검색어와 따로 둔다. 배경 검색은 검색어마다
 * 서버 벡터 검색을 부르므로, 드라이브에서 친 검색어가 넘어가 요청이 나가지 않게 하고
 * 제출한 검색어만 갤러리에 넘긴다.
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
  const [backgroundDraft, setBackgroundDraft] = useState<string>("");
  const [backgroundQuery, setBackgroundQuery] = useState<string>("");

  const meta = metaFor(pathname);
  const onDrive = isDrivePath(pathname);
  const onTrash = drive.isTrashView;
  const onBackgrounds = pathname.startsWith("/backgrounds");
  useFolderIndex();
  const pageTitle =
    onDrive && !onTrash && drive.currentFolderId
      ? (getFolder(drive.currentFolderId)?.name ?? COMMON_COPY.myDrive)
      : meta.title;

  const search: Pick<
    React.ComponentProps<typeof AppHeader>,
    "searchQuery" | "onSearchQueryChange" | "onSearchSubmit"
  > = onBackgrounds
    ? {
        searchQuery: backgroundDraft,
        onSearchQueryChange: (value) => {
          setBackgroundDraft(value);
          if (value.trim() === "") setBackgroundQuery("");
        },
        onSearchSubmit: () => setBackgroundQuery(backgroundDraft.trim()),
      }
    : {
        searchQuery,
        onSearchQueryChange: setSearchQuery,
      };

  const routeQuery = onBackgrounds ? backgroundQuery : searchQuery;
  const context = useMemo<AppShellContextValue>(
    () => ({ searchQuery: routeQuery }),
    [routeQuery],
  );

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

        <AppHeader
          title={pageTitle}
          searchPlaceholder={meta.placeholder}
          {...search}
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
