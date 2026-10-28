"use client";

import React from "react";
import { useParams } from "next/navigation";
import { LoadingScreen } from "../components/common/LoadingScreen";
import { Navigate } from "../components/common/Navigate";
import {
  DriveBrowser,
  drivePath,
  getFolder,
  isFolderAvailable,
  nearestAvailableFolder,
  useFolderIndex,
} from "../features/drive";
import { useBootPullPending } from "../lib/sync";
import { useAppShell } from "./appShellContext";
import { DRIVE_COPY } from "#copy/drive";
import { SHELL_COPY } from "#copy/shell";

/**
 * 내 드라이브 및 폴더 브라우저 라우트.
 *
 * 이 기기가 모르는 폴더 주소는 부팅 동기화가 폴더를 받는 동안 기다렸다가 연다. 다른 기기에서
 * 만들었거나 저장소를 비운 기기에서 연 폴더는 첫 받기가 끝나야 생긴다. 알고 있는데 휴지통에
 * 있는 폴더는 곧바로 열 수 있는 가장 가까운 상위 폴더로, 받기가 끝나도 없는 폴더는 루트로 보낸다.
 * 열려 있는 폴더를 휴지통에 넣을 때 사용자가 가려던 곳(상위 폴더)과 같은 곳이다. 끝내 없는 폴더만
 * 찾지 못했다고 알린다. 휴지통에 넣은 폴더는 사용자가 아는 일이라 알리지 않는다.
 */
export function PresentationsRoute(): React.JSX.Element {
  const { folderId } = useParams<{ folderId?: string }>();
  const { searchQuery } = useAppShell();
  const isPullPending = useBootPullPending("folder");
  useFolderIndex();

  if (folderId && !isFolderAvailable(folderId)) {
    const isUnknown = !getFolder(folderId);
    if (isUnknown && isPullPending) {
      return (
        <LoadingScreen variant="content" testId="drive-pending">
          {SHELL_COPY.routeLoading}
        </LoadingScreen>
      );
    }
    return (
      <Navigate
        to={drivePath(nearestAvailableFolder(folderId))}
        notice={isUnknown ? DRIVE_COPY.toast.folderNotFound : undefined}
      />
    );
  }
  return (
    <DriveBrowser
      mode="drive"
      folderId={folderId ?? null}
      searchQuery={searchQuery}
    />
  );
}
