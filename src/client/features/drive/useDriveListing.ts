import { useMemo } from "react";
import { canEditPresentation, usePresentationList } from "../presentation";
import { useFolderIndex } from "./folderStore";
import {
  filterByType,
  listFolderContents,
  listTrash,
  searchDrive,
  type DriveItem,
  type DriveTypeFilter,
  type SortOrder,
} from "./driveModel";
import { DRIVE_COPY } from "#copy/drive";

export interface DriveListingOptions {
  isTrash: boolean;
  folderId: string | null;
  searchQuery: string;
  sortOrder: SortOrder;
  typeFilter: DriveTypeFilter;
}

export interface DriveListing {
  /** 앞뒤 공백을 뺀 검색어. 비어 있으면 폴더 내용을 보여 준다 */
  query: string;
  items: DriveItem[];
  keys: string[];
  isFiltered: boolean;
  /** 내 드라이브 루트에서만 목록 맨 위에 고정된 휴지통 폴더를 보인다 */
  showTrashFolder: boolean;
  trashCount: number;
  summary: string;
}

/**
 * 드라이브 본문에 보일 목록과 그 요약.
 *
 * 링크로 공유받은 프레젠테이션은 보기 전용이라 내 드라이브에 섞지 않는다.
 * 휴지통 개수는 휴지통 폴더나 휴지통 화면이 보일 때만 센다.
 */
export function useDriveListing({
  isTrash,
  folderId,
  searchQuery,
  sortOrder,
  typeFilter,
}: DriveListingOptions): DriveListing {
  const allPresentations = usePresentationList();
  const presentations = useMemo(
    () =>
      allPresentations.filter((presentation) =>
        canEditPresentation(presentation),
      ),
    [allPresentations],
  );
  const index = useFolderIndex();

  const query = searchQuery.trim();
  const items = useMemo(() => {
    if (isTrash) return listTrash(index, presentations, query);
    const listed = query
      ? searchDrive(index, presentations, query, sortOrder)
      : listFolderContents(index, presentations, folderId, sortOrder);
    return filterByType(listed, typeFilter);
  }, [isTrash, index, presentations, query, sortOrder, folderId, typeFilter]);

  const isFiltered = !isTrash && typeFilter !== "all";
  const showTrashFolder =
    !isTrash && folderId === null && !query && typeFilter !== "file";
  const trashCount = useMemo(
    () =>
      showTrashFolder || isTrash ? listTrash(index, presentations).length : 0,
    [showTrashFolder, isTrash, index, presentations],
  );

  const keys = useMemo(() => items.map((item) => item.key), [items]);

  const folderCount = items.filter((item) => item.kind === "folder").length;
  const fileCount = items.length - folderCount;
  const summary = query
    ? DRIVE_COPY.summary.search(query, items.length)
    : DRIVE_COPY.summary.counts(folderCount, fileCount);

  return {
    query,
    items,
    keys,
    isFiltered,
    showTrashFolder,
    trashCount,
    summary,
  };
}
