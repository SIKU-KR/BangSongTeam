import React from "react";
import { Navigate, useParams } from "react-router-dom";
import {
  DriveBrowser,
  isFolderAvailable,
  useFolderIndex,
} from "../features/drive";

/**
 * `/presentations` — 내 드라이브 (루트)
 * `/presentations/folders/:folderId` — 폴더 안
 *
 * 폴더와 프레젠테이션을 구글 드라이브처럼 한 목록에 보여 준다. 없거나 휴지통에
 * 들어간 폴더 주소로 오면(다른 기기에서 지웠거나 옛 링크) 루트로 보낸다.
 */
export function PresentationsRoute(): React.JSX.Element {
  const { folderId } = useParams<{ folderId?: string }>();
  // 폴더 트리가 바뀌면 다시 판단한다 (방금 이 폴더를 휴지통에 넣은 경우 등)
  useFolderIndex();

  if (folderId && !isFolderAvailable(folderId)) {
    return <Navigate to="/presentations" replace />;
  }
  return <DriveBrowser mode="drive" folderId={folderId ?? null} />;
}
