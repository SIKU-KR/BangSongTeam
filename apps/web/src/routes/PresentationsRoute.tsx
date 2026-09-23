import React from "react";
import { useNavigate } from "react-router-dom";
import { MergedSlidesView } from "../features/library";
import {
  launchPreparation,
  usePresentationList,
} from "../features/presentation";
import { useAppShell } from "./appShellContext";

/**
 * `/presentations` — Canva Projects 스타일 '모든 프로젝트' 대시보드
 */
export function PresentationsRoute(): React.JSX.Element {
  const navigate = useNavigate();
  const presentations = usePresentationList();
  const { searchQuery, viewMode, sortOrder, onCreateNewPresentation } =
    useAppShell();

  const handleOpenPresentation = (id: string): void => {
    navigate(`/editor/${id}`);
  };

  // 카드에서 바로 송출: 경로에 id가 실리므로 활성 문서와 어긋날 일이 없다
  const handleStartPresentation = (id: string): void => {
    launchPreparation(navigate, id);
  };

  return (
    <MergedSlidesView
      presentations={presentations}
      onOpenPresentation={handleOpenPresentation}
      onStartPresentation={handleStartPresentation}
      onCreateNewPresentation={onCreateNewPresentation}
      searchQuery={searchQuery}
      viewMode={viewMode}
      sortOrder={sortOrder}
    />
  );
}
