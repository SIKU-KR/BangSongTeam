import {
  collectDescendantFolderIds,
  resolveFolderId,
  type Presentation,
} from "@repo/shared";
import {
  listPresentations,
  getPresentationById,
  movePresentation,
  renamePresentation,
  trashPresentation,
  restorePresentation,
  duplicatePresentation,
  removePresentationsLocally,
  launchPreparation,
} from "../presentation";
import { isGoogleChromeBrowser } from "../../components/common/ChromeAlertBanner";
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

/**
 * 드라이브 항목 조작 (폴더와 프레젠테이션을 같은 방식으로 다룬다).
 *
 * 선택된 여러 항목에 한 번에 적용한다. 폴더 규칙(사이클·이름 충돌)은
 * `folderStore`가, 문서 저장·push는 `presentationStore`가 책임진다.
 */

export const DRIVE_ROOT_PATH = "/presentations";
export const TRASH_PATH = "/presentations/trash";

export function drivePath(folderId: string | null | undefined): string {
  return folderId ? `${DRIVE_ROOT_PATH}/folders/${folderId}` : DRIVE_ROOT_PATH;
}

type Navigate = (to: string) => void;

/** 폴더는 들어가고, 프레젠테이션은 편집기로 연다 */
export function openItem(ref: DriveItemRef, navigate: Navigate): void {
  navigate(ref.kind === "folder" ? drivePath(ref.id) : `/editor/${ref.id}`);
}

/**
 * 예배 준비 화면으로 보낸다. Chrome이 아니면 먼저 묻는다 (송출은 Chrome 권장).
 * @returns 실제로 이동했는지
 */
export function startPresentation(id: string, navigate: Navigate): boolean {
  if (!isGoogleChromeBrowser()) {
    const proceed = window.confirm(
      "이 서비스는 Google Chrome에 최적화되어 있습니다. 예배 송출은 Chrome에서 진행하는 것을 권장합니다.\n\n계속 진행하시겠습니까?",
    );
    if (!proceed) return false;
  }
  launchPreparation(navigate, id);
  return true;
}

/** 항목이 지금 놓인 폴더 (`null` = 루트) */
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

export function renameItem(
  ref: DriveItemRef,
  name: string,
): FolderMutationResult | { ok: true } {
  if (ref.kind === "folder") return renameFolder(ref.id, name);
  renamePresentation(ref.id, name);
  return { ok: true };
}

export interface MoveOutcome {
  /** 실제로 옮긴 항목과 원래 위치 (실행 취소용) */
  moved: Array<{ ref: DriveItemRef; from: string | null }>;
  /** 옮기지 못한 이유 (사이클 등) */
  errors: string[];
}

/** 여러 항목을 한 폴더로 옮긴다 (`null` = 루트) */
export function moveItems(
  refs: readonly DriveItemRef[],
  targetFolderId: string | null,
): MoveOutcome {
  const outcome: MoveOutcome = { moved: [], errors: [] };
  if (targetFolderId !== null && !isFolderAvailable(targetFolderId)) {
    outcome.errors.push("옮길 폴더를 찾을 수 없습니다");
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

/** 이동 실행 취소: 원래 위치로 돌려놓는다 (그사이 사라진 폴더면 루트) */
export function undoMove(outcome: MoveOutcome): void {
  for (const { ref, from } of outcome.moved) {
    const target = from !== null && isFolderAvailable(from) ? from : null;
    if (ref.kind === "folder") moveFolder(ref.id, target);
    else movePresentation(ref.id, target);
  }
}

/** 휴지통으로. 폴더를 버리면 안의 항목은 폴더와 함께 가려진다 */
export function trashItems(refs: readonly DriveItemRef[]): DriveItemRef[] {
  for (const ref of refs) {
    if (ref.kind === "folder") trashFolder(ref.id);
    else trashPresentation(ref.id);
  }
  return [...refs];
}

/** 휴지통에서 복원. 원래 폴더가 없거나 휴지통에 있으면 루트로 */
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

/** 사본 만들기 (프레젠테이션만. 폴더 사본은 드라이브와 같이 지원하지 않는다) */
export function duplicateItems(refs: readonly DriveItemRef[]): Presentation[] {
  return refs
    .filter((ref) => ref.kind === "file")
    .map((ref) => duplicatePresentation(ref.id))
    .filter((copy): copy is Presentation => copy !== null);
}

/** 영구 삭제 실패를 사용자에게 보여 줄 문장으로 감싼다 */
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

      // 서버가 이 폴더 소속으로 몰랐던 세트(한 번도 안 올라간 것 등)도 지운다.
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
      throw new DriveActionError(
        "오프라인 상태에서는 영구 삭제할 수 없습니다. 인터넷에 연결한 뒤 다시 시도하세요.",
        err,
      );
    }
    throw new DriveActionError(
      "영구 삭제하지 못했습니다. 잠시 후 다시 시도하세요.",
      err,
    );
  }
}
