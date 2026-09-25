import {
  collectDescendantFolderIds,
  getFolderPath,
  hangulIncludes,
  isFolderTrashed,
  resolveFolderId,
  type Folder,
  type FolderIndex,
  type Presentation,
} from "#shared";
import type { DriveTypeFilter, SortOrder } from "../../routes/appShellContext";

/**
 * 드라이브 화면의 파생 데이터 (순수 함수).
 *
 * 폴더와 프레젠테이션(파일)을 한 목록으로 섞어 보여 준다. 섹션을 나누지 않고
 * 폴더를 앞에 둔다 (파일 탐색기·구글 드라이브와 같다).
 */

export type DriveItemKind = "folder" | "file";

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
  childCount: number;
}

export interface DriveFileItem extends DriveItemBase {
  kind: "file";
  presentation: Presentation;
  songCount: number;
  slideCount: number;
}

export type DriveItem = DriveFolderItem | DriveFileItem;

export const ROOT_LABEL = "내 드라이브";

export function itemKey(kind: DriveItemKind, id: string): string {
  return `${kind}:${id}`;
}

export function parseItemKey(key: string): DriveItemRef {
  const separator = key.indexOf(":");
  return {
    kind: key.slice(0, separator) as DriveItemKind,
    id: key.slice(separator + 1),
  };
}

export function countSlides(presentation: Presentation): number {
  return presentation.items.reduce(
    (sum, item) => sum + (item.deck?.slides.length ?? 0),
    0,
  );
}

/** "시선, 주 품에 외 2곡" */
export function buildSubtitle(presentation: Presentation): string {
  const titles = presentation.items
    .map((item) => item.deck?.title)
    .filter((title): title is string => Boolean(title));
  if (titles.length === 0) return "아직 등록된 찬양이 없습니다";
  const head = titles.slice(0, 2).join(", ");
  const restCount = titles.length - 2;
  return restCount > 0 ? `${head} 외 ${restCount}곡` : head;
}

/** 목록의 날짜 칸 ("2026. 9. 24.") */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}.`;
}

/** 프레젠테이션이 실제로 놓인 폴더 (사라진 폴더를 가리키면 루트) */
export function presentationFolderId(
  index: FolderIndex<Folder>,
  presentation: Presentation,
): string | null {
  return resolveFolderId(index, presentation.folderId);
}

/** 자신이나 담긴 폴더(조상 포함)가 휴지통에 있는지 */
export function isPresentationTrashed(
  index: FolderIndex<Folder>,
  presentation: Presentation,
): boolean {
  if (presentation.trashedAt) return true;
  return isFolderTrashed(index, presentationFolderId(index, presentation));
}

/** 폴더별 '항목 N개' (휴지통 제외 직속 폴더 + 프레젠테이션) */
export function buildChildCounts(
  index: FolderIndex<Folder>,
  presentations: readonly Presentation[],
): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (folderId: string | null): void => {
    if (folderId === null) return;
    counts.set(folderId, (counts.get(folderId) ?? 0) + 1);
  };
  for (const folder of index.byId.values()) {
    if (!folder.trashedAt) bump(index.parentOf.get(folder.id) ?? null);
  }
  for (const presentation of presentations) {
    if (!presentation.trashedAt) {
      bump(presentationFolderId(index, presentation));
    }
  }
  return counts;
}

/** 위치 문자열 ("내 드라이브 › 2026 › 주일") */
export function formatLocation(
  index: FolderIndex<Folder>,
  folderId: string | null,
): string {
  return [
    ROOT_LABEL,
    ...getFolderPath(index, folderId).map((f) => f.name),
  ].join(" › ");
}

function toFolderItem(
  folder: Folder,
  counts: Map<string, number>,
): DriveFolderItem {
  return {
    kind: "folder",
    key: itemKey("folder", folder.id),
    id: folder.id,
    name: folder.name,
    updatedAt: folder.updatedAt,
    folder,
    childCount: counts.get(folder.id) ?? 0,
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
    songCount: presentation.items.length,
    slideCount: countSlides(presentation),
  };
}

const collator = new Intl.Collator("ko", { numeric: true });

function compareItems(sortOrder: SortOrder) {
  return (a: DriveItem, b: DriveItem): number => {
    if (sortOrder === "recent") {
      return b.updatedAt.localeCompare(a.updatedAt);
    }
    if (
      sortOrder === "slides" &&
      a.kind === "file" &&
      b.kind === "file" &&
      a.slideCount !== b.slideCount
    ) {
      return b.slideCount - a.slideCount;
    }
    return collator.compare(a.name, b.name);
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
  const counts = buildChildCounts(index, presentations);
  const folders = (index.childrenOf.get(folderId) ?? [])
    .filter((folder) => !folder.trashedAt)
    .map((folder) => toFolderItem(folder, counts));
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
  return presentation.items.some((entry) => {
    const deck = entry.deck;
    if (!deck) return false;
    return (
      hangulIncludes(deck.title, query) ||
      hangulIncludes(deck.artist, query) ||
      hangulIncludes(deck.lyricsRaw, query)
    );
  });
}

/**
 * 드라이브 전체 검색 (휴지통 제외). 폴더 이름과 세트 제목·곡 제목·아티스트·가사를
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

  const counts = buildChildCounts(index, presentations);
  const folders = [...index.byId.values()]
    .filter(
      (folder) =>
        !isFolderTrashed(index, folder.id) &&
        hangulIncludes(folder.name, trimmed),
    )
    .map((folder) => ({
      ...toFolderItem(folder, counts),
      location: formatLocation(index, index.parentOf.get(folder.id) ?? null),
    }));
  const files = presentations
    .filter(
      (presentation) =>
        !isPresentationTrashed(index, presentation) &&
        matchesPresentation(presentation, trimmed),
    )
    .map((presentation) => ({
      ...toFileItem(presentation),
      location: formatLocation(
        index,
        presentationFolderId(index, presentation),
      ),
    }));
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
  const counts = buildChildCounts(index, presentations);

  const folders = [...index.byId.values()]
    .filter(
      (folder) =>
        folder.trashedAt &&
        !isFolderTrashed(index, index.parentOf.get(folder.id) ?? null),
    )
    .filter((folder) => !trimmed || hangulIncludes(folder.name, trimmed))
    .map((folder) => ({
      ...toFolderItem(folder, counts),
      location: formatLocation(index, index.parentOf.get(folder.id) ?? null),
    }));
  const files = presentations
    .filter(
      (presentation) =>
        presentation.trashedAt &&
        !isFolderTrashed(index, presentationFolderId(index, presentation)),
    )
    .filter(
      (presentation) => !trimmed || matchesPresentation(presentation, trimmed),
    )
    .map((presentation) => ({
      ...toFileItem(presentation),
      location: formatLocation(
        index,
        presentationFolderId(index, presentation),
      ),
    }));

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

const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;

function finalConsonant(text: string): number | null {
  const trimmed = text.replace(/[’'"」』)\]\s]+$/u, "");
  const code = trimmed.charCodeAt(trimmed.length - 1);
  if (Number.isNaN(code) || code < HANGUL_START || code > HANGUL_END) {
    return null;
  }
  return (code - HANGUL_START) % 28;
}

/** "폴더를" / "찬양을" / "Youth을(를)" */
export function withObjectParticle(text: string): string {
  const jong = finalConsonant(text);
  if (jong === null) return `${text}을(를)`;
  return `${text}${jong === 0 ? "를" : "을"}`;
}

/** "주일로" / "청년부로" / "2026(으)로" (받침 ㄹ은 '로') */
export function withDirectionParticle(text: string): string {
  const jong = finalConsonant(text);
  if (jong === null) return `${text}(으)로`;
  return `${text}${jong === 0 || jong === 8 ? "로" : "으로"}`;
}
