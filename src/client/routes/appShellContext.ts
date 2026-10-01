import { useOutletContext } from "react-router-dom";

/** `AppShellLayout`이 `<Outlet context>`로 자식 라우트에 내려주는 값 */
export interface AppShellContextValue {
  searchQuery: string;
}

/** 자식 라우트에서 셸 컨텍스트를 타입 안전하게 읽는 훅 */
export function useAppShell(): AppShellContextValue {
  return useOutletContext<AppShellContextValue>();
}
