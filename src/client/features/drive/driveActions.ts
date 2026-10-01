import {
  collectDescendantFolderIds,
  resolveFolderId,
  type Presentation,
} from "#shared";
import {
  listPresentations,
  getPresentationById,
  movePresentation,
  renamePresentation,
  trashPresentation,
  restorePresentation,
  duplicatePresentation,
  removePresentationsLocally,
  launchPresentation,
  type PresentNavigate,
} from "../presentation";
import { canPresentReliably } from "../../lib/browser/capabilities";
import {
  deleteFolderRemote,
  deletePresentationRemote,
  flushPendingSync,
  OfflineError,
} from "../../lib/sync";
import {
  getFolder,
  getFolderIndex,
  isFolderAvailable,
  moveFolder,
  removeFoldersLocally,
  renameFolder,
  restoreFolder,
  trashFolder,
  type FolderMutationResult,
} from "./folderStore";
import type { DriveItemRef } from "./driveModel";
import { drivePath } from "./drivePaths";
import { DRIVE_COPY } from "#copy/drive";
import { FOLDER_COPY } from "#copy/folders";

/**
 * 드라이브 항목 조작 (폴더와 프레젠테이션을 같은 방식으로 다룬다).
 *
 * 선택된 여러 항목에 한 번에 적용한다. 폴더 규칙(사이클·이름 충돌)은
 * `folderStore`가, 문서 저장·push는 `presentationStore`가 책임진다.
 */

type Navigate = (to: string) => void;

export function openItem(ref: DriveItemRef, navigate: Navigate): void {
  navigate(ref.kind === "folder" ? drivePath(ref.id) : `/editor/${ref.id}`);
}

/**
 * 곧바로 전체화면 송출로 들어간다. 전체화면이나 배경 영상 재생을 지원하지 않는
 * 브라우저면 먼저 묻는다.
 * 송출을 끝내면 `returnTo`(지금 보고 있는 드라이브 경로)로 돌아온다.
 *
 * 클릭 핸들러 안에서 동기로 불러야 브라우저가 전체화면을 허용한다 — 이 함수와
 * 호출 경로 사이에 await를 끼우지 않는다.
 */
export function startPresentation(
  id: string,
  navigate: PresentNavigate,
  returnTo: string,
): boolean {
  if (!canPresentReliably()) {
    const proceed = window.confirm(DRIVE_COPY.presentUnreliable);
    if (!proceed) return false;
  }
  launchPresentation(navigate, id, returnTo);
  return true;
}

export function parentOf(ref: DriveItemRef): string | null {
  const index = getFolderIndex();
  if (ref.kind === "folder") return index.parentOf.get(ref.id) ?? null;
  return resolveFolderId(index, getPresentationById(ref.id)?.folderId);
}

export function itemName(ref: DriveItemRef): string {
  return ref.kind === "folder"
    ? (getFolder(ref.id)?.name ?? "")
    : (getPresentationById(ref.id)?.title ?? "");
}

/** 알림·확인 문구의 대상 표현. 하나면 이름을 따옴표로, 여럿이거나 이름이 비면 개수로 쓴다 */
export function describeItems(refs: readonly DriveItemRef[]): string {
  if (refs.length === 1) {
    const name = itemName(refs[0]).trim();
    if (name) return DRIVE_COPY.quoted(name);
  }
  return DRIVE_COPY.itemCount(refs.length);
}

export function renameItem(
  ref: DriveItemRef,
  name: string,
): FolderMutationResult | { ok: true } {
  if (ref.kind === "folder") return renameFolder(ref.id, name);
  renamePresentation(ref.id, name);
  return { ok: true };
}

export interface MoveOutcome {
  moved: Array<{ ref: DriveItemRef; from: string | null }>;
  errors: string[];
}

export function moveItems(
  refs: readonly DriveItemRef[],
  targetFolderId: string | null,
): MoveOutcome {
  const outcome: MoveOutcome = { moved: [], errors: [] };
  if (targetFolderId !== null && !isFolderAvailable(targetFolderId)) {
    outcome.errors.push(FOLDER_COPY.targetFolderNotFound);
    return outcome;
  }

  for (const ref of refs) {
    const from = parentOf(ref);
    if (from === targetFolderId) continue;
    if (ref.kind === "folder") {
      const result = moveFolder(ref.id, targetFolderId);
      if (!result.ok) {
        outcome.errors.push(result.error);
        continue;
      }
    } else {
      movePresentation(ref.id, targetFolderId);
    }
    outcome.moved.push({ ref, from });
  }
  return outcome;
}

export function undoMove(outcome: MoveOutcome): void {
  for (const { ref, from } of outcome.moved) {
    const target = from !== null && isFolderAvailable(from) ? from : null;
    if (ref.kind === "folder") moveFolder(ref.id, target);
    else movePresentation(ref.id, target);
  }
}

/** 폴더를 버리면 안의 항목도 폴더와 함께 가려진다 (folderStore가 처리) */
export function trashItems(refs: readonly DriveItemRef[]): DriveItemRef[] {
  for (const ref of refs) {
    if (ref.kind === "folder") trashFolder(ref.id);
    else trashPresentation(ref.id);
  }
  return [...refs];
}

export function restoreItems(refs: readonly DriveItemRef[]): void {
  for (const ref of refs) {
    if (ref.kind === "folder") {
      restoreFolder(ref.id);
      continue;
    }
    const folderId = getPresentationById(ref.id)?.folderId ?? null;
    restorePresentation(ref.id, isFolderAvailable(folderId) ? folderId : null);
  }
}

/** 폴더 사본은 지원하지 않는다 (프레젠테이션만 복제) */
export function duplicateItems(refs: readonly DriveItemRef[]): Presentation[] {
  return refs
    .filter((ref) => ref.kind === "file")
    .map((ref) => duplicatePresentation(ref.id))
    .filter((copy): copy is Presentation => copy !== null);
}

export class DriveActionError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "DriveActionError";
    this.cause = cause;
  }
}

/**
 * 영구 삭제 (휴지통 비우기). **서버 삭제가 성공한 뒤에만** 로컬에서 지운다.
 *
 * 로컬에서 먼저 지우면, 서버에 남은 사본을 다음 부팅 병합이 '아직 안 올라간
 * 문서'로 보고 되살린다. 그래서 오프라인이면 지우지 않고 알린다.
 *
 * 먼저 대기 중인 push를 모두 보낸다. 방금 폴더로 옮긴 세트가 서버에서는 아직
 * 다른 곳에 있으면, 서버의 폴더 삭제가 그 세트를 놓친다.
 */
export async function deleteItemsForever(
  refs: readonly DriveItemRef[],
): Promise<void> {
  try {
    await flushPendingSync();

    for (const ref of refs) {
      if (ref.kind === "file") {
        await deletePresentationRemote(ref.id);
        await removePresentationsLocally([ref.id]);
        continue;
      }

      const index = getFolderIndex();
      const subtree = collectDescendantFolderIds(index, ref.id);
      const localFiles = listPresentations()
        .filter((presentation) => {
          const folderId = resolveFolderId(index, presentation.folderId);
          return folderId !== null && subtree.has(folderId);
        })
        .map((presentation) => presentation.id);

      const result = await deleteFolderRemote(ref.id);

      const deletedOnServer = new Set(result.deletedPresentationIds);
      for (const id of localFiles) {
        if (!deletedOnServer.has(id)) await deletePresentationRemote(id);
      }

      await removePresentationsLocally([
        ...localFiles,
        ...result.deletedPresentationIds,
      ]);
      await removeFoldersLocally([...subtree, ...result.deletedFolderIds]);
    }
  } catch (err) {
    if (err instanceof OfflineError) {
      throw new DriveActionError(DRIVE_COPY.deleteForeverOffline, err);
    }
    throw new DriveActionError(DRIVE_COPY.deleteForeverRetry, err);
  }
}
