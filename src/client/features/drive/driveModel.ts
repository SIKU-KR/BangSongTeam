import {
  collectDescendantFolderIds,
  deckMatchesQuery,
  getFolderPath,
  hangulIncludes,
  isFolderTrashed,
  resolveFolderId,
  type Folder,
  type FolderIndex,
  type Presentation,
} from "#shared";
import { COMMON_COPY } from "#copy/common";

/**
 * 드라이브 화면의 파생 데이터 (순수 함수).
 *
 * 폴더와 프레젠테이션(파일)을 한 목록으로 섞어 보여 준다. 섹션을 나누지 않고
 * 폴더를 앞에 둔다 (파일 탐색기·구글 드라이브와 같다).
 */

export type DriveItemKind = "folder" | "file";

/** 목록 정렬 기준. `updated`는 수정일(휴지통에서는 삭제일)이다 */
export type SortKey = "name" | "updated";

export type SortDirection = "asc" | "desc";

/** 열 머리글로 고르는 정렬. 폴더는 기준과 상관없이 항상 파일 앞에 둔다 */
export interface SortOrder {
  key: SortKey;
  direction: SortDirection;
}

/** 드라이브 목록의 유형 필터. `file`은 프레젠테이션이다 */
export type DriveTypeFilter = "all" | "folder" | "file";

export interface DriveItemRef {
  kind: DriveItemKind;
  id: string;
}

interface DriveItemBase extends DriveItemRef {
  key: string;
  name: string;
  updatedAt: string;
  location?: string;
}

export interface DriveFolderItem extends DriveItemBase {
  kind: "folder";
  folder: Folder;
}

export interface DriveFileItem extends DriveItemBase {
  kind: "file";
  presentation: Presentation;
}

export type DriveItem = DriveFolderItem | DriveFileItem;

export function itemKey(kind: DriveItemKind, id: string): string {
  return `${kind}:${id}`;
}

/** 목록 항목에서 조작에 넘길 참조만 떼어 낸다. 항목 스냅숏을 액션에 넘기지 않기 위해서다 */
export function toItemRef(item: DriveItemRef): DriveItemRef {
  return { kind: item.kind, id: item.id };
}

export function parseItemKey(key: string): DriveItemRef {
  const separator = key.indexOf(":");
  return {
    kind: key.slice(0, separator) as DriveItemKind,
    id: key.slice(separator + 1),
  };
}

/** 목록의 날짜 칸 ("2026. 9. 24.") */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}.`;
}

/** 프레젠테이션이 실제로 놓인 폴더 (사라진 폴더를 가리키면 루트) */
function presentationFolderId(
  index: FolderIndex<Folder>,
  presentation: Presentation,
): string | null {
  return resolveFolderId(index, presentation.folderId);
}

/** 자신이나 담긴 폴더(조상 포함)가 휴지통에 있는지 */
function isPresentationTrashed(
  index: FolderIndex<Folder>,
  presentation: Presentation,
): boolean {
  if (presentation.trashedAt) return true;
  return isFolderTrashed(index, presentationFolderId(index, presentation));
}

/** 위치 문자열 ("내 드라이브 › 2026 › 주일") */
export function formatLocation(
  index: FolderIndex<Folder>,
  folderId: string | null,
): string {
  return [
    COMMON_COPY.myDrive,
    ...getFolderPath(index, folderId).map((f) => f.name),
  ].join(" › ");
}

function toFolderItem(folder: Folder): DriveFolderItem {
  return {
    kind: "folder",
    key: itemKey("folder", folder.id),
    id: folder.id,
    name: folder.name,
    updatedAt: folder.updatedAt,
    folder,
  };
}

function toFileItem(presentation: Presentation): DriveFileItem {
  return {
    kind: "file",
    key: itemKey("file", presentation.id),
    id: presentation.id,
    name: presentation.title,
    updatedAt: presentation.updatedAt,
    presentation,
  };
}

function toLocatedFolderItem(
  index: FolderIndex<Folder>,
  folder: Folder,
): DriveFolderItem {
  return {
    ...toFolderItem(folder),
    location: formatLocation(index, index.parentOf.get(folder.id) ?? null),
  };
}

function toLocatedFileItem(
  index: FolderIndex<Folder>,
  presentation: Presentation,
): DriveFileItem {
  return {
    ...toFileItem(presentation),
    location: formatLocation(index, presentationFolderId(index, presentation)),
  };
}

const collator = new Intl.Collator("ko", { numeric: true });

/** 처음 정렬할 때의 기본 방향 (이름은 가나다순, 날짜는 최근부터) */
const DEFAULT_SORT_DIRECTION: Record<SortKey, SortOrder["direction"]> = {
  name: "asc",
  updated: "desc",
};

export const DEFAULT_SORT_ORDER: SortOrder = {
  key: "updated",
  direction: DEFAULT_SORT_DIRECTION.updated,
};

/**
 * 열 머리글을 눌렀을 때의 다음 정렬 (구글 드라이브와 같다).
 * 지금 기준을 다시 누르면 방향만 뒤집고, 다른 기준은 그 기준의 기본 방향으로 시작한다.
 */
export function nextSortOrder(current: SortOrder, key: SortKey): SortOrder {
  if (current.key === key) {
    return { key, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  return { key, direction: DEFAULT_SORT_DIRECTION[key] };
}

function compareItems(sortOrder: SortOrder) {
  const sign = sortOrder.direction === "asc" ? 1 : -1;
  return (a: DriveItem, b: DriveItem): number => {
    const primary =
      sortOrder.key === "updated"
        ? a.updatedAt.localeCompare(b.updatedAt)
        : collator.compare(a.name, b.name);
    return primary !== 0 ? primary * sign : collator.compare(a.name, b.name);
  };
}

function sortItems(items: DriveItem[], sortOrder: SortOrder): DriveItem[] {
  const compare = compareItems(sortOrder);
  const folders = items.filter((item) => item.kind === "folder").sort(compare);
  const files = items.filter((item) => item.kind === "file").sort(compare);
  return [...folders, ...files];
}

/** 유형 필터에 맞는 항목만 남긴다. `all`이면 그대로 돌려준다 */
export function filterByType(
  items: DriveItem[],
  typeFilter: DriveTypeFilter,
): DriveItem[] {
  if (typeFilter === "all") return items;
  return items.filter((item) => item.kind === typeFilter);
}

/** 폴더 하나의 내용 (휴지통 제외). `null`이면 내 드라이브 루트 */
export function listFolderContents(
  index: FolderIndex<Folder>,
  presentations: readonly Presentation[],
  folderId: string | null,
  sortOrder: SortOrder,
): DriveItem[] {
  const folders = (index.childrenOf.get(folderId) ?? [])
    .filter((folder) => !folder.trashedAt)
    .map(toFolderItem);
  const files = presentations
    .filter(
      (presentation) =>
        !presentation.trashedAt &&
        presentationFolderId(index, presentation) === folderId,
    )
    .map(toFileItem);
  return sortItems([...folders, ...files], sortOrder);
}

function matchesPresentation(
  presentation: Presentation,
  query: string,
): boolean {
  if (hangulIncludes(presentation.title, query)) return true;
  return presentation.items.some(
    (entry) => entry.deck !== undefined && deckMatchesQuery(entry.deck, query),
  );
}

/**
 * 드라이브 전체 검색 (휴지통 제외). 폴더 이름과 프레젠테이션 제목·곡 제목·아티스트·가사를
 * 한글 초성·자모 단위로 찾는다. 결과마다 위치를 붙인다.
 */
export function searchDrive(
  index: FolderIndex<Folder>,
  presentations: readonly Presentation[],
  query: string,
  sortOrder: SortOrder,
): DriveItem[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const folders = [...index.byId.values()]
    .filter(
      (folder) =>
        !isFolderTrashed(index, folder.id) &&
        hangulIncludes(folder.name, trimmed),
    )
    .map((folder) => toLocatedFolderItem(index, folder));
  const files = presentations
    .filter(
      (presentation) =>
        !isPresentationTrashed(index, presentation) &&
        matchesPresentation(presentation, trimmed),
    )
    .map((presentation) => toLocatedFileItem(index, presentation));
  return sortItems([...folders, ...files], sortOrder);
}

/** 항목 자신을 휴지통에 넣은 시각 (조상 폴더만 버려졌으면 `null`) */
export function trashedAtOf(item: DriveItem): string | null {
  return (
    (item.kind === "folder"
      ? item.folder.trashedAt
      : item.presentation.trashedAt) ?? null
  );
}

/**
 * 휴지통 목록. 직접 휴지통에 넣은 항목 중 조상이 휴지통에 없는 것만 보인다 —
 * 폴더를 버리면 그 안의 항목은 폴더와 함께 한 줄로 보인다 (드라이브와 같다).
 * 최근에 버린 순.
 */
export function listTrash(
  index: FolderIndex<Folder>,
  presentations: readonly Presentation[],
  query = "",
): DriveItem[] {
  const trimmed = query.trim();

  const folders = [...index.byId.values()]
    .filter(
      (folder) =>
        folder.trashedAt &&
        !isFolderTrashed(index, index.parentOf.get(folder.id) ?? null),
    )
    .filter((folder) => !trimmed || hangulIncludes(folder.name, trimmed))
    .map((folder) => toLocatedFolderItem(index, folder));
  const files = presentations
    .filter(
      (presentation) =>
        presentation.trashedAt &&
        !isFolderTrashed(index, presentationFolderId(index, presentation)),
    )
    .filter(
      (presentation) => !trimmed || matchesPresentation(presentation, trimmed),
    )
    .map((presentation) => toLocatedFileItem(index, presentation));

  return [...folders, ...files].sort((a, b) =>
    (trashedAtOf(b) ?? "").localeCompare(trashedAtOf(a) ?? ""),
  );
}

/**
 * 끌어 온 항목들을 이 폴더(`null` = 루트)에 놓을 수 있는지.
 * 휴지통에 있거나 없는 폴더, 자기 자신이나 하위 폴더에는 놓을 수 없다.
 */
export function canDropInto(
  index: FolderIndex<Folder>,
  refs: readonly DriveItemRef[],
  targetFolderId: string | null,
): boolean {
  if (refs.length === 0) return false;
  if (targetFolderId !== null) {
    if (!index.byId.has(targetFolderId)) return false;
    if (isFolderTrashed(index, targetFolderId)) return false;
  }
  return refs.every(
    (ref) =>
      ref.kind === "file" ||
      targetFolderId === null ||
      !collectDescendantFolderIds(index, ref.id).has(targetFolderId),
  );
}
