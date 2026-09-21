import { useOutletContext } from "react-router-dom";
import type { Deck } from "@repo/shared";

export type ViewMode = "grid" | "list";
export type SortOrder = "recent" | "name" | "slides";

/**
 * `AppShellLayout`이 `<Outlet context>`로 자식 라우트에 내려주는 값.
 * 히어로 검색/툴바는 셸이 소유하고, 본문 라우트는 그 결과만 읽는다.
 */
export interface AppShellContextValue {
  /** 히어로 검색창 입력값 */
  searchQuery: string;
  viewMode: ViewMode;
  sortOrder: SortOrder;
  /** 가사 빠른 입력 모달 열기 (툴바 + 버튼 / 곡 라이브러리 버튼 공용) */
  onOpenQuickPaste: () => void;
  /** 새 프레젠테이션을 만들고 /editor/:presentationId 로 이동 */
  onCreateNewPresentation: () => void;
  /** 활성 프레젠테이션에 덱 추가 */
  onAddDeckToPresentation: (deck: Deck) => void;
}

/** 자식 라우트에서 셸 컨텍스트를 타입 안전하게 읽는 훅 */
export function useAppShell(): AppShellContextValue {
  return useOutletContext<AppShellContextValue>();
}
