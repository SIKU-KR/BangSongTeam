import { useOutletContext } from "react-router-dom";
import type { Deck } from "#shared";

export type SortOrder = "recent" | "name" | "slides";

/** 드라이브 목록의 유형 필터. `file`은 프레젠테이션이다 */
export type DriveTypeFilter = "all" | "folder" | "file";

/** `AppShellLayout`이 `<Outlet context>`로 자식 라우트에 내려주는 값 */
export interface AppShellContextValue {
  searchQuery: string;
  sortOrder: SortOrder;
  typeFilter: DriveTypeFilter;
  onOpenQuickPaste: () => void;
  onCreateNewPresentation: () => void;
  onAddDeckToPresentation: (deck: Deck) => void;
}

/** 자식 라우트에서 셸 컨텍스트를 타입 안전하게 읽는 훅 */
export function useAppShell(): AppShellContextValue {
  return useOutletContext<AppShellContextValue>();
}
