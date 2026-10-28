"use client";

import React, { useDeferredValue, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { SidebarInset, SidebarProvider } from "#components/ui/sidebar";
import { TooltipProvider } from "#components/ui/tooltip";
import { BrowserSupportBanner } from "../components/common/BrowserSupportBanner";
import { LegalChangeNotice } from "../components/common/LegalChangeNotice";
import { StoragePersistenceNotice } from "../components/common/StoragePersistenceNotice";
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
  useDriveSearchQuery,
  useFolderIndex,
} from "../features/drive";
import { AppShellContext, type AppShellContextValue } from "./appShellContext";
import { BACKGROUND_COPY } from "#copy/backgrounds";
import { SHELL_COPY } from "#copy/shell";
import { COMMON_COPY } from "#copy/common";

const MAIN_CONTENT_ID = "main-content";

interface ShellPageMeta {
  title: string;
  placeholder: string | readonly string[];
  compactPlaceholder?: string;
}

const TRASH_META: ShellPageMeta = {
  title: COMMON_COPY.trash,
  placeholder: SHELL_COPY.searchPlaceholder.trash,
};
const DRIVE_META: ShellPageMeta = {
  title: COMMON_COPY.myDrive,
  placeholder: SHELL_COPY.searchPlaceholder.drive,
  compactPlaceholder: SHELL_COPY.searchPlaceholder.driveCompact,
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
 *
 * 드라이브·휴지통 화면에는 검색어를 늦춰 넘긴다(`useDeferredValue`). 화면은 `children`으로
 * 들어오므로 입력창을 고치는 커밋에서는 다시 그려지지 않아, 곡이 많아도 글자마다 찾고 수백 행을
 * 다시 그리는 일이 입력을 붙잡지 않는다. 검색어를 지울 때는 늦추지 않는다. 늦추면 다른 위치로
 * 옮겨 가거나 검색을 끝낸 뒤에 옛 검색 결과가 한 번 더 비친다.
 */
export function AppShellLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <TooltipProvider>
      <DriveProvider>
        <AppShellFrame>{children}</AppShellFrame>
      </DriveProvider>
    </TooltipProvider>
  );
}

function AppShellFrame({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const pathname = usePathname();
  const drive = useDrive();
  const onDrive = isDrivePath(pathname);

  const searchQuery = useDriveSearchQuery();
  const deferredSearch = useDeferredValue(searchQuery);
  const [backgroundDraft, setBackgroundDraft] = useState<string>("");
  const [backgroundQuery, setBackgroundQuery] = useState<string>("");

  const meta = metaFor(pathname);
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
        onSearchQueryChange: drive.setSearchQuery,
      };

  const driveQuery = searchQuery.trim() === "" ? "" : deferredSearch;
  const routeQuery = onBackgrounds ? backgroundQuery : driveQuery;
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
        <StoragePersistenceNotice />
        <LegalChangeNotice />

        <AppHeader
          title={pageTitle}
          searchPlaceholder={meta.placeholder}
          compactSearchPlaceholder={meta.compactPlaceholder}
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

        <AppShellContext.Provider value={context}>
          {onDrive ? (
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:px-6">
              {children}
            </div>
          )}
        </AppShellContext.Provider>
      </SidebarInset>
    </SidebarProvider>
  );
}
