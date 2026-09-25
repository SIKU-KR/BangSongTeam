import { useOutletContext } from "react-router-dom";
import type { Deck } from "#shared";

/** 목록 정렬 기준. `updated`는 수정일(휴지통에서는 삭제일), `slides`는 슬라이드 수다 */
export type SortKey = "name" | "updated" | "slides";

export type SortDirection = "asc" | "desc";

/** 열 머리글로 고르는 정렬. 폴더는 기준과 상관없이 항상 파일 앞에 둔다 */
export interface SortOrder {
  key: SortKey;
  direction: SortDirection;
}

/** 드라이브 목록의 유형 필터. `file`은 프레젠테이션이다 */
export type DriveTypeFilter = "all" | "folder" | "file";

/** `AppShellLayout`이 `<Outlet context>`로 자식 라우트에 내려주는 값 */
export interface AppShellContextValue {
  searchQuery: string;
  sortOrder: SortOrder;
  typeFilter: DriveTypeFilter;
  onSortOrderChange: (order: SortOrder) => void;
  onTypeFilterChange: (filter: DriveTypeFilter) => void;
  onOpenQuickPaste: () => void;
  onCreateNewPresentation: () => void;
  onAddDeckToPresentation: (deck: Deck) => void;
}

/** 자식 라우트에서 셸 컨텍스트를 타입 안전하게 읽는 훅 */
export function useAppShell(): AppShellContextValue {
  return useOutletContext<AppShellContextValue>();
}
