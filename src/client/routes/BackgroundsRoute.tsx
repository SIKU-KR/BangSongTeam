import React from "react";
import { BackgroundLibraryView } from "../features/library";
import { useAppShell } from "./appShellContext";

/** 배경 라이브러리 라우트 */
export function BackgroundsRoute(): React.JSX.Element {
  const { searchQuery } = useAppShell();
  return <BackgroundLibraryView searchQuery={searchQuery} />;
}
