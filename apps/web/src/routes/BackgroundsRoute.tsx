import React from "react";
import { BackgroundLibraryView } from "../features/library";
import {
  updateSongBackground,
  useActivePresentation,
} from "../features/presentation";
import { useAppShell } from "./appShellContext";

/**
 * `/backgrounds` — 배경 라이브러리 (내가 등록한 배경 / 유저가 등록한 배경)
 */
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
