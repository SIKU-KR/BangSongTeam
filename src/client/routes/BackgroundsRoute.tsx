import React from "react";
import { BackgroundLibraryView } from "../features/library";
import {
  updateSongBackground,
  useActivePresentation,
} from "../features/presentation";
import { useAppShell } from "./appShellContext";

/** 배경 라이브러리 라우트 */
export function BackgroundsRoute(): React.JSX.Element {
  const presentation = useActivePresentation();
  const { searchQuery } = useAppShell();

  const handleApplyBackground = (bgId: string): void => {
    if (presentation.items.length > 0) {
      updateSongBackground(0, bgId);
    }
  };

  return (
    <BackgroundLibraryView
      onApplyBackgroundToCurrentSet={handleApplyBackground}
      searchQuery={searchQuery}
    />
  );
}
