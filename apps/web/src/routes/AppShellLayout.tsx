import React, { useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import type { Deck } from "@repo/shared";
import { ChromeAlertBanner } from "../components/common/ChromeAlertBanner";
import { StorageWarningBanner } from "../components/common/StorageWarningBanner";
import { AppSidebar } from "../components/layout/AppSidebar";
import { AppHeroHeader } from "../components/layout/AppHeroHeader";
import { QuickLyricPasteModal } from "../features/editor";
import {
  addDeckToPresentation,
  createNewPresentation,
  usePresentationList,
} from "../features/presentation";
import type {
  AppShellContextValue,
  SortOrder,
  ViewMode,
} from "./appShellContext";

interface ShellPageMeta {
  title: string;
  placeholder: string;
}

const SHELL_PAGE_META: Record<string, ShellPageMeta> = {
  "/presentations": {
    title: "모든 프로젝트",
    placeholder: "디자인, 폴더, 찬양 가사, 곡을 검색해 보세요",
  },
  "/backgrounds": {
    title: "배경 라이브러리",
    placeholder: "배경 영상, 이미지, 분위기 태그를 검색해 보세요",
  },
};

/**
 * `/presentations`, `/lyrics`, `/backgrounds` 가 공유하는 애플리케이션 셸 레이아웃
 * - 좌측 `AppSidebar`, 상단 `AppHeroHeader`, 본문 `<Outlet/>`
 * - 검색/뷰모드/정렬 상태와 가사 빠른 입력 모달을 소유하고 컨텍스트로 내려준다
 *   (툴바의 + 버튼과 곡 라이브러리의 버튼이 같은 모달을 열기 때문에 소유자는 하나여야 한다)
 */
export function AppShellLayout(): React.JSX.Element {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const presentations = usePresentationList();

  const [isQuickPasteOpen, setIsQuickPasteOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortOrder, setSortOrder] = useState<SortOrder>("recent");

  const meta = SHELL_PAGE_META[pathname] ?? SHELL_PAGE_META["/presentations"];

  const handleCreateNewPresentation = (): void => {
    const created = createNewPresentation("새 주일 예배 프레젠테이션");
    navigate(`/editor/${created.id}`);
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
      <AppSidebar onCreateNewPresentation={handleCreateNewPresentation} />

      <div className="flex-1 h-full flex flex-col min-w-0 overflow-y-auto overflow-x-hidden">
        {/* Chrome 권장 안내 배너 */}
        <ChromeAlertBanner />

        {/* 저장 실패 경고 (닫을 수 없음) */}
        <StorageWarningBanner />

        <AppHeroHeader
          title={meta.title}
          searchPlaceholder={meta.placeholder}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          sortOrder={sortOrder}
          onSortOrderChange={setSortOrder}
          itemCountLabel={
            pathname === "/presentations"
              ? `${presentations.length}개 프로젝트`
              : ""
          }
          onQuickAdd={handleCreateNewPresentation}
        />

        {/* ── 메인 본문 영역 ── */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-6 sm:px-8 py-6">
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
