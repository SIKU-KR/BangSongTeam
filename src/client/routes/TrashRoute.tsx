import React from "react";
import { DriveBrowser } from "../features/drive";
import { useAppShell } from "./appShellContext";

/** 휴지통 라우트 */
export function TrashRoute(): React.JSX.Element {
  const { searchQuery } = useAppShell();
  return <DriveBrowser mode="trash" searchQuery={searchQuery} />;
}
