import React from "react";
import { useNavigate } from "react-router-dom";
import { SongLibraryView } from "../features/library";
import {
  duplicateSongInPresentation,
  removeSongFromPresentation,
  useActivePresentation,
} from "../features/presentation";
import { useAppShell } from "./appShellContext";

/**
 * `/lyrics` — 곡 라이브러리 (내가 등록한 곡 / 유저가 등록한 곡)
 * 곡 추가·삭제는 "현재 작업 중인 프레젠테이션"을 대상으로 하므로 활성 문서를 읽는다.
 */
export function LyricsRoute(): React.JSX.Element {
  const navigate = useNavigate();
  const presentation = useActivePresentation();
  const { searchQuery, onOpenQuickPaste, onAddDeckToPresentation } =
    useAppShell();

  const handleOpenSong = (songIndex?: number): void => {
    const suffix = songIndex === undefined ? "" : `?song=${songIndex}`;
    navigate(`/editor/${presentation.id}${suffix}`);
  };

  return (
    <SongLibraryView
      presentation={presentation}
      onOpenQuickPaste={onOpenQuickPaste}
      onAddDeckToPresentation={onAddDeckToPresentation}
      onDuplicateSong={duplicateSongInPresentation}
      onRemoveSong={removeSongFromPresentation}
      onOpenSong={handleOpenSong}
      searchQuery={searchQuery}
    />
  );
}
