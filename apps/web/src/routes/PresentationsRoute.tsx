import React from "react";
import { Navigate, useParams } from "react-router-dom";
import {
  DriveBrowser,
  isFolderAvailable,
  useFolderIndex,
} from "../features/drive";

/** 내 드라이브 및 폴더 브라우저 라우트 */
export function PresentationsRoute(): React.JSX.Element {
  const { folderId } = useParams<{ folderId?: string }>();
  useFolderIndex();

  if (folderId && !isFolderAvailable(folderId)) {
    return <Navigate to="/presentations" replace />;
  }
  return <DriveBrowser mode="drive" folderId={folderId ?? null} />;
}
