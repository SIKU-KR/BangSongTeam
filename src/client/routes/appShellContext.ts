import { createContext, useContext } from "react";

/** `AppShellLayout`이 자식 화면에 내려주는 값 */
export interface AppShellContextValue {
  searchQuery: string;
}

export const AppShellContext = createContext<AppShellContextValue>({
  searchQuery: "",
});

/** 셸 안의 화면에서 셸 컨텍스트를 읽는 훅 */
export function useAppShell(): AppShellContextValue {
  return useContext(AppShellContext);
}
