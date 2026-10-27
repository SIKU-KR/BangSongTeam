import {
  API_ERRORS,
  collectDescendantFolderIds,
  MAX_PRESENTATION_TITLE_LENGTH,
  onlyItem,
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
  editorPath,
} from "../presentation";
import { isServerReachable } from "../../lib/api/connectivity";
import {
  beginPermanentDelete,
  deleteFolderRemote,
  deletePresentationRemote,
  flushFolderSync,
  flushPendingSync,
  hasPendingDocumentPush,
  hasPendingFolderPush,
  OfflineError,
  ServerRejectedError,
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
  validateFolderName,
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
  navigate(ref.kind === "folder" ? drivePath(ref.id) : editorPath(ref.id));
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
  const only = onlyItem(refs);
  const name = only ? itemName(only).trim() : "";
  if (name) return DRIVE_COPY.quoted(name);
  return DRIVE_COPY.itemCount(refs.length);
}

/**
 * 이름 바꾸기 입력 검증. 잘못된 이름이면 안내 문구, 괜찮으면 `null`.
 * 폴더는 같은 위치의 이름 충돌까지 보고, 프레젠테이션은 서버 스키마와 같은 길이 제한만 본다.
 */
export function validateItemName(
  ref: DriveItemRef,
  name: string,
): string | null {
  if (ref.kind === "folder") {
    return validateFolderName(name, parentOf(ref), ref.id);
  }
  const trimmed = name.trim();
  if (!trimmed) return FOLDER_COPY.nameRequired;
  if (trimmed.length > MAX_PRESENTATION_TITLE_LENGTH) {
    return FOLDER_COPY.nameTooLong(MAX_PRESENTATION_TITLE_LENGTH);
  }
  return null;
}

export function renameItem(
  ref: DriveItemRef,
  name: string,
): FolderMutationResult | { ok: true } {
  if (ref.kind === "folder") return renameFolder(ref.id, name);
  renamePresentation(ref.id, name);
  return { ok: true };
}

interface MoveOutcome {
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
 * 먼저 폴더·프레젠테이션 큐를 모두 보내고, 그래도 올리지 못한 변경이 남으면 아무것도 지우지
 * 않는다. 서버는 자기 휴지통에 있는 항목만 지운다. 휴지통에 넣거나 폴더 밖으로 꺼낸 변경이
 * 서버에 닿기 전에 지우면 서버가 거절해(409) 사용자가 지우려던 항목을 지우지 못한다. 폴더로
 * 옮겨 넣은 프레젠테이션은 서버에서 아직 폴더 밖에 있어 서버에 남고, 다음 부팅 병합이 되살린다.
 *
 * 폴더는 이 기기가 본 하위 폴더·프레젠테이션 id를 함께 보낸다. 서버 트리에 그 밖의 항목(다른
 * 기기에서 옮겨 넣은 것)이 있으면 서버는 아무것도 지우지 않고 거절한다(409). 서버가 폴더 밖에
 * 둔 프레젠테이션은 다른 기기에서 꺼낸 것이라 서버에서 지우지 않고 이 기기에서만 내려놓는다.
 * 다음 부팅 병합이 서버 위치로 되돌린다.
 *
 * 거절된 항목은 건너뛰고 나머지를 지운 뒤 서버가 준 문장으로 알린다. 그사이 지운 것이 있으면
 * 일부만 지웠다고 알린다. 거절이 아닌 오류에서는 멈춘다.
 *
 * 지울 프레젠테이션(고른 파일과, 고른 폴더 아래의 세트)은 큐를 보내기 전에 정하고, 끝날 때까지
 * 영구 삭제 중으로 둔다(`beginPermanentDelete`). 먼저 보내는 그 세트의 변경이 다른 기기와 엇갈리거나
 * 이미 영구 삭제됐다는 답을 받아도, 비우는 휴지통에 '(사본)'을 남기거나 알리지 않는다. 그 세트들의
 * 대기 중인 push는 버리지 않는다. 버리면 휴지통에 넣은 직후 비울 때 서버가 그 세트를 휴지통 밖으로
 * 보고 거절하고(409), 폴더로 옮긴 세트가 서버에서 폴더 밖에 남는다.
 */
export async function deleteItemsForever(
  refs: readonly DriveItemRef[],
): Promise<void> {
  const end = beginPermanentDelete(presentationsDeletedBy(refs));
  try {
    await deleteNow(refs);
  } finally {
    end();
  }
}

async function deleteNow(refs: readonly DriveItemRef[]): Promise<void> {
  let refusal: ServerRejectedError | null = null;
  let deletedAny = false;
  try {
    await flushFolderSync();
    await flushPendingSync();
    if (hasPendingFolderPush() || hasPendingDocumentPush()) {
      throw new DriveActionError(
        isServerReachable()
          ? DRIVE_COPY.deleteForeverRetry
          : DRIVE_COPY.deleteForeverOffline,
      );
    }

    for (const ref of refs) {
      try {
        await deleteForever(ref);
        deletedAny = true;
      } catch (err) {
        if (!isTrashRefusal(err)) throw err;
        refusal = err;
        deletedAny ||= err.message === API_ERRORS.trashChangedPartly;
      }
    }
  } catch (err) {
    throw toDeleteForeverError(err);
  }

  if (refusal) {
    throw new DriveActionError(
      deletedAny ? API_ERRORS.trashChangedPartly : refusal.message,
      refusal,
    );
  }
}

function presentationIdsIn(
  index: ReturnType<typeof getFolderIndex>,
  folderIds: ReadonlySet<string>,
): string[] {
  return listPresentations()
    .filter((presentation) => {
      const folderId = resolveFolderId(index, presentation.folderId);
      return folderId !== null && folderIds.has(folderId);
    })
    .map((presentation) => presentation.id);
}

function presentationsDeletedBy(refs: readonly DriveItemRef[]): string[] {
  const index = getFolderIndex();
  const folderIds = new Set(
    refs.flatMap((ref) =>
      ref.kind === "folder"
        ? [...collectDescendantFolderIds(index, ref.id)]
        : [],
    ),
  );
  return [
    ...refs.flatMap((ref) => (ref.kind === "file" ? [ref.id] : [])),
    ...presentationIdsIn(index, folderIds),
  ];
}

async function deleteForever(ref: DriveItemRef): Promise<void> {
  if (ref.kind === "file") {
    await deletePresentationRemote(ref.id);
    await removePresentationsLocally([ref.id]);
    return;
  }

  const index = getFolderIndex();
  const subtree = collectDescendantFolderIds(index, ref.id);
  const folderIds = [...subtree];
  const presentationIds = presentationIdsIn(index, subtree);

  const result = await deleteFolderRemote(ref.id, {
    folderIds,
    presentationIds,
  });

  await removePresentationsLocally([
    ...presentationIds,
    ...result.deletedPresentationIds,
  ]);
  await removeFoldersLocally([...folderIds, ...result.deletedFolderIds]);
}

function isTrashRefusal(err: unknown): err is ServerRejectedError {
  return err instanceof ServerRejectedError && err.status === 409;
}

function toDeleteForeverError(err: unknown): DriveActionError {
  if (err instanceof DriveActionError) return err;
  return new DriveActionError(
    err instanceof OfflineError
      ? DRIVE_COPY.deleteForeverOffline
      : DRIVE_COPY.deleteForeverRetry,
    err,
  );
}
